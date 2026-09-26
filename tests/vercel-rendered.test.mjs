import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

delete process.env.NEBIUS_API_KEY;
delete process.env.NEBIUS_MODEL;
delete process.env.DEMO_ACCESS_TOKEN;

let server;
async function request(route, options) {
  server ??= (await import("../.vercel/output/functions/__server.func/index.mjs")).default;
  return server.fetch(new Request(`https://promise-ledger.example${route}`, options), { waitUntil() {} });
}

test("Vercel output has a bounded Node function and filesystem routing", async () => {
  const config = JSON.parse(await readFile(new URL("../.vercel/output/config.json", import.meta.url), "utf8"));
  const functionConfig = JSON.parse(await readFile(new URL("../.vercel/output/functions/__server.func/.vc-config.json", import.meta.url), "utf8"));
  assert.equal(config.version, 3);
  assert.ok(config.routes.some((route) => route.handle === "filesystem"));
  assert.match(functionConfig.runtime, /^nodejs(?:22|24)\.x$/);
  assert.equal(functionConfig.maxDuration, 75);
});

test("Vercel production entry renders Promise Ledger and its controls", async () => {
  const response = await request("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const label of ["Promise Ledger", "Run evidence check", "Reference mode", "Synthetic demo", "Audit log export"]) {
    assert.ok(html.includes(label), `Missing ${label}`);
  }
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /href="[^\"]+\.css/);
  assert.doesNotMatch(html, /NEBIUS_API_KEY|DEMO_ACCESS_TOKEN|codex-preview/);
});

test("Vercel reference API supports all three scenarios without credentials", async () => {
  const status = await request("/api/status");
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { liveConfigured: false, model: null, syntheticOnly: true, liveAccess: null });
  for (const [scenario, verdict] of [["blocked", "blocked"], ["enabled", "verified"], ["stale", "unknown"]]) {
    const response = await request("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://promise-ledger.example" },
      body: JSON.stringify({ mode: "reference", scenario }),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const result = await response.json();
    assert.equal(result.commitments.find((commitment) => commitment.featureId === "audit-export").verdict, verdict);
    assert.equal(result.mode, "reference");
    assert.equal(result.model, null);
  }
});

test("Vercel entry applies the open live-mode gate from runtime environment", async (context) => {
  process.env.NEBIUS_API_KEY = "vercel-test-not-a-real-key";
  process.env.NEBIUS_MODEL = "nvidia/test-Nemotron";
  process.env.LIVE_RUNS_PER_DAY = "0";
  context.after(() => { delete process.env.NEBIUS_API_KEY; delete process.env.NEBIUS_MODEL; delete process.env.LIVE_RUNS_PER_DAY; });
  const status = await (await request("/api/status")).json();
  assert.equal(status.liveConfigured, true);
  assert.deepEqual(status.liveAccess, { open: false, perIpPerHour: 5, perDay: 0, durableLimits: false, ownerToken: false });
  const live = (headers = {}) => request("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify({ mode: "live", scenario: "blocked" }) });
  const paused = await live();
  assert.equal(paused.status, 503);
  const body = await paused.json();
  assert.equal(body.code, "live_limit_closed");
  assert.equal(body.fallback, "reference");
  assert.doesNotMatch(JSON.stringify(body), /vercel-test-not-a-real-key/);
  assert.equal((await live({ Authorization: "Bearer a-token-that-was-never-configured" })).status, 401);
});

test("Vercel entry fails closed for live inference and cross-origin requests", async () => {
  const live = await request("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode: "live", scenario: "blocked" }),
  });
  assert.equal(live.status, 503);
  const crossOrigin = await request("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://other.example" },
    body: JSON.stringify({ mode: "reference", scenario: "blocked" }),
  });
  assert.equal(crossOrigin.status, 403);
});
