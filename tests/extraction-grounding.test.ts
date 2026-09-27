import assert from "node:assert/strict";
import test from "node:test";
import { northstarCrashingCase } from "../lib/evaluation-pipeline.ts";
import { ACCOUNT, createScenario, FEATURE_IDS, referenceCommitments } from "../lib/fixtures.ts";
import { extractWithNebius } from "../lib/nebius.ts";
import { runPipeline } from "../lib/pipeline/run.ts";
import { allSourcesRouting, routeSources } from "../lib/pipeline/triage.ts";
import { groundCommitments, validateExtraction, withSpeakerLabel } from "../lib/reconcile.ts";
import { nebiusMock } from "./helpers/nebius-mock.ts";
import { RECORDED_UNLABELLED_EXTRACTION } from "./helpers/recorded-extraction.ts";

const { sources } = createScenario("crashing");
const recorded = JSON.parse(RECORDED_UNLABELLED_EXTRACTION);
const normalized = (commitments: { featureId: string; intent: string; owner: string | null; dueDate: string | null }[]) => commitments.map(({ featureId, intent, owner, dueDate }) => ({ featureId, intent, owner, dueDate })).sort((left, right) => left.featureId.localeCompare(right.featureId));

async function withKey<T>(work: () => Promise<T>) {
  const saved = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = "unit-test-key";
  try { return await work(); } finally { if (saved === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = saved; }
}

test("the recorded failing Super output is now fully grounded by citing each speaker label", () => {
  assert.throws(() => validateExtraction(recorded, sources, ACCOUNT.id, FEATURE_IDS), /Owner is not present/, "strict validation still rejects it as returned");
  const { commitments, dropped } = groundCommitments(recorded, sources, ACCOUNT.id, FEATURE_IDS);
  assert.deepEqual(dropped, []);
  assert.deepEqual(normalized(commitments), normalized(referenceCommitments));
  const audit = commitments.find((commitment) => commitment.featureId === "audit-export")!;
  assert.equal(audit.evidence[0].quote, "Maya Chen: I will make audit log export available to Northstar by 2026-09-14.");
  assert.doesNotThrow(() => validateExtraction({ commitments }, sources, ACCOUNT.id, FEATURE_IDS));
});

test("a speaker label is added only when that exact owner label precedes the exact quote", () => {
  const base = { id: "c1", featureId: "eu-residency", title: "EU data residency", dueDate: "2026-09-18", intent: "committed" as const, evidence: [{ sourceId: "SRC-01", quote: "I commit to EU data residency for Northstar by 2026-09-18." }] };
  assert.equal(withSpeakerLabel({ ...base, owner: "Theo Park" }, sources).evidence[0].quote, "Theo Park: I commit to EU data residency for Northstar by 2026-09-18.");
  const wrongOwner = withSpeakerLabel({ ...base, owner: "Maya Chen" }, sources);
  assert.equal(wrongOwner.evidence[0].quote, base.evidence[0].quote, "a different speaker is never attributed");
  const { dropped } = groundCommitments({ commitments: [{ ...base, owner: "Maya Chen" }] }, sources, ACCOUNT.id, FEATURE_IDS);
  assert.match(dropped[0], /eu-residency: owner is not present/);
  assert.equal(withSpeakerLabel({ ...base, owner: "Theo Park", evidence: [{ sourceId: "SRC-02", quote: base.evidence[0].quote }] }, sources).evidence[0].sourceId, "SRC-02", "labels come only from the cited source");
});

test("one ungrounded commitment is dropped and reported; the others are kept", () => {
  const [first, second, ...rest] = referenceCommitments;
  const input = { commitments: [{ ...first, owner: "Invented Person" }, second, { ...rest[0], evidence: [{ sourceId: "SRC-01", quote: "Jon Bell promised everything tomorrow." }] }, { ...second, id: "again" }, ...rest.slice(1)] };
  const { commitments, dropped } = groundCommitments(input, sources, ACCOUNT.id, FEATURE_IDS);
  assert.deepEqual(commitments.map((commitment) => commitment.featureId), [second.featureId, ...rest.slice(1).map((commitment) => commitment.featureId)]);
  assert.equal(dropped.length, 3);
  assert.match(dropped.join("\n"), /audit-export: owner is not present/);
  assert.match(dropped.join("\n"), /saml: evidence is missing, cross-account, or not an exact source quote/);
  assert.match(dropped.join("\n"), /eu-residency appeared more than once/);
  assert.throws(() => groundCommitments({ commitments: [{ ...first, sendEmail: true }] }, sources, ACCOUNT.id, FEATURE_IDS), "a malformed envelope still rejects the whole output");
});

test("extraction fails only when every proposed commitment is ungrounded", async () => {
  const reply = (content: string) => async () => Response.json({ id: "run", model: "nvidia/test-Nemotron", choices: [{ finish_reason: "stop", message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 10 } });
  await withKey(async () => {
    const partial = await extractWithNebius(sources, reply(JSON.stringify({ commitments: [{ ...referenceCommitments[0], owner: "Invented" }, referenceCommitments[1]] })), { model: "nvidia/test-Nemotron" });
    assert.deepEqual(partial.commitments.map((commitment) => commitment.featureId), ["eu-residency"]);
    assert.equal(partial.dropped.length, 1);
    await assert.rejects(extractWithNebius(sources, reply(JSON.stringify({ commitments: [{ ...referenceCommitments[0], owner: "Invented" }] })), { model: "nvidia/test-Nemotron" }), /failed source validation/);
    const empty = await extractWithNebius(sources, reply(JSON.stringify({ commitments: [] })), { model: "nvidia/test-Nemotron" });
    assert.deepEqual(empty.commitments, []);
  });
});

test("the live crashing pipeline accepts the recorded output and reports drops as checks", async () => {
  const sample = await northstarCrashingCase();
  const run = (content: string) => withKey(() => runPipeline({ mode: "live", scenario: "crashing", env: { NEBIUS_MODEL: "nvidia/test-Nemotron", NEBIUS_NARRATIVE_MODEL: "off" }, fetcher: nebiusMock({ extraction: { content } }).fetcher, evaluationEvidence: sample.evidence, now: sample.evidence.asOf }));
  const analysis = await run(RECORDED_UNLABELLED_EXTRACTION);
  assert.deepEqual(normalized(analysis.commitments), normalized(referenceCommitments));
  assert.equal(analysis.pipeline.steps.find((step) => step.id === "extraction")?.status, "done");
  const partial = await run(JSON.stringify({ commitments: [...recorded.commitments.slice(0, 5), { ...recorded.commitments[5], owner: "Invented Person" }] }));
  assert.equal(partial.commitments.length, 5);
  assert.ok(partial.pipeline.checks.some((check) => !check.ok && check.label === "Dropped: saml: owner is not present in cited evidence"), JSON.stringify(partial.pipeline.checks.map((check) => check.label)));
  assert.match(partial.pipeline.steps.find((step) => step.id === "extraction")?.detail ?? "", /1 ungrounded commitment dropped/);
});

test("runtime and public-claim sources never reach extraction, even on triage fallback", async () => {
  const { evidence } = await northstarCrashingCase();
  const provider = evidence.sources.filter((source) => source.kind === "Runtime" || source.kind === "PublicClaim").map((source) => source.id);
  assert.deepEqual(provider, ["RT-7755979867-audit-export", "PUB-01"]);
  const everythingACommitment = evidence.sources.map((source) => ({ sourceId: source.id, role: "commitment" as const, features: [], injectionSuspected: false }));
  for (const routing of [routeSources(evidence.sources, everythingACommitment), allSourcesRouting(evidence.sources)]) {
    assert.equal(routing.extraction.some((source) => provider.includes(source.id)), false);
    assert.deepEqual(routing.directToRules.map((source) => source.id).filter((id) => provider.includes(id)), provider);
  }
  assert.equal(allSourcesRouting(createScenario("blocked").sources).extraction.length, 6);
});
