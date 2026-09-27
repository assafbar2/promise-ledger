import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createScenario } from "../lib/fixtures.ts";
import { resetLiveLimitMemory } from "../lib/live-limits.ts";
import { chatCompletion } from "../lib/nebius.ts";
import { readPipelineEvents, type PipelineEvent } from "../lib/pipeline/events.ts";
import { createQuoteScanner } from "../lib/pipeline/quotes.ts";
import { plannedSteps } from "../lib/pipeline/steps.ts";
import { idleTrace, replayDelayMs, traceReducer } from "../lib/pipeline/trace-state.ts";
import { pipelineRequest } from "../lib/service.ts";
import { nebiusMock } from "./helpers/nebius-mock.ts";
import { upstashMock } from "./helpers/upstash-mock.ts";

const sources = createScenario("blocked").sources;

function sseResponse(blocks: string[]) {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { for (const block of blocks) controller.enqueue(encoder.encode(block)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
}

function withKey(context: TestContext) {
  const saved = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = "stream-test-key";
  context.after(() => { if (saved === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = saved; });
}

test("SSE parser handles split chunks, reasoning deltas, CRLF and final usage", async (context) => {
  withKey(context);
  const chunk = (payload: unknown) => `data: ${JSON.stringify(payload)}\r\n\r\n`;
  const body = [
    chunk({ id: "run-1", model: "nvidia/Nemotron-3-Ultra-550b-a55b", choices: [{ delta: { reasoning_content: "thinking…" }, finish_reason: null }] }),
    chunk({ id: "run-1", model: "nvidia/Nemotron-3-Ultra-550b-a55b", choices: [{ delta: { content: '{"ok":' }, finish_reason: null }] }),
    chunk({ id: "run-1", model: "nvidia/Nemotron-3-Ultra-550b-a55b", choices: [{ delta: { content: "true}" }, finish_reason: "stop" }] }),
    chunk({ id: "run-1", model: "nvidia/Nemotron-3-Ultra-550b-a55b", choices: [], usage: { prompt_tokens: 12, completion_tokens: 30, completion_tokens_details: { reasoning_tokens: 25 } } }),
    "data: [DONE]\r\n\r\n",
  ].join("");
  const split = [body.slice(0, 37), body.slice(37, 150), body.slice(150)];
  const progress: number[] = [];
  const result = await chatCompletion({ model: "nvidia/Nemotron-3-Ultra-550b-a55b", system: "s", user: "u", maxTokens: 100, stream: true, onProgress: (update) => progress.push(update.outputChunks), fetcher: async () => sseResponse(split) });
  assert.equal(result.content, '{"ok":true}');
  assert.deepEqual(result.trace.usage, { promptTokens: 12, completionTokens: 30 });
  assert.equal(result.trace.reasoningTokens, 25);
  assert.equal(result.trace.runId, "run-1");
  assert.deepEqual(progress, [1, 2, 3], "reasoning deltas count as progress without leaking into content");
});

test("streamed truncation, mid-stream errors and wrong models are rejected", async (context) => {
  withKey(context);
  const base = { id: "r", model: "nvidia/test-Nemotron" };
  const truncated = [`data: ${JSON.stringify({ ...base, choices: [{ delta: { content: "{}" }, finish_reason: "length" }] })}\n\n`, "data: [DONE]\n\n"];
  await assert.rejects(() => chatCompletion({ model: "nvidia/test-Nemotron", system: "s", user: "u", maxTokens: 10, stream: true, fetcher: async () => sseResponse(truncated) }), /incomplete/);
  const broken = [`data: ${JSON.stringify({ ...base, choices: [{ delta: { content: "{" } }] })}\n\n`, "data: {not json\n\n"];
  await assert.rejects(() => chatCompletion({ model: "nvidia/test-Nemotron", system: "s", user: "u", maxTokens: 10, stream: true, fetcher: async () => sseResponse(broken) }), /unexpected response format/);
  const wrong = [`data: ${JSON.stringify({ id: "r", model: "other/model", choices: [{ delta: { content: "{}" }, finish_reason: "stop" }] })}\n\n`, "data: [DONE]\n\n"];
  await assert.rejects(() => chatCompletion({ model: "nvidia/test-Nemotron", system: "s", user: "u", maxTokens: 10, stream: true, fetcher: async () => sseResponse(wrong) }), /not an NVIDIA Nemotron/);
});

test("a JSON body is accepted even when streaming was requested", async (context) => {
  withKey(context);
  const result = await chatCompletion({ model: "nvidia/test-Nemotron", system: "s", user: "u", maxTokens: 10, stream: true, fetcher: async () => Response.json({ id: "r", model: "nvidia/test-Nemotron", choices: [{ finish_reason: "stop", message: { content: "{}" } }] }) });
  assert.equal(result.content, "{}");
});

test("quote scanner surfaces complete citations from partial JSON exactly once and flags inventions", () => {
  const scan = createQuoteScanner(sources, "northstar");
  const quote = "Maya Chen: I will make audit log export available to Northstar by 2026-09-14.";
  const full = `{"commitments":[{"id":"PL-101","evidence":[{"sourceId":"SRC-01","quote":"${quote}"},{"quote":"invented words that are not there","sourceId":"SRC-02"}]}]}`;
  assert.deepEqual(scan(full.slice(0, 80)), []);
  const found = scan(full);
  assert.deepEqual(found, [{ sourceId: "SRC-01", quote, matched: true }, { sourceId: "SRC-02", quote: "invented words that are not there", matched: false }]);
  assert.deepEqual(scan(full), [], "already-reported quotes are not repeated");
  assert.deepEqual(createQuoteScanner(sources, "other-account")(full)[0].matched, false);
});

test("NDJSON reader tolerates split lines and ignores unknown or malformed events", async () => {
  const text = '{"type":"progress","stepId":"triage","outputTokens":3,"elapsedMs":10}\n{"type":"mystery"}\nnot json\n{"type":"check","check":{"stepId":"rules","ok":true,"label":"x"}}\n';
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(encoder.encode(text.slice(0, 20))); controller.enqueue(encoder.encode(text.slice(20))); controller.close(); } });
  const events: PipelineEvent[] = [];
  for await (const event of readPipelineEvents(body)) events.push(event);
  assert.deepEqual(events.map((event) => event.type), ["progress", "check"]);
});

test("trace reducer folds a streamed run into UI state", () => {
  let state = idleTrace("live", plannedSteps("live", { triage: "a", extraction: "b", narrative: "c" }));
  assert.equal(state.status, "idle");
  state = traceReducer(state, { type: "run", runId: "r1", mode: "live", scenario: "blocked", replay: false, budgetUsd: 0.05, steps: plannedSteps("live", { triage: "a", extraction: "b", narrative: "c" }), providers: [] });
  state = traceReducer(state, { type: "step", step: { ...state.steps[0], status: "running" } });
  state = traceReducer(state, { type: "progress", stepId: "triage", outputTokens: 42, elapsedMs: 300 });
  state = traceReducer(state, { type: "quote", stepId: "extraction", sourceId: "SRC-01", quote: "q", matched: true });
  state = traceReducer(state, { type: "verdict", commitmentId: "PL-101", title: "Audit", verdict: "blocked" });
  assert.equal(state.status, "running");
  assert.equal(state.steps[0].status, "running");
  assert.equal(state.progress.triage?.outputTokens, 42);
  assert.equal(state.quotes.length, 1);
  state = traceReducer(state, { type: "error", error: "stopped", code: "x", status: 502 });
  assert.equal(state.status, "failed");
  assert.equal(state.steps[0].status, "failed");
  assert.ok(replayDelayMs({ type: "quote", stepId: "extraction", sourceId: "s", quote: "q", matched: true }) > 0);
});

test("/api/pipeline streams a live run as ordered NDJSON and counts it as one rate-limited run", async (context) => {
  const names = ["NEBIUS_API_KEY", "NEBIUS_MODEL", "LIVE_RUNS_PER_IP_PER_HOUR", "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "DEMO_ACCESS_TOKEN"];
  const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const savedFetch = globalThis.fetch;
  for (const name of names) delete process.env[name];
  const store = upstashMock();
  Object.assign(process.env, { NEBIUS_API_KEY: "stream-test-key", NEBIUS_MODEL: "nvidia/test-Nemotron", LIVE_RUNS_PER_IP_PER_HOUR: "1", ...store.env });
  const mock = nebiusMock();
  globalThis.fetch = async (url, init) => String(url).startsWith(store.url) ? store.fetcher(url, init) : mock.fetcher(url, init);
  resetLiveLimitMemory();
  context.after(() => {
    globalThis.fetch = savedFetch;
    for (const name of names) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    resetLiveLimitMemory();
  });
  const request = () => new Request("http://localhost/api/pipeline", { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": "203.0.113.9" }, body: JSON.stringify({ mode: "live", scenario: "blocked" }) });
  const response = await pipelineRequest(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/x-ndjson/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const events: PipelineEvent[] = [];
  for await (const event of readPipelineEvents(response.body!)) events.push(event);
  const types = events.map((event) => event.type);
  assert.equal(types[0], "run");
  assert.equal(types.at(-1), "result");
  assert.ok(types.indexOf("quote") < types.lastIndexOf("verdict"), "extraction quotes arrive before verdicts");
  assert.ok(events.some((event) => event.type === "check" && event.check.stepId === "narrative"));
  assert.equal(mock.calls.length, 3);
  const result = events.at(-1);
  assert.equal(store.data.get("promise-ledger:spend:v1:1"), result?.type === "result" ? Math.round((result.analysis.pipeline.costUsd ?? 1) * 1_000_000) : -1, "the spend ledger is settled before the stream closes");
  assert.doesNotMatch(JSON.stringify(events), /stream-test-key/);
  const limited = await pipelineRequest(request());
  assert.equal(limited.status, 429, "the second run in the hour is limited, although the first made three model calls");
  assert.equal(mock.calls.length, 3);
});

test("/api/pipeline reports a failed live extraction as a final error event with reference fallback", async (context) => {
  const saved = { key: process.env.NEBIUS_API_KEY, model: process.env.NEBIUS_MODEL, kvUrl: process.env.KV_REST_API_URL, kvToken: process.env.KV_REST_API_TOKEN };
  const savedFetch = globalThis.fetch;
  const store = upstashMock();
  Object.assign(process.env, { NEBIUS_API_KEY: "stream-test-key", NEBIUS_MODEL: "nvidia/test-Nemotron", ...store.env });
  const nebius = nebiusMock({ extraction: { status: 500 } }).fetcher;
  globalThis.fetch = async (url, init) => String(url).startsWith(store.url) ? store.fetcher(url, init) : nebius(url, init);
  resetLiveLimitMemory();
  context.after(() => {
    globalThis.fetch = savedFetch;
    if (saved.key === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = saved.key;
    if (saved.model === undefined) delete process.env.NEBIUS_MODEL; else process.env.NEBIUS_MODEL = saved.model;
    if (saved.kvUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = saved.kvUrl;
    if (saved.kvToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = saved.kvToken;
    resetLiveLimitMemory();
  });
  const response = await pipelineRequest(new Request("http://localhost/api/pipeline", { method: "POST", headers: { "Content-Type": "application/json", "x-real-ip": "203.0.113.10" }, body: JSON.stringify({ mode: "live", scenario: "blocked" }) }));
  const events: PipelineEvent[] = [];
  for await (const event of readPipelineEvents(response.body!)) events.push(event);
  const last = events.at(-1);
  assert.ok(last?.type === "error");
  assert.equal(last.fallback, "reference");
  assert.match(last.error, /HTTP 500/);
  assert.doesNotMatch(JSON.stringify(events), /provider-secret-body/);
  assert.ok(!events.some((event) => event.type === "result"));
});
