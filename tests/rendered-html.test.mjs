import assert from "node:assert/strict";
import test from "node:test";

let worker;
async function request(route, options) {
  worker ??= (await import("../dist/server/index.js")).default;
  return worker.fetch(new Request(`http://localhost${route}`, options), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("production build renders the landing page with a one-click entry into the app", async () => {
  const response = await request("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const text of ["Promises made", "Truth checked", "Try it live", 'href="/app"', "Nemotron 3 Nano", "Nemotron 3 Super", "Nemotron 3 Ultra", "Nebius Token Factory", "Tavily", "fictional", "Harbor Health"]) assert.ok(html.includes(text), `Missing ${text}`);
  assert.doesNotMatch(html, /Sentry/);
  assert.match(html, /property="og:image" content="https:\/\/promise-ledger-chi\.vercel\.app\/og\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /rel="icon" href="[^"]*\/favicon\.svg"/);
  assert.match(html, /name="robots" content="noindex, nofollow"/);
});

test("production build renders the product, provenance and safety controls", async () => {
  const response = await request("/app");
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
  assert.match(html, /AGENT PIPELINE/);
  assert.match(html, /Replayed reference trace · no AI calls/);
  assert.match(html, /WHY THE EVIDENCE DISAGREES/);
  assert.match(html, /Template draft\./);
  assert.match(html, /Bring your own/);
  assert.match(html, /Take the tour/);
  assert.match(html, /Built, but not available/);
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
  const stream = await request("/api/pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "reference", scenario: "stale" }) });
  assert.equal(stream.status, 200);
  const events = (await stream.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events.at(-1).type, "result");
  assert.equal(events.at(-1).analysis.commitments[0].verdict, "unknown");
});

test("unused Worker image optimizer is unavailable", async () => {
  const response = await request("/_vinext/image?url=/unexpected.icns&w=640&q=75");
  assert.equal(response.status, 404);
});
