import assert from "node:assert/strict";
import test from "node:test";
import { tavilyPublicClaimProvider } from "../lib/evidence/providers/tavily-public-claim.ts";
import { syntheticPackProvider } from "../lib/evidence/providers/synthetic-pack.ts";
import { collectEvidence } from "../lib/evidence/registry.ts";
import { AS_OF, FEATURE_IDS } from "../lib/fixtures.ts";
import { changelogText } from "../lib/public-claims/changelog.ts";
import { resetPublicClaimMemory } from "../lib/public-claims/store.ts";
import { runPipeline } from "../lib/pipeline/run.ts";

const providers = [syntheticPackProvider, tavilyPublicClaimProvider];
const context = { accountId: "northstar", featureIds: FEATURE_IDS, scenario: "blocked" as const, asOf: AS_OF, now: "2026-09-26T08:00:00.000Z" };
const liveEnv = { TAVILY_API_KEY: "tvly-dev-unit-test-key-000000", TAVILY_DAILY_LIMIT: "5" };

async function withFetch<T>(fetcher: typeof fetch, work: () => Promise<T>) {
  const original = globalThis.fetch;
  globalThis.fetch = fetcher;
  try { return await work(); } finally { globalThis.fetch = original; }
}

const tavilyOk: typeof fetch = async (input) => {
  assert.equal(String(input), "https://api.tavily.com/extract");
  return Response.json({ results: [{ url: "https://promise-ledger-chi.vercel.app/changelog", raw_content: changelogText() }], failed_results: [], usage: { credits: 1 }, request_id: "req-live-1" });
};

test("reference runs add the labelled changelog fixture and its GA signals without calling Tavily", async () => {
  const collected = await withFetch(async () => { throw new Error("reference mode must not use the network"); }, () => collectEvidence({ ...context, mode: "reference", env: liveEnv }, providers));
  const source = collected.sources.find((candidate) => candidate.id === "PUB-01")!;
  assert.equal(source.kind, "PublicClaim");
  assert.equal(source.provenance?.recorded, true);
  assert.match(source.author, /no Tavily call/);
  assert.deepEqual(collected.signals.map((signal) => signal.featureId), ["audit-export", "saml"]);
  assert.deepEqual(collected.providers.map(({ id, status, recorded, trust }) => ({ id, status, recorded, trust })), [
    { id: "synthetic-pack", status: "ok", recorded: false, trust: "curated" },
    { id: "tavily-public-claim", status: "ok", recorded: true, trust: "untrusted" },
  ]);
  assert.equal(collected.facts.length, 5, "a public claim never adds a product fact");
});

test("live runs fetch through Tavily and never fall back to the fixture", async () => {
  resetPublicClaimMemory();
  const live = await withFetch(tavilyOk, () => collectEvidence({ ...context, mode: "live", env: liveEnv }, providers));
  const source = live.sources.find((candidate) => candidate.kind === "PublicClaim")!;
  assert.equal(source.provenance?.recorded, false);
  assert.equal(source.provenance?.requestId, "req-live-1");
  assert.equal(live.providers[1].status, "ok");
  assert.equal(live.signals.length, 2);

  resetPublicClaimMemory();
  const unconfigured = await collectEvidence({ ...context, mode: "live", env: {} }, providers);
  assert.equal(unconfigured.providers[1].status, "failed");
  assert.equal(unconfigured.providers[1].error, "Public claim not checked: Tavily is not configured on the server.");
  assert.equal(unconfigured.sources.some((candidate) => candidate.kind === "PublicClaim"), false);

  resetPublicClaimMemory();
  const limited = await withFetch(async () => new Response("{}", { status: 432 }), () => collectEvidence({ ...context, mode: "live", env: liveEnv }, providers));
  assert.match(limited.providers[1].error ?? "", /^Public claim not checked: tavily key or plan credit limit reached/i);
  assert.equal(limited.sources.length, 6);
});

test("the pipeline shows the public claim beside the verdict and flags the conflict without changing it", async () => {
  const events: { type: string; check?: { label: string } }[] = [];
  const blocked = await runPipeline({ mode: "reference", scenario: "blocked", env: {}, emit: (event) => events.push(event), providers });
  const audit = blocked.commitments.find((commitment) => commitment.featureId === "audit-export")!;
  assert.equal(audit.verdict, "blocked");
  assert.equal(audit.publicClaim?.conflict, true);
  assert.equal(audit.publicClaim?.sourceId, "PUB-01");
  assert.doesNotMatch(audit.narrative?.draftText ?? "", /generally available|is live/i);
  assert.ok(events.some((event) => event.type === "check" && /PL-101: public GA claim ≠ customer access/.test(event.check?.label ?? "")));
  assert.equal(blocked.commitments.find((commitment) => commitment.featureId === "dashboard")?.publicClaim, null);

  const enabled = await runPipeline({ mode: "reference", scenario: "enabled", env: {}, providers });
  const verified = enabled.commitments.find((commitment) => commitment.featureId === "audit-export")!;
  assert.equal(verified.verdict, "verified");
  assert.equal(verified.publicClaim?.conflict, false);

  const without = await runPipeline({ mode: "reference", scenario: "blocked", env: {}, providers: [syntheticPackProvider] });
  assert.deepEqual(without.commitments.map((commitment) => commitment.verdict), blocked.commitments.map((commitment) => commitment.verdict), "verdicts are identical with or without the public claim");
});
