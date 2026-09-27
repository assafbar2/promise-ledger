import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { resetLiveLimitMemory } from "../lib/live-limits.ts";
import { analyzeRequest, capabilities, status } from "../lib/service.ts";
import { nebiusMock, type Reply, type Step } from "./helpers/nebius-mock.ts";
import { upstashMock } from "./helpers/upstash-mock.ts";
import type { Analysis } from "../lib/schema.ts";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/analyze", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
}

test("reference endpoint returns grounded data with explicit provenance", async () => {
  const response = await analyzeRequest(request({ mode: "reference", scenario: "blocked" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const result = await response.json() as Analysis;
  assert.equal(result.mode, "reference");
  assert.equal(result.model, null);
  assert.equal(result.usage, null);
  assert.equal(result.commitments.length, 6);
  assert.equal(result.commitments[0].verdict, "blocked");
});

test("HTTP scenarios produce distinct grounded outcomes", async () => {
  for (const [scenario, verdict] of [["blocked", "blocked"], ["enabled", "verified"], ["stale", "unknown"]]) {
    const response = await analyzeRequest(request({ mode: "reference", scenario }));
    const body = await response.json() as Analysis;
    assert.equal(body.commitments[0].verdict, verdict);
  }
});

test("rejects extra fields including caller-supplied source data", async () => {
  for (const body of [{ mode: "reference", scenario: "blocked", sources: [] }, { mode: "pretend", scenario: "blocked" }, { mode: "reference", scenario: "other" }, {}, []]) {
    assert.equal((await analyzeRequest(request(body))).status, 400);
  }
});

test("rejects malformed JSON and large payloads", async () => {
  assert.equal((await analyzeRequest(new Request("http://localhost:3000/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }))).status, 400);
  assert.equal((await analyzeRequest(request("x".repeat(2100)))).status, 413);
});

test("rejects cross-origin writes and non-JSON content", async () => {
  assert.equal((await analyzeRequest(request({ mode: "reference", scenario: "blocked" }, { origin: "https://untrusted.example" }))).status, 403);
  assert.equal((await analyzeRequest(request({ mode: "reference", scenario: "blocked" }, { "Content-Type": "text/plain" }))).status, 415);
});

test("live mode fails explicitly without credentials and never substitutes a demo", async () => {
  const saved = process.env.NEBIUS_API_KEY;
  delete process.env.NEBIUS_API_KEY;
  try {
    assert.equal(capabilities().liveConfigured, false);
    const response = await analyzeRequest(request({ mode: "live", scenario: "blocked" }));
    assert.equal(response.status, 503);
    assert.equal((await response.json() as { commitments?: unknown }).commitments, undefined);
  } finally { if (saved !== undefined) process.env.NEBIUS_API_KEY = saved; }
});

const LIVE_ENV = ["NEBIUS_API_KEY", "NEBIUS_MODEL", "NEBIUS_TRIAGE_MODEL", "NEBIUS_NARRATIVE_MODEL", "NEBIUS_STREAM", "LIVE_RUN_BUDGET_USD", "DEMO_ACCESS_TOKEN", "LIVE_RUNS_PER_IP_PER_HOUR", "LIVE_RUNS_PER_DAY", "LIVE_TOKEN_RUNS_PER_DAY", "KV_REST_API_URL", "KV_REST_API_TOKEN", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN", "TAVILY_API_KEY", "TAVILY_ALLOWED_DOMAINS", "TAVILY_CLAIM_URLS", "TAVILY_DAILY_LIMIT", "LIVE_SPEND_CAP_USD", "LIVE_SPEND_LEDGER"];
const OWNER_TOKEN = "test-access-token-at-least-24-chars";

function withLiveServer(context: TestContext, env: Record<string, string> = {}, replies: Partial<Record<Step, Reply>> = {}) {
  const saved = Object.fromEntries(LIVE_ENV.map((name) => [name, process.env[name]]));
  const savedFetch = globalThis.fetch;
  const providerCalls: string[] = [];
  for (const name of LIVE_ENV) delete process.env[name];
  const store = upstashMock();
  Object.assign(process.env, { NEBIUS_API_KEY: "test-not-a-real-key", NEBIUS_MODEL: "nvidia/test-Nemotron", ...store.env, ...env });
  const mock = nebiusMock(replies);
  globalThis.fetch = async (url, init) => {
    if (String(url).startsWith(store.url)) return store.fetcher(url, init);
    providerCalls.push(String(url));
    return mock.fetcher(url, init);
  };
  resetLiveLimitMemory();
  context.after(() => {
    globalThis.fetch = savedFetch;
    for (const name of LIVE_ENV) if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    resetLiveLimitMemory();
  });
  return Object.assign(providerCalls, { steps: mock.calls, store });
}

function live(ip: string, headers: Record<string, string> = {}) {
  return analyzeRequest(request({ mode: "live", scenario: "blocked" }, { "x-real-ip": ip, ...headers }));
}

test("configured live inference is open without a token and reports its limits", async (context) => {
  const providerCalls = withLiveServer(context);
  const status = capabilities();
  assert.equal(status.liveConfigured, true);
  assert.deepEqual(status.liveAccess, { open: true, perIpPerHour: 5, perDay: 30, durableLimits: true, ownerToken: false });
  assert.deepEqual(status.pipeline, { triage: { id: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", name: "Nemotron 3 Nano 30B-A3B" }, extraction: { id: "nvidia/test-Nemotron", name: "Unlisted Nemotron model" }, narrative: { id: "nvidia/Nemotron-3-Ultra-550b-a55b", name: "Nemotron 3 Ultra 550B-A55B" }, runBudgetUsd: 0.05 });
  const response = await live("198.51.100.20");
  assert.equal(response.status, 200);
  const result = await response.json() as Analysis;
  assert.equal(result.mode, "live");
  assert.equal(result.model, "nvidia/test-Nemotron");
  assert.equal(result.runId, "stub-extraction-run");
  assert.deepEqual(providerCalls.steps.map((call) => call.step), ["triage", "extraction", "narrative"]);
  assert.ok(providerCalls.every((url) => url === "https://api.tokenfactory.nebius.com/v1/chat/completions"));
});

test("per-IP limit returns a friendly 429 with reference fallback before any provider call", async (context) => {
  const providerCalls = withLiveServer(context, { LIVE_RUNS_PER_IP_PER_HOUR: "2" });
  assert.equal((await live("198.51.100.21")).status, 200);
  assert.equal((await live("198.51.100.21")).status, 200);
  const limited = await live("198.51.100.21");
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("cache-control"), "no-store");
  assert.ok(Number(limited.headers.get("retry-after")) > 0);
  const body = await limited.json() as { error: string; code: string; fallback: string; retryAfterSeconds: number; commitments?: unknown };
  assert.equal(body.code, "live_limit_ip");
  assert.equal(body.fallback, "reference");
  assert.match(body.error, /2 live Nemotron runs/);
  assert.match(body.error, /reference mode/);
  assert.equal(body.commitments, undefined);
  assert.equal(providerCalls.length, 6, "two full pipelines (three model calls each) count as two runs");
  assert.equal((await live("198.51.100.22")).status, 200, "other visitors keep live access");
});

test("shared daily cap blocks live runs across visitors but never blocks reference mode", async (context) => {
  withLiveServer(context, { LIVE_RUNS_PER_DAY: "2" });
  assert.equal((await live("192.0.2.31")).status, 200);
  assert.equal((await live("192.0.2.32")).status, 200);
  const capped = await live("192.0.2.33");
  assert.equal(capped.status, 429);
  const body = await capped.json() as { error: string; code: string; fallback: string };
  assert.equal(body.code, "live_limit_daily");
  assert.equal(body.fallback, "reference");
  assert.match(body.error, /00:00 UTC/);
  for (let index = 0; index < 5; index++) {
    const reference = await analyzeRequest(request({ mode: "reference", scenario: "blocked" }, { "x-real-ip": "192.0.2.33" }));
    assert.equal(reference.status, 200);
  }
});

test("owner token is an optional bypass for per-IP limits; a wrong token is rejected clearly", async (context) => {
  const providerCalls = withLiveServer(context, { DEMO_ACCESS_TOKEN: OWNER_TOKEN, LIVE_RUNS_PER_IP_PER_HOUR: "1" });
  assert.equal(capabilities().liveAccess?.ownerToken, true);
  assert.equal((await live("198.51.100.40")).status, 200);
  assert.equal((await live("198.51.100.40")).status, 429);
  for (let index = 0; index < 3; index++) assert.equal((await live("198.51.100.40", { authorization: `Bearer ${OWNER_TOKEN}` })).status, 200);
  const wrong = await live("198.51.100.40", { authorization: "Bearer not-the-owner-token-but-long-enough" });
  assert.equal(wrong.status, 401);
  const body = await wrong.json() as { error: string; code: string };
  assert.equal(body.code, "invalid_owner_token");
  assert.doesNotMatch(JSON.stringify(body), new RegExp(`${OWNER_TOKEN}|test-not-a-real-key`));
  assert.equal(providerCalls.length, 12);
});

test("a bearer header is rejected when no owner token is configured", async (context) => {
  withLiveServer(context);
  assert.equal((await live("198.51.100.41", { authorization: "Bearer anything-at-all-long-enough-here" })).status, 401);
});

test("zero public daily limit pauses open live mode and says so", async (context) => {
  const providerCalls = withLiveServer(context, { LIVE_RUNS_PER_DAY: "0" });
  assert.equal(capabilities().liveAccess?.open, false);
  const paused = await live("198.51.100.50");
  assert.equal(paused.status, 503);
  const body = await paused.json() as { code: string; fallback: string };
  assert.equal(body.code, "live_limit_closed");
  assert.equal(body.fallback, "reference");
  assert.equal(providerCalls.length, 0);
});

test("unreachable durable limit store fails closed for live mode only", async (context) => {
  const providerCalls = withLiveServer(context, { KV_REST_API_URL: "https://limits.invalid", KV_REST_API_TOKEN: "store-token" });
  assert.equal(capabilities().liveAccess?.durableLimits, true);
  const response = await live("198.51.100.60");
  assert.equal(response.status, 503);
  assert.equal((await response.json() as { code: string }).code, "live_limit_unavailable");
  assert.ok(providerCalls.every((url) => !url.startsWith("https://api.tokenfactory.nebius.com/")));
  assert.equal((await analyzeRequest(request({ mode: "reference", scenario: "blocked" }))).status, 200);
});

const SPEND_KEY = "promise-ledger:spend:v1:1";

test("a live run reserves its worst case up front and settles the lifetime ledger to its cost", async (context) => {
  const server = withLiveServer(context);
  assert.deepEqual((await status()).spend, { capUsd: 30, spentUsd: 0, remainingUsd: 30, runReserveUsd: 0.05, ledger: "1", durable: true, available: true });
  const response = await live("198.51.100.70");
  assert.equal(response.status, 200);
  const result = await response.json() as Analysis;
  const increments = server.store.commands.filter(([name, key]) => name === "INCRBY" && key === SPEND_KEY).map(([, , by]) => Number(by));
  assert.equal(increments[0], 50_000, "the $0.05 worst case is reserved before any provider call");
  assert.equal(server.store.data.get(SPEND_KEY), Math.round((result.pipeline.costUsd ?? 1) * 1_000_000));
  assert.equal((await status()).spend?.spentUsd, result.pipeline.costUsd);
});

test("reaching the lifetime spend cap turns live mode off with a friendly reference fallback", async (context) => {
  const server = withLiveServer(context, { LIVE_SPEND_CAP_USD: "0.05", DEMO_ACCESS_TOKEN: OWNER_TOKEN });
  assert.equal((await live("198.51.100.71")).status, 200);
  const calls = server.length;
  for (const headers of [{}, { authorization: `Bearer ${OWNER_TOKEN}` }] as Record<string, string>[]) {
    const capped = await live("198.51.100.72", headers);
    assert.equal(capped.status, 503);
    const body = await capped.json() as { error: string; code: string; fallback: string };
    assert.equal(body.code, "live_spend_cap");
    assert.equal(body.fallback, "reference");
    assert.match(body.error, /free-credit allowance/);
  }
  assert.equal(server.length, calls, "no provider call once the cap is reached, even with the owner token");
  assert.equal((await status()).spend?.available, false);
  assert.equal((await analyzeRequest(request({ mode: "reference", scenario: "blocked" }))).status, 200);
});

test("a failed live run still settles to what it actually used", async (context) => {
  const server = withLiveServer(context, {}, { extraction: { status: 500 } });
  assert.notEqual((await live("198.51.100.73")).status, 200);
  assert.equal(server.store.data.get(SPEND_KEY), 150, "only the triage call's cost remains; the rejected extraction is released");
});

test("without durable storage the spend cap fails closed before any provider call", async (context) => {
  const server = withLiveServer(context, { KV_REST_API_URL: "", KV_REST_API_TOKEN: "" });
  const response = await live("198.51.100.74");
  assert.equal(response.status, 503);
  const body = await response.json() as { error: string; code: string; fallback: string };
  assert.equal(body.code, "live_spend_unavailable");
  assert.equal(body.fallback, "reference");
  assert.equal(server.length, 0);
  const spend = (await status()).spend;
  assert.equal(spend?.durable, false);
  assert.equal(spend?.available, false);
  assert.equal((await analyzeRequest(request({ mode: "reference", scenario: "blocked" }))).status, 200);
});
