import { z } from "zod";
import { ACCOUNT, FEATURE_IDS } from "./fixtures";
import { validateExtraction } from "./reconcile";
import type { Source } from "./schema";
import { EXTRACTION_PROMPT } from "./extraction-prompt";

export const NEBIUS_MAX_OUTPUT_TOKENS = 6000;

const responseSchema = z.object({
  id: z.string(),
  model: z.string(),
  choices: z.array(z.object({ finish_reason: z.string(), message: z.object({ content: z.string().nullable(), refusal: z.string().nullable().optional() }) })).min(1),
  usage: z.object({ prompt_tokens: z.number().nonnegative(), completion_tokens: z.number().nonnegative() }).optional(),
});

export type InferenceTrace = {
  requestedModel: string;
  model: string | null;
  runId: string | null;
  requestId: string | null;
  httpStatus: number | null;
  elapsedMs: number;
  usage: { promptTokens: number; completionTokens: number } | null;
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

export async function extractWithNebius(sources: Source[], fetcher: typeof fetch = fetch) {
  const { apiKey, model } = configuration();
  if (!apiKey || !/^nvidia\/.*nemotron/i.test(model)) throw new InferenceError("Configure a Nebius key and an NVIDIA Nemotron model ID first.", 503, "configuration");
  const started = performance.now();
  const trace: InferenceTrace = { requestedModel: model, model: null, runId: null, requestId: null, httpStatus: null, elapsedMs: 0, usage: null };
  const fail = (message: string, status: number, code: string) => new InferenceError(message, status, code, { ...trace, elapsedMs: Math.round(performance.now() - started) });
  let response: Response;
  try {
    response = await fetcher("https://api.tokenfactory.nebius.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: EXTRACTION_PROMPT }, { role: "user", content: JSON.stringify({ untrustedSources: sources }) }], response_format: { type: "json_object" }, temperature: 0, max_tokens: NEBIUS_MAX_OUTPUT_TOKENS, stream: false, store: false }),
      signal: AbortSignal.timeout(60000),
    });
  } catch { throw fail("Nebius could not complete the request. No results were substituted.", 504, "transport"); }
  trace.httpStatus = response.status;
  trace.requestId = response.headers.get("x-request-id");
  if (!response.ok) throw fail(response.status === 429 ? "Nebius rate limit reached. Try again later." : `Nebius returned HTTP ${response.status}. Check the server-side configuration.`, response.status === 429 ? 429 : 502, response.status === 429 ? "rate_limit" : "http");
  let parsed: z.infer<typeof responseSchema>;
  try { parsed = responseSchema.parse(await response.json()); } catch { throw fail("Nebius returned an unexpected response format.", 502, "response_shape"); }
  trace.model = parsed.model;
  trace.runId = parsed.id;
  trace.usage = parsed.usage ? { promptTokens: parsed.usage.prompt_tokens, completionTokens: parsed.usage.completion_tokens } : null;
  const choice = parsed.choices[0];
  if (choice.finish_reason !== "stop" || choice.message.refusal || !choice.message.content) throw fail("The model refused or returned an incomplete result. Nothing was accepted.", 502, "incomplete");
  if (!/^nvidia\/.*nemotron/i.test(parsed.model)) throw fail("The reported model is not an NVIDIA Nemotron model.", 502, "wrong_model");
  try {
    const commitments = validateExtraction(JSON.parse(choice.message.content), sources, ACCOUNT.id, FEATURE_IDS);
    trace.elapsedMs = Math.round(performance.now() - started);
    return { commitments, model: parsed.model, runId: parsed.id, usage: trace.usage, trace };
  } catch { throw fail("Model output failed source validation. No ungrounded commitments were accepted.", 502, "grounding"); }
}
