import assert from "node:assert/strict";
import test from "node:test";
import { collectEvidence, EvidenceError } from "../lib/evidence/registry.ts";
import { syntheticPackProvider } from "../lib/evidence/providers/synthetic-pack.ts";
import { EVIDENCE_PROVIDERS } from "../lib/evidence/providers/index.ts";
import type { EvidenceBundle, EvidenceProvider } from "../lib/evidence/types.ts";
import { AS_OF, FEATURE_IDS } from "../lib/fixtures.ts";
import type { Source } from "../lib/schema.ts";

const context = { accountId: "northstar", featureIds: FEATURE_IDS, scenario: "blocked" as const, mode: "live" as const, asOf: AS_OF, now: "2026-09-26T00:00:00Z", env: {} };
const claimSource: Source = { id: "PUB-01", accountId: "northstar", kind: "PublicClaim", title: "Public changelog", author: "Vendor", observedAt: "2026-09-26T00:00:00Z", text: "Audit log export is generally available (2026-09-12).", url: "https://promise-ledger-chi.vercel.app/changelog" };

function provider(bundle: Partial<EvidenceBundle> | (() => Promise<EvidenceBundle>), patch: Partial<EvidenceProvider> = {}): EvidenceProvider {
  return { id: "tavily-public-claim", label: "Public claim check", trust: "untrusted", kinds: ["PublicClaim"], required: false, timeoutMs: 200, enabled: () => true, fetch: typeof bundle === "function" ? bundle : async () => ({ sources: [], ...bundle }), ...patch };
}

test("the synthetic pack supplies curated facts; Sentry stays off without its env", async () => {
  assert.deepEqual(EVIDENCE_PROVIDERS.map((item) => item.id), ["synthetic-pack", "sentry-runtime", "user-supplied"]);
  const collected = await collectEvidence(context);
  assert.equal(collected.sources.length, 6);
  assert.equal(collected.facts.length, 5);
  assert.ok(collected.sources.every((source) => source.providerId === "synthetic-pack"));
  assert.deepEqual(collected.providers.map(({ id, status, trust, recorded }) => ({ id, status, trust, recorded })), [{ id: "synthetic-pack", status: "ok", trust: "curated", recorded: false }]);
});

test("an untrusted provider adds cited sources and deterministic signals, never facts", async () => {
  const signal = { kind: "publicClaimGA" as const, featureId: "audit-export", evidence: { sourceId: "PUB-01", quote: "Audit log export is generally available" } };
  const collected = await collectEvidence(context, [syntheticPackProvider, provider({ sources: [claimSource], signals: [signal], provenance: { requestId: "tvly-1", credits: 0.2, recorded: false } })]);
  assert.equal(collected.sources.at(-1)?.providerId, "tavily-public-claim");
  assert.deepEqual(collected.signals, [signal]);
  assert.equal(collected.providers[1].signalCount, 1);
  const withFacts = await collectEvidence(context, [syntheticPackProvider, provider({ sources: [claimSource], facts: [{ featureId: "audit-export", accountId: "northstar", built: true, enabled: true, verified: true, observedAt: AS_OF, evidence: [{ sourceId: "PUB-01", quote: "Audit log export is generally available" }] }] })]);
  assert.equal(withFacts.providers[1].status, "failed");
  assert.match(withFacts.providers[1].error ?? "", /Only curated providers/);
  assert.equal(withFacts.facts.length, 5);
});

test("invalid provider output is rejected before any model or rule sees it", async () => {
  const cases: [Partial<EvidenceBundle>, RegExp][] = [
    [{ sources: [{ ...claimSource, id: "SRC-01" }] }, /not unique/],
    [{ sources: [{ ...claimSource, accountId: "globex" }] }, /another account/],
    [{ sources: [{ ...claimSource, kind: "Runtime" }] }, /does not declare/],
    [{ sources: [{ ...claimSource, url: "http://insecure.example" }] }, /non-HTTPS/],
    [{ sources: [{ ...claimSource, text: "x".repeat(9000) }] }, /too long/],
    [{ sources: [claimSource], signals: [{ kind: "publicClaimGA", featureId: "audit-export", evidence: { sourceId: "PUB-01", quote: "generally available everywhere" } }] }, /did not supply/],
    [{ sources: [claimSource], signals: [{ kind: "publicClaimGA", featureId: "mystery", evidence: { sourceId: "PUB-01", quote: "Audit log export is generally available" } }] }, /unknown feature/],
  ];
  for (const [bundle, message] of cases) {
    const collected = await collectEvidence(context, [syntheticPackProvider, provider(bundle)]);
    assert.equal(collected.providers[1].status, "failed", String(message));
    assert.match(collected.providers[1].error ?? "", message);
    assert.equal(collected.sources.length, 6);
  }
});

test("recorded fixtures are refused in live runs but allowed in reference runs", async () => {
  const recorded = provider({ sources: [{ ...claimSource, provenance: { recorded: true, fetchedAt: "2026-09-26T00:00:00Z" } }] });
  assert.match((await collectEvidence(context, [syntheticPackProvider, recorded])).providers[1].error ?? "", /not allowed in live runs/);
  const reference = await collectEvidence({ ...context, mode: "reference" }, [syntheticPackProvider, recorded]);
  assert.equal(reference.providers[1].status, "ok");
  assert.equal(reference.providers[1].recorded, true);
});

test("slow providers time out and abort; disabled providers are skipped; required failures throw", async () => {
  let aborted = false;
  const slow = provider(() => new Promise<EvidenceBundle>((_, reject) => setTimeout(() => reject(new Error("late")), 1000)), { timeoutMs: 20, fetch: ({ signal }) => new Promise<EvidenceBundle>((resolve) => { signal.addEventListener("abort", () => { aborted = true; }); setTimeout(() => resolve({ sources: [claimSource] }), 1000); }) });
  const timed = await collectEvidence(context, [syntheticPackProvider, slow]);
  assert.match(timed.providers[1].error ?? "", /timed out/);
  assert.ok(aborted);
  const disabled = await collectEvidence(context, [syntheticPackProvider, provider({ sources: [claimSource] }, { enabled: () => false })]);
  assert.equal(disabled.providers.length, 1);
  await assert.rejects(() => collectEvidence(context, [provider(async () => { throw new Error("secret detail"); }, { required: true })]), (error: unknown) => error instanceof EvidenceError && !/secret detail/.test(error.message));
});
