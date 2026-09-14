import assert from "node:assert/strict";
import test from "node:test";

let worker;
async function request(route, options) {
  worker ??= (await import("../dist/server/index.js")).default;
  return worker.fetch(new Request(`http://localhost${route}`, options), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("production build renders the product, provenance and safety controls", async () => {
  const response = await request("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Promise Ledger/);
  assert.match(html, /Promises made/);
  assert.match(html, /Truth checked/);
  assert.match(html, /Audit log export/);
  assert.match(html, /Synthetic demo/);
  assert.match(html, /Reference mode/);
  assert.match(html, /Run evidence check/);
  assert.match(html, /No owner agreed/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Starter Project|Your site is taking shape/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
});

test("production status and analysis routes work without external credentials", async () => {
  const status = await request("/api/status");
  assert.equal(status.status, 200);
  assert.equal((await status.json()).syntheticOnly, true);
  const result = await request("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "reference", scenario: "enabled" }) });
  assert.equal(result.status, 200);
  const analysis = await result.json();
  assert.equal(analysis.commitments[0].verdict, "verified");
  assert.equal(analysis.model, null);
});
