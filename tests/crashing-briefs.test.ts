import assert from "node:assert/strict";
import test from "node:test";
import { northstar } from "../lib/accounts/index.ts";
import { northstarCrashingCase } from "../lib/evaluation-pipeline.ts";
import { collectEvidence } from "../lib/evidence/registry.ts";
import { providersFor } from "../lib/evidence/providers/index.ts";
import { chatCompletion } from "../lib/nebius.ts";
import { citableText, validateBriefs } from "../lib/pipeline/guardrails.ts";
import { narrativeInput, narrativeSources } from "../lib/pipeline/narrative.ts";
import { createQuoteScanner } from "../lib/pipeline/quotes.ts";
import { runPipeline } from "../lib/pipeline/run.ts";
import { referenceTriage } from "../lib/pipeline/triage.ts";
import { reconcile } from "../lib/reconcile.ts";
import { briefsFor, nebiusMock } from "./helpers/nebius-mock.ts";

async function crashing() {
  const evidence = await collectEvidence({ accountId: northstar.id, featureIds: northstar.featureIds, scenario: "crashing", mode: "reference", asOf: northstar.asOf, now: "2026-09-27T00:00:00Z", env: {} }, providersFor(northstar.id));
  const targets = northstar.referenceCommitments.map((commitment) => reconcile(commitment, evidence.facts, northstar.id, northstar.asOf, evidence, northstar.name)).filter((commitment) => commitment.intent === "committed");
  const allowed = narrativeSources(targets, evidence.sources, referenceTriage(evidence.sources, northstar.featureIds));
  const runtime = evidence.sources.find((source) => source.kind === "Runtime")!;
  return { evidence, targets, allowed, runtime };
}

const runtimeClaim = (quote: string) => ({ text: "Runtime monitoring still records failing audit export jobs for this workspace.", citations: [{ sourceId: "RT-7755979867-audit-export", quote }] });

test("the runtime source contains double quotes, and Ultra never sees them", async () => {
  const { targets, allowed, runtime } = await crashing();
  assert.ok(runtime.text.includes('title="AuditExportError'));
  assert.ok((allowed.get("PL-101") ?? []).some((source) => source.id === runtime.id), "the runtime source is in PL-101's citation set");
  const input = JSON.parse(narrativeInput(targets, allowed, northstar.name, northstar.asOf));
  for (const source of input.untrustedSources) assert.equal(source.text.includes('"'), false, source.sourceId);
  for (const commitment of input.commitments) for (const quote of commitment.validatedQuotes) assert.equal(quote.quote.includes('"'), false);
  assert.ok(input.commitments[0].validatedQuotes.some((quote: { quote: string }) => quote.quote === citableText(runtime.text)));
});

test("a runtime citation copied in citable form is accepted and stored as the exact source text", async () => {
  const { targets, allowed, runtime } = await crashing();
  const excerpt = runtime.text.slice(0, 140);
  const decisions = validateBriefs({ briefs: briefsFor({ "PL-101": { explanation: [runtimeClaim(citableText(excerpt))] } }) }, targets, allowed);
  assert.ok(decisions.every((decision) => decision.brief), JSON.stringify(decisions.map((decision) => decision.reason)));
  assert.equal(decisions[0].brief!.explanation[0].citations[0].quote, excerpt);
  const verbatim = validateBriefs({ briefs: briefsFor({ "PL-101": { explanation: [runtimeClaim(excerpt)] } }) }, targets, allowed);
  assert.ok(verbatim[0].brief, "an exact copy with escaped quotes still passes");
  const invented = validateBriefs({ briefs: briefsFor({ "PL-101": { explanation: [runtimeClaim("issue=PROMISE-LEDGER-DEMO-2; title='Everything is fine'")] } }) }, targets, allowed);
  assert.match(invented[0].reason ?? "", /not exact text/);
});

test("one malformed brief never drops the others, even when the slip nests them inside it (production, September 27)", async () => {
  const { targets, allowed } = await crashing();
  const [first, ...rest] = briefsFor();
  const broken = { ...first, explanation: [{ text: "Runtime errors are still recorded for the export job.", citations: [{ quote: "issue=PROMISE-LEDGER-DEMO-2; title=" }], AuditExportError: { briefs: rest } }] };
  const decisions = validateBriefs({ briefs: [broken] }, targets, allowed);
  assert.match(decisions[0].reason ?? "", /brief format at explanation\.citations\.sourceId|adds fields/);
  assert.deepEqual(decisions.slice(1).map((decision) => decision.brief !== null), [true, true, true, true], JSON.stringify(decisions.map((decision) => decision.reason)));
  const siblings = validateBriefs({ briefs: [broken, ...rest] }, targets, allowed);
  assert.equal(siblings.filter((decision) => decision.brief).length, 4);
  const shadow = validateBriefs({ briefs: [first, { ...rest[0], nested: { ...first, customerUpdate: [{ text: "Audit log export has been delivered to your workspace.", citations: (first.customerUpdate[0] as { citations: unknown }).citations }] } }] }, targets, allowed);
  assert.ok(shadow[0].brief, "a top-level brief is never replaced by a nested copy");
  assert.throws(() => validateBriefs({ notBriefs: [1, 2] }, targets, allowed));
});

test("live-preview quote highlighting matches citable-form quotes", async () => {
  const { evidence, runtime } = await crashing();
  const scan = createQuoteScanner(evidence.sources, northstar.id);
  const [found] = scan(JSON.stringify({ sourceId: runtime.id, quote: citableText(runtime.text.slice(0, 80)) }));
  assert.equal(found.matched, true);
});

test("the crashing scenario runs end to end with a runtime citation and all five briefs accepted", async () => {
  const sample = await northstarCrashingCase();
  const { runtime } = await crashing();
  const content = JSON.stringify({ briefs: briefsFor({ "PL-101": { explanation: [runtimeClaim(citableText(runtime.text))] } }) });
  const mock = nebiusMock({ narrative: { content } });
  const saved = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = "unit-test-key";
  try {
    const analysis = await runPipeline({ mode: "live", scenario: "crashing", env: { NEBIUS_MODEL: "nvidia/test-Nemotron" }, fetcher: mock.fetcher, evaluationEvidence: sample.evidence, now: sample.evidence.asOf });
    const briefs = analysis.commitments.filter((commitment) => commitment.intent === "committed");
    assert.deepEqual(briefs.map((commitment) => commitment.narrative?.origin), ["model", "model", "model", "model", "model"], JSON.stringify(briefs.map((commitment) => commitment.narrative?.fallbackReason)));
    assert.equal(briefs[0].verdict, "verify");
    assert.equal(briefs[0].narrative?.explanation[0].citations[0].quote, runtime.text);
  } finally { if (saved === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = saved; }
});

test("non-streamed Nano answers returned as `reasoning` are used only when reasoning is off", async () => {
  const saved = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = "unit-test-key";
  const reply: typeof fetch = async () => Response.json({ id: "x", model: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", choices: [{ finish_reason: "stop", message: { content: null, refusal: null, reasoning: '{"sources":[]}' } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  const request = { model: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", system: "s", user: "u", maxTokens: 100, stream: false, fetcher: reply };
  try {
    assert.equal((await chatCompletion({ ...request, reasoningEffort: "none" })).content, '{"sources":[]}');
    await assert.rejects(chatCompletion({ ...request, reasoningEffort: null }), /incomplete/);
  } finally { if (saved === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = saved; }
});
