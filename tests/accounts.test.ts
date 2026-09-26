import assert from "node:assert/strict";
import test from "node:test";
import { accountPack, northstar, SAMPLE_ACCOUNTS } from "../lib/accounts/index.ts";
import { referenceAnalysis } from "../lib/accounts/reference.ts";
import { detectInjection } from "../lib/byo/injection.ts";
import { EXTRACTION_PROMPT, extractionPrompt } from "../lib/extraction-prompt.ts";
import { FEATURE_IDS } from "../lib/fixtures.ts";
import { claimViolation } from "../lib/pipeline/guardrails.ts";
import type { PipelineEvent } from "../lib/pipeline/events.ts";
import { runPipeline } from "../lib/pipeline/run.ts";
import { reconcile, validateExtraction } from "../lib/reconcile.ts";
import type { Analysis } from "../lib/schema.ts";
import { analyzeRequest } from "../lib/service.ts";
import { nebiusMock } from "./helpers/nebius-mock.ts";

const verdicts = (analysis: Analysis) => Object.fromEntries(analysis.commitments.map((commitment) => [commitment.featureId, commitment.verdict]));

function request(body: unknown) {
  return new Request("http://localhost:3000/api/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

test("four sample accounts, each with a distinct industry, story and headline verdict", () => {
  assert.deepEqual(SAMPLE_ACCOUNTS.map((pack) => pack.id), ["northstar", "harbor-health", "ridgeway-freight", "lumen-cu"]);
  assert.equal(new Set(SAMPLE_ACCOUNTS.map((pack) => pack.industry)).size, 4);
  const headlines = SAMPLE_ACCOUNTS.map((pack) => referenceAnalysis(pack).commitments.find((commitment) => commitment.featureId === pack.headlineFeatureId)!.verdict);
  assert.deepEqual(headlines, ["blocked", "unknown", "verified", "blocked"]);
  assert.equal(accountPack(undefined), northstar);
  assert.equal(accountPack("globex"), null);
});

test("every pack is grounded: reference quotes, owners, dates and curated facts are exact source text", () => {
  for (const pack of SAMPLE_ACCOUNTS) {
    for (const scenario of pack.scenarios.filter((value) => value !== "crashing")) {
      const { sources, facts } = pack.createScenario(scenario);
      assert.ok(sources.every((source) => source.accountId === pack.id), pack.id);
      assert.doesNotThrow(() => validateExtraction({ commitments: pack.referenceCommitments }, sources, pack.id, pack.featureIds), `${pack.id} ${scenario}`);
      for (const fact of facts) {
        assert.ok(fact.evidence.every((evidence) => sources.find((source) => source.id === evidence.sourceId)?.text.includes(evidence.quote)), `${pack.id} ${fact.featureId}`);
        assert.ok(pack.featureIds.includes(fact.featureId));
      }
    }
  }
});

test("reference verdicts cover every verdict across the gallery, and scenarios change only the headline", () => {
  assert.deepEqual(verdicts(referenceAnalysis(accountPack("harbor-health")!)), { "fhir-export": "unknown", "hipaa-audit-trail": "overdue", "epic-sso": "verified", "sla-dashboard": "on-track", "consent-forms": "discussed" });
  assert.deepEqual(verdicts(referenceAnalysis(accountPack("ridgeway-freight")!)), { "carrier-webhooks": "verified", "rate-limit": "verify", "customs-ocr": "unknown", "driver-offline": "on-track", "route-optimizer": "discussed" });
  assert.deepEqual(verdicts(referenceAnalysis(accountPack("lumen-cu")!)), { "dual-approval": "blocked", "soc2-report": "verified", "sms-alerts": "overdue", "data-retention": "on-track", "budget-widget": "discussed" });
  const all = new Set(SAMPLE_ACCOUNTS.flatMap((pack) => referenceAnalysis(pack).commitments.map((commitment) => commitment.verdict)));
  assert.deepEqual([...all].sort(), ["blocked", "discussed", "on-track", "overdue", "unknown", "verified", "verify"]);
  for (const pack of SAMPLE_ACCOUNTS) {
    const outcome = (scenario: "blocked" | "enabled" | "stale") => referenceAnalysis(pack, scenario).commitments.find((commitment) => commitment.featureId === pack.headlineFeatureId)!.verdict;
    assert.deepEqual([outcome("blocked"), outcome("enabled"), outcome("stale")], ["blocked", "verified", "unknown"], pack.id);
  }
  assert.deepEqual(northstar.scenarios, ["blocked", "enabled", "stale", "crashing"]);
  assert.ok(SAMPLE_ACCOUNTS.slice(1).every((pack) => !pack.scenarios.includes("crashing")));
});

test("reference mode runs the pipeline for every account through the evidence registry", async () => {
  for (const pack of SAMPLE_ACCOUNTS) {
    const events: PipelineEvent[] = [];
    const analysis = await runPipeline({ mode: "reference", scenario: pack.defaultScenario, account: pack.id, env: {}, emit: (event) => events.push(event), fetcher: async () => { throw new Error("no network in reference mode"); } });
    assert.deepEqual(analysis.account, { id: pack.id, name: pack.name, kind: "sample" });
    assert.deepEqual(verdicts(analysis), verdicts(referenceAnalysis(pack)), pack.id);
    assert.ok(events.filter((event) => event.type === "quote").every((event) => event.type === "quote" && event.matched));
    for (const commitment of analysis.commitments.filter((item) => item.intent === "committed")) assert.match(commitment.narrative?.draftText ?? "", new RegExp(`— ${pack.name}`));
  }
});

test("account names flow into next steps and drafts; Northstar text is unchanged", () => {
  const lumen = accountPack("lumen-cu")!;
  const { facts } = lumen.createScenario("blocked");
  const gap = reconcile(lumen.referenceCommitments[0], facts, lumen.id, lumen.asOf, undefined, lumen.name);
  assert.equal(gap.nextAction, "Ask the owner to enable the Lumen Credit Union entitlement, then confirm a successful customer test.");
  assert.equal(EXTRACTION_PROMPT, extractionPrompt("northstar", FEATURE_IDS));
  assert.match(extractionPrompt("harbor-health", accountPack("harbor-health")!.featureIds), /account harbor-health;[\s\S]*Allowed features: fhir-export, hipaa-audit-trail/);
});

test("the access guardrail knows the account's own name", () => {
  const lumen = accountPack("lumen-cu")!;
  const commitment = reconcile(lumen.referenceCommitments[0], lumen.createScenario("blocked").facts, lumen.id, lumen.asOf, undefined, lumen.name);
  const claim = { text: "Dual approval is now enabled for Lumen Credit Union.", citations: [commitment.evidence[0]] };
  assert.match(claimViolation(claim, "explanation", commitment, lumen.name) ?? "", /claims customer access/);
});

test("the Lumen ticket's prompt injection is flagged, stays data and cannot change the verdict", async () => {
  const lumen = accountPack("lumen-cu")!;
  const ticket = lumen.createScenario("blocked").sources.find((source) => source.id === "SRC-04")!;
  assert.match(detectInjection(ticket.text) ?? "", /ignore your previous instructions/i);
  for (const pack of SAMPLE_ACCOUNTS) for (const source of pack.createScenario(pack.defaultScenario).sources) if (!(pack.id === "lumen-cu" && source.id === "SRC-04")) assert.equal(detectInjection(source.text), null, `${pack.id} ${source.id}`);
  const analysis = await runPipeline({ mode: "reference", scenario: "blocked", account: "lumen-cu", env: {} });
  assert.equal(analysis.commitments[0].verdict, "blocked");
  assert.ok(analysis.pipeline.checks.some((check) => /SRC-04 addresses an AI system/.test(check.label)));
});

test("live extraction for another account uses that account's prompt, features and name", async () => {
  const harbor = accountPack("harbor-health")!;
  const { sources } = harbor.createScenario("stale");
  const triage = JSON.stringify({ sources: sources.map((source) => ({ sourceId: source.id, role: source.kind === "Meeting" ? "commitment" : source.kind === "Support" ? "customer-signal" : "delivery-evidence", features: [], injectionSuspected: false })) });
  const briefs = JSON.stringify({ briefs: harbor.referenceCommitments.filter((commitment) => commitment.intent === "committed").map((commitment) => {
    const cite = [commitment.evidence[0]];
    return { commitmentId: commitment.id, explanation: [{ text: "The promise and the customer evidence are in separate places.", citations: cite }], customerUpdate: [{ text: "We are checking the customer-specific evidence before we confirm anything.", citations: cite }], ownerNudge: [{ text: "Please confirm the customer-specific status.", citations: cite }] };
  }) });
  const mock = nebiusMock({ triage: { content: triage }, extraction: { content: JSON.stringify({ commitments: harbor.referenceCommitments }) }, narrative: { content: briefs } });
  const saved = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = "unit-test-key";
  try {
    const analysis = await runPipeline({ mode: "live", scenario: "stale", account: harbor.id, fetcher: mock.fetcher, env: { NEBIUS_API_KEY: "unit-test-key", NEBIUS_MODEL: "nvidia/test-Nemotron" } });
    const system = (mock.calls[1].body.messages as { content: string }[])[0].content;
    assert.match(system, /account harbor-health;/);
    assert.match(system, /Allowed features: fhir-export, hipaa-audit-trail, epic-sso, sla-dashboard, consent-forms\./);
    assert.deepEqual(verdicts(analysis), verdicts(referenceAnalysis(harbor)));
    assert.match(JSON.parse((mock.calls[2].body.messages as { content: string }[])[1].content).account, /Harbor Health/);
    assert.equal(analysis.pipeline.steps.find((step) => step.id === "narrative")?.status, "done");
  } finally { if (saved === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = saved; }
});

test("the API serves each sample account and refuses unknown accounts or unsupported scenarios", async () => {
  for (const pack of SAMPLE_ACCOUNTS) {
    const response = await analyzeRequest(request({ mode: "reference", scenario: pack.defaultScenario, account: pack.id }));
    assert.equal(response.status, 200, pack.id);
    assert.equal((await response.json() as Analysis).account.name, pack.name);
  }
  assert.equal((await analyzeRequest(request({ mode: "reference", scenario: "blocked", account: "globex" }))).status, 400);
  assert.equal((await analyzeRequest(request({ mode: "reference", scenario: "crashing", account: "harbor-health" }))).status, 400);
  assert.equal((await analyzeRequest(request({ mode: "reference", scenario: "crashing" }))).status, 200, "Northstar keeps the recorded Sentry scenario");
});
