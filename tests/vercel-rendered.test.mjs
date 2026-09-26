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

test("Vercel production entry renders the landing page, social card and icons", async () => {
  const response = await request("/");
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const text of ["Promises made", "Try it live", 'href="/app"', "NVIDIA Nemotron", "Nebius Token Factory"]) assert.ok(html.includes(text), `Missing ${text}`);
  assert.match(html, /property="og:image" content="https:\/\/promise-ledger-chi\.vercel\.app\/og\.png"/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  for (const file of ["og.png", "favicon.svg", "favicon.ico", "apple-touch-icon.png"]) await readFile(new URL(`../.vercel/output/static/${file}`, import.meta.url));
});

test("Vercel production entry renders Promise Ledger and its controls", async () => {
  const response = await request("/app");
  assert.equal(response.status, 200);
  const html = await response.text();
  for (const label of ["Promise Ledger", "Run evidence check", "Reference mode", "Synthetic demo", "Audit log export", "AGENT PIPELINE", "Replayed reference trace", "Accounts", "Bring your own", "Take the tour"]) {
    assert.ok(html.includes(label), `Missing ${label}`);
  }
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /href="[^\"]+\.css/);
  assert.doesNotMatch(html, /NEBIUS_API_KEY|DEMO_ACCESS_TOKEN|codex-preview/);
});

test("Vercel reference API supports all three scenarios without credentials", async () => {
  const status = await request("/api/status");
  assert.equal(status.status, 200);
  assert.deepEqual(await status.json(), { liveConfigured: false, model: null, syntheticOnly: true, liveAccess: null, pipeline: null, spend: null });
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

test("Vercel entry streams the reference pipeline as NDJSON with a replayed trace", async () => {
  const response = await request("/api/pipeline", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://promise-ledger.example" },
    body: JSON.stringify({ mode: "reference", scenario: "blocked" }),
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /application\/x-ndjson/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(events[0].type, "run");
  assert.equal(events[0].replay, true);
  assert.deepEqual(events[0].steps.map((step) => step.id), ["triage", "extraction", "rules", "narrative"]);
  assert.ok(events.filter((event) => event.type === "quote").length >= 5);
  const result = events.at(-1);
  assert.equal(result.type, "result");
  assert.equal(result.analysis.commitments[0].verdict, "blocked");
  assert.equal(result.analysis.commitments[0].narrative.origin, "template");
  assert.equal(result.analysis.usage, null);
  const live = await request("/api/pipeline", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "live", scenario: "blocked" }) });
  assert.equal(live.status, 503, "live pipeline fails closed without credentials, before streaming");
});

test("Vercel entry serves every sample account and a no-AI bring-your-own extraction", async () => {
  const post = (body) => request("/api/analyze", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://promise-ledger.example" }, body: JSON.stringify(body) });
  for (const [account, name] of [["harbor-health", "Harbor Health"], ["ridgeway-freight", "Ridgeway Freight"], ["lumen-cu", "Lumen Credit Union"]]) {
    const response = await post({ mode: "reference", scenario: "blocked", account });
    assert.equal(response.status, 200, account);
    assert.equal((await response.json()).account.name, name);
  }
  const text = "Jordan Lee: I will make group booking import available to Acme by 2026-09-30.\naccount=acme; feature=group-import; built=true; enabled=false; verified=false";
  const extract = await post({ mode: "reference", byo: { phase: "extract", workspace: "Acme", sources: [{ id: "U-01", type: "notes", title: "Notes", observedAt: new Date().toISOString(), text }] } });
  assert.equal(extract.status, 200);
  const proposal = await extract.json();
  assert.equal(proposal.extractor, "pattern");
  assert.deepEqual(proposal.facts.map((fact) => fact.featureId), ["group-import"]);
  assert.equal(proposal.continuation, null);
});

test("Vercel entry serves the public changelog and shows its claim beside the blocked verdict", async () => {
  const page = await request("/changelog");
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.ok(html.includes("Audit log export is generally available (2026-09-12)."));
  assert.match(html, /fictional vendor/);
  const response = await request("/api/pipeline", { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://promise-ledger.example" }, body: JSON.stringify({ mode: "reference", scenario: "blocked" }) });
  const { analysis } = (await response.text()).trim().split("\n").map((line) => JSON.parse(line)).at(-1);
  assert.ok(analysis.sources.some((source) => source.id === "PUB-01" && source.kind === "PublicClaim" && source.provenance.recorded === true));
  const audit = analysis.commitments.find((commitment) => commitment.featureId === "audit-export");
  assert.equal(audit.verdict, "blocked");
  assert.equal(audit.publicClaim.conflict, true);
  assert.deepEqual(analysis.pipeline.providers.map((provider) => [provider.id, provider.status]), [["synthetic-pack", "ok"], ["tavily-public-claim", "ok"]]);
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
  assert.deepEqual(status.spend, { capUsd: 30, spentUsd: null, remainingUsd: null, runReserveUsd: 0.05, ledger: "1", durable: false, available: false });
  delete process.env.LIVE_RUNS_PER_DAY;
  const unverified = await live();
  assert.equal(unverified.status, 503, "without a durable spend ledger live mode stays closed");
  assert.equal((await unverified.json()).code, "live_spend_unavailable");
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
