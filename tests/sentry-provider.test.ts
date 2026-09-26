import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE_PROVIDERS } from "../lib/evidence/providers/index.ts";
import { RECORDED_RUNTIME, sentryRuntimeProvider } from "../lib/evidence/providers/sentry-runtime.ts";
import { collectEvidence } from "../lib/evidence/registry.ts";
import { ACCOUNT, AS_OF, createScenario, FEATURE_IDS, referenceCommitments } from "../lib/fixtures.ts";
import { runPipeline } from "../lib/pipeline/run.ts";
import { reconcile } from "../lib/reconcile.ts";
import type { Analysis } from "../lib/schema.ts";
import { analyzeRequest } from "../lib/service.ts";
import { nebiusMock } from "./helpers/nebius-mock.ts";

const SENTRY_ENV = { SENTRY_READ_TOKEN: "r".repeat(64), SENTRY_ORG: "demo-org", SENTRY_PROJECT: "42", SENTRY_API_BASE: "https://us.sentry.io" };
const NEBIUS_ENV = { NEBIUS_API_KEY: "unit-test-key", NEBIUS_MODEL: "nvidia/test-Nemotron" };
const auditExport = (analysis: Analysis) => analysis.commitments.find((commitment) => commitment.featureId === "audit-export")!;

/** Stubs global fetch for Sentry hosts only; issues are dated relative to the real clock. */
async function withSentry<T>(respond: (url: URL) => Response | undefined, work: () => Promise<T>): Promise<{ result: T; calls: URL[] }> {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!url.hostname.endsWith("sentry.io")) return original(input, init);
    calls.push(url);
    return respond(url) ?? Response.json([]);
  }) as typeof fetch;
  try { return { result: await work(), calls }; } finally { globalThis.fetch = original; }
}

const lastSeen = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, "Z");
function northstarAuditExport(url: URL) {
  if (url.pathname === "/api/0/organizations/demo-org/issues/" && url.searchParams.get("query") === "is:unresolved customer:northstar feature:audit-export") {
    return Response.json([{ id: "1001", shortId: "PROMISE-LEDGER-DEMO-2", title: "AuditExportError: export job failed", culprit: "audit-export.run", level: "error", status: "unresolved", permalink: "https://demo-org.sentry.io/issues/1001/", project: { id: "42", slug: "promise-ledger-demo" }, filtered: { count: "14", userCount: 3, firstSeen: lastSeen, lastSeen } }]);
  }
  if (url.pathname === "/api/0/organizations/demo-org/issues/1001/events/") return Response.json([{ eventID: "ab".repeat(16), dateCreated: lastSeen, tags: [{ key: "customer", value: "northstar" }, { key: "feature", value: "audit-export" }] }]);
  return undefined;
}

test("Sentry is registered after the synthetic pack, optional and untrusted", () => {
  assert.deepEqual(EVIDENCE_PROVIDERS.map((provider) => provider.id), ["synthetic-pack", "sentry-runtime"]);
  assert.deepEqual({ trust: sentryRuntimeProvider.trust, required: sentryRuntimeProvider.required, kinds: sentryRuntimeProvider.kinds }, { trust: "untrusted", required: false, kinds: ["Runtime"] });
});

test("live-only: off without env; reference only in the labelled crashing scenario", () => {
  const on = (mode: "reference" | "live", scenario: "blocked" | "enabled" | "stale" | "crashing", env: Record<string, string> = {}) => sentryRuntimeProvider.enabled(env, { mode, scenario });
  assert.equal(on("live", "enabled"), false);
  assert.equal(on("live", "enabled", SENTRY_ENV), true);
  assert.equal(on("live", "blocked", SENTRY_ENV), true);
  for (const scenario of ["blocked", "enabled", "stale"] as const) assert.equal(on("reference", scenario, SENTRY_ENV), false, scenario);
  assert.equal(on("reference", "crashing"), true);
});

test("reference scenarios blocked, enabled and stale are unchanged and make no Sentry call", async () => {
  const { result, calls } = await withSentry(() => { throw new Error("Sentry called in reference mode"); }, async () => Promise.all((["blocked", "enabled", "stale"] as const).map((scenario) => runPipeline({ mode: "reference", scenario, env: SENTRY_ENV }))));
  assert.equal(calls.length, 0);
  assert.deepEqual(result.map((analysis) => auditExport(analysis).verdict), ["blocked", "verified", "unknown"]);
  for (const analysis of result) {
    assert.ok(analysis.sources.every((source) => source.kind !== "Runtime"));
    assert.deepEqual(analysis.pipeline.providers.map((provider) => provider.id), ["synthetic-pack"]);
    assert.ok(analysis.commitments.every((commitment) => commitment.runtime === undefined));
  }
});

test("reference crashing scenario: recorded Sentry evidence lowers verified to needs verification", async () => {
  const { result: analysis, calls } = await withSentry(() => { throw new Error("Sentry called in reference mode"); }, () => runPipeline({ mode: "reference", scenario: "crashing", env: {} }));
  assert.equal(calls.length, 0);
  const commitment = auditExport(analysis);
  assert.equal(commitment.verdict, "verify");
  assert.equal(commitment.reason, "Enabled for Northstar, but failing at runtime (14 events, 3 users).");
  assert.deepEqual(commitment.fact && [commitment.fact.built, commitment.fact.enabled, commitment.fact.verified], [true, true, true]);
  const runtime = analysis.sources.filter((source) => source.kind === "Runtime");
  assert.equal(runtime.length, 1);
  assert.ok(runtime[0].provenance?.recorded && runtime[0].provenance.fetchedAt === new Date(RECORDED_RUNTIME.capturedAt).toISOString());
  assert.ok(commitment.runtime?.evidence.every((evidence) => runtime.some((source) => source.id === evidence.sourceId && source.text.includes(evidence.quote))));
  assert.deepEqual(analysis.pipeline.providers.map(({ id, status, recorded, signalCount }) => [id, status, recorded, signalCount]), [["synthetic-pack", "ok", false, 0], ["sentry-runtime", "ok", true, 1]]);
  assert.deepEqual(analysis.commitments.filter((item) => item.featureId !== "audit-export").map((item) => [item.featureId, item.verdict]), [["eu-residency", "on-track"], ["saml", "verified"], ["usage-report", "overdue"], ["scim", "verify"], ["dashboard", "discussed"]]);
  assert.match(commitment.narrative?.draftText ?? "", /not yet verified as delivered\. Enabled for Northstar, but failing at runtime/);
});

test("the HTTP endpoint accepts the crashing scenario", async () => {
  const response = await analyzeRequest(new Request("http://localhost/api/analyze", { method: "POST", headers: { "Content-Type": "application/json", Origin: "http://localhost" }, body: JSON.stringify({ mode: "reference", scenario: "crashing" }) }));
  assert.equal(response.status, 200);
  assert.equal(auditExport((await response.json()) as Analysis).verdict, "verify");
});

test("live: fresh customer errors turn an enabled + verified feature into needs verification", async () => {
  const savedKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = NEBIUS_ENV.NEBIUS_API_KEY;
  try {
    const mock = nebiusMock({});
    const { result: analysis, calls } = await withSentry(northstarAuditExport, () => runPipeline({ mode: "live", scenario: "enabled", fetcher: mock.fetcher, env: { ...NEBIUS_ENV, ...SENTRY_ENV } }));
    assert.equal(calls.filter((url) => url.pathname.endsWith("/issues/")).length, FEATURE_IDS.length);
    const commitment = auditExport(analysis);
    assert.equal(commitment.verdict, "verify");
    assert.equal(commitment.reason, "Enabled for Northstar, but failing at runtime (14 events, 3 users).");
    const [source] = analysis.sources.filter((candidate) => candidate.kind === "Runtime");
    assert.equal(source.provenance?.recorded, false);
    assert.equal(source.url, "https://demo-org.sentry.io/issues/1001/");
    assert.equal(analysis.pipeline.providers.find((provider) => provider.id === "sentry-runtime")?.status, "ok");
  } finally { if (savedKey === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = savedKey; }
});

const liveContext = (env: Record<string, string>, scenario: "blocked" | "enabled" = "enabled") => ({ accountId: ACCOUNT.id, featureIds: FEATURE_IDS, scenario, mode: "live" as const, asOf: AS_OF, now: new Date().toISOString(), env });
const verdictFor = (evidence: Awaited<ReturnType<typeof collectEvidence>>) => reconcile(referenceCommitments[0], evidence.facts, ACCOUNT.id, AS_OF, evidence).verdict;

test("live: no Sentry issues never proves or changes delivery", async () => {
  const { result } = await withSentry(() => undefined, () => collectEvidence(liveContext({ ...SENTRY_ENV, SENTRY_ORG: "demo-org-empty" })));
  assert.equal(result.signals.length, 0);
  assert.equal(verdictFor(result), "verified");
  const blocked = await withSentry(northstarAuditExport, () => collectEvidence(liveContext(SENTRY_ENV, "blocked")));
  assert.equal(blocked.result.signals.length, 1);
  assert.equal(verdictFor(blocked.result), "blocked", "runtime errors never soften a disabled feature");
});

test("live: Sentry failures are reported explicitly and never fall back to the recording", async () => {
  const { result } = await withSentry(() => new Response("{}", { status: 401 }), () => collectEvidence(liveContext({ ...SENTRY_ENV, SENTRY_READ_TOKEN: "x".repeat(64) })));
  const report = result.providers.find((provider) => provider.id === "sentry-runtime")!;
  assert.deepEqual([report.status, report.recorded, report.error], ["failed", false, "Sentry unavailable: Sentry rejected the read token (401)."]);
  assert.ok(result.sources.every((source) => source.kind !== "Runtime"));
  assert.equal(verdictFor(result), "verified");
  const misconfigured = await withSentry(() => undefined, () => collectEvidence(liveContext({ ...SENTRY_ENV, SENTRY_PROJECT: "promise-ledger-demo" })));
  assert.match(misconfigured.result.providers[1].error ?? "", /SENTRY_PROJECT/);
});

test("live: repeated runs within ten minutes reuse one Sentry fetch", async () => {
  const env = { ...SENTRY_ENV, SENTRY_ORG: "demo-org-cache" };
  const { calls } = await withSentry(() => undefined, async () => { await collectEvidence(liveContext(env)); await collectEvidence(liveContext(env)); });
  assert.equal(calls.length, FEATURE_IDS.length);
});

test("scenario fixtures: crashing reuses the enabled facts exactly", () => {
  assert.deepEqual(createScenario("crashing"), createScenario("enabled"));
});
