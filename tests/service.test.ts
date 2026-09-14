import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRequest, capabilities } from "../lib/service.ts";
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

test("configured live inference requires a private access token", async () => {
  const saved = { ...process.env };
  process.env.NEBIUS_API_KEY = "test-not-a-real-key";
  process.env.NEBIUS_MODEL = "nvidia/test-Nemotron";
  process.env.DEMO_ACCESS_TOKEN = "test-access-token-at-least-24-chars";
  try {
    const response = await analyzeRequest(request({ mode: "live", scenario: "blocked" }));
    assert.equal(response.status, 401);
    assert.doesNotMatch(JSON.stringify(await response.json()), /test-not-a-real-key/);
  } finally {
    for (const name of ["NEBIUS_API_KEY", "NEBIUS_MODEL", "DEMO_ACCESS_TOKEN"]) {
      if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name];
    }
  }
});
