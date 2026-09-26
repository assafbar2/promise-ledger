import { z } from "zod";
import { ACCOUNT, FEATURE_IDS } from "./fixtures";
import { validateExtraction } from "./reconcile";
import type { Source } from "./schema";
import { EXTRACTION_PROMPT, extractionPrompt } from "./extraction-prompt";

export const NEBIUS_MAX_OUTPUT_TOKENS = 6000;
export const NEBIUS_CHAT_URL = "https://api.tokenfactory.nebius.com/v1/chat/completions";
const NEMOTRON = /^nvidia\/.*nemotron/i;

const usageSchema = z.object({
  prompt_tokens: z.number().nonnegative(),
  completion_tokens: z.number().nonnegative(),
  completion_tokens_details: z.object({ reasoning_tokens: z.number().nonnegative().nullish() }).nullish(),
});

const responseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(z.object({ finish_reason: z.string(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }) })).min(1),
  usage: usageSchema.optional(),
});

const chunkSchema = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(z.object({
    delta: z.object({ content: z.string().nullish(), reasoning_content: z.string().nullish(), reasoning: z.string().nullish(), refusal: z.string().nullish() }).nullish(),
    finish_reason: z.string().nullish(),
  })).optional(),
  usage: usageSchema.nullish(),
});

export type InferenceTrace = {
  requestedModel: string;
  model: string | null;
  runId: string | null;
  requestId: string | null;
  httpStatus: number | null;
  elapsedMs: number;
  usage: { promptTokens: number; completionTokens: number } | null;
  reasoningTokens?: number | null;
};

export class InferenceError extends Error {
  constructor(message: string, public status = 502, public code = "inference_error", public trace: InferenceTrace | null = null) { super(message); }
}

export function configuration() {
  return {
    apiKey: process.env.NEBIUS_API_KEY ?? "",
    model: process.env.NEBIUS_MODEL ?? "",
    accessToken: process.env.DEMO_ACCESS_TOKEN ?? "",
  };
}

export type StreamProgress = { content: string; outputChunks: number };

export type ChatRequest = {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  /** Sent as `reasoning_effort` only when set; honoured per model, not guaranteed. */
  reasoningEffort?: string | null;
  timeoutMs?: number;
  stream?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: StreamProgress) => void;
  fetcher?: typeof fetch;
};

function toUsage(usage: z.infer<typeof usageSchema> | null | undefined) {
  return usage ? { promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens } : null;
}

async function readEventStream(response: Response, onProgress: ChatRequest["onProgress"]) {
  if (!response.body) throw new Error("empty stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const state = { id: null as string | null, model: null as string | null, content: "", finishReason: null as string | null, refusal: "", usage: null as z.infer<typeof usageSchema> | null, chunks: 0 };
  let buffer = "";
  let finished = false;
  while (!finished) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = done ? "" : blocks.pop() ?? "";
    for (const block of blocks) {
      const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (!data) continue;
      if (data === "[DONE]") { finished = true; break; }
      const chunk = chunkSchema.parse(JSON.parse(data));
      state.id ??= chunk.id ?? null;
      state.model ??= chunk.model ?? null;
      if (chunk.usage) state.usage = chunk.usage;
      let progressed = false;
      for (const choice of chunk.choices ?? []) {
        const delta = choice.delta;
        if (delta?.content) state.content += delta.content;
        if (delta?.refusal) state.refusal += delta.refusal;
        if (delta?.content || delta?.reasoning_content || delta?.reasoning) progressed = true;
        if (choice.finish_reason) state.finishReason = choice.finish_reason;
      }
      if (progressed) {
        state.chunks++;
        onProgress?.({ content: state.content, outputChunks: state.chunks });
      }
    }
    if (done) break;
  }
  await reader.cancel().catch(() => {});
  if (!state.id || !state.model) throw new Error("stream missing identity");
  return state;
}

/**
 * One Nebius Token Factory chat completion with server-side authentication, a bounded output
 * allowance, JSON output, no tools and no retries. Streaming only changes delivery: the full
 * content is validated by the caller after the provider reports completion.
 */
export async function chatCompletion(request: ChatRequest): Promise<{ content: string; trace: InferenceTrace }> {
  const { apiKey } = configuration();
  const fetcher = request.fetcher ?? fetch;
  if (!apiKey || !NEMOTRON.test(request.model)) throw new InferenceError("Configure a Nebius key and an NVIDIA Nemotron model ID first.", 503, "configuration");
  const started = performance.now();
  const trace: InferenceTrace = { requestedModel: request.model, model: null, runId: null, requestId: null, httpStatus: null, elapsedMs: 0, usage: null, reasoningTokens: null };
  const fail = (message: string, status: number, code: string) => new InferenceError(message, status, code, { ...trace, elapsedMs: Math.round(performance.now() - started) });
  const timeout = AbortSignal.timeout(request.timeoutMs ?? 60000);
  const signal = request.signal ? AbortSignal.any([timeout, request.signal]) : timeout;
  const stream = request.stream === true;
  let response: Response;
  try {
    response = await fetcher(NEBIUS_CHAT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: request.model,
        messages: [{ role: "system", content: request.system }, { role: "user", content: request.user }],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: request.maxTokens,
        ...(request.reasoningEffort ? { reasoning_effort: request.reasoningEffort } : {}),
        stream,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
        store: false,
      }),
      signal,
    });
  } catch { throw fail("Nebius could not complete the request. No results were substituted.", 504, "transport"); }
  trace.httpStatus = response.status;
  trace.requestId = response.headers.get("x-request-id");
  if (!response.ok) throw fail(response.status === 429 ? "Nebius rate limit reached. Try again later." : `Nebius returned HTTP ${response.status}. Check the server-side configuration.`, response.status === 429 ? 429 : 502, response.status === 429 ? "rate_limit" : "http");
  let content: string | null;
  let finishReason: string | null;
  let refusal: string | null | undefined;
  const eventStream = stream && (response.headers.get("content-type") ?? "").includes("text/event-stream");
  try {
    if (eventStream) {
      const state = await readEventStream(response, request.onProgress);
      trace.model = state.model;
      trace.runId = state.id;
      trace.usage = toUsage(state.usage);
      trace.reasoningTokens = state.usage?.completion_tokens_details?.reasoning_tokens ?? null;
      content = state.content;
      finishReason = state.finishReason;
      refusal = state.refusal || null;
    } else {
      const parsed = responseSchema.parse(await response.json());
      trace.model = parsed.model;
      trace.runId = parsed.id;
      trace.usage = toUsage(parsed.usage);
      trace.reasoningTokens = parsed.usage?.completion_tokens_details?.reasoning_tokens ?? null;
      content = parsed.choices[0].message.content;
      finishReason = parsed.choices[0].finish_reason;
      refusal = parsed.choices[0].message.refusal;
    }
  } catch {
    if (signal.aborted) throw fail("Nebius could not complete the request. No results were substituted.", 504, "transport");
    throw fail("Nebius returned an unexpected response format.", 502, "response_shape");
  }
  trace.elapsedMs = Math.round(performance.now() - started);
  if (finishReason !== "stop" || refusal || !content) throw fail("The model refused or returned an incomplete result. Nothing was accepted.", 502, "incomplete");
  if (!NEMOTRON.test(trace.model ?? "")) throw fail("The reported model is not an NVIDIA Nemotron model.", 502, "wrong_model");
  return { content, trace: { ...trace } };
}

export type ExtractionOptions = Partial<Pick<ChatRequest, "model" | "maxTokens" | "timeoutMs" | "stream" | "signal" | "onProgress">> & { accountId?: string; featureIds?: readonly string[] };

export function extractionMessages(sources: Source[], system: string = EXTRACTION_PROMPT) {
  return { system, user: JSON.stringify({ untrustedSources: sources }) };
}

export async function extractWithNebius(sources: Source[], fetcher: typeof fetch = fetch, options: ExtractionOptions = {}) {
  const { apiKey, model: configured } = configuration();
  const model = options.model ?? configured;
  if (!apiKey || !NEMOTRON.test(model)) throw new InferenceError("Configure a Nebius key and an NVIDIA Nemotron model ID first.", 503, "configuration");
  const accountId = options.accountId ?? ACCOUNT.id;
  const featureIds = options.featureIds ?? FEATURE_IDS;
  const { system, user } = extractionMessages(sources, extractionPrompt(accountId, featureIds));
  const { content, trace } = await chatCompletion({ model, system, user, maxTokens: options.maxTokens ?? NEBIUS_MAX_OUTPUT_TOKENS, timeoutMs: options.timeoutMs ?? 60000, stream: options.stream, signal: options.signal, onProgress: options.onProgress, fetcher });
  try {
    const commitments = validateExtraction(JSON.parse(content), sources, accountId, [...featureIds]);
    return { commitments, model: trace.model, runId: trace.runId as string, usage: trace.usage, trace };
  } catch { throw new InferenceError("Model output failed source validation. No ungrounded commitments were accepted.", 502, "grounding", trace); }
}
