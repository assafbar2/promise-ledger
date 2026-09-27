import assert from "node:assert/strict";
import test from "node:test";
import { developmentCases, datasetHash } from "../evals/suites.ts";
import { heldOutCases } from "../evals/held-out-cases.ts";
import { createEvaluationBudget, type PlannedRequest } from "../lib/evaluation-budget.ts";
import { DELIVERY_SOURCE_ID, deliveryContext, HELD_OUT_AS_OF, northstarPackCase, pipelineCase, recordingFetcher, runPipelineEvaluation, summarizePipelineEvaluation, type ModelCall, type PipelineCase } from "../lib/evaluation-pipeline.ts";
import type { Emit } from "../lib/pipeline/events.ts";
import { runPipeline } from "../lib/pipeline/run.ts";
import { AS_OF } from "../lib/fixtures.ts";
import { MODELS, nebiusMock, type Reply, type Step } from "./helpers/nebius-mock.ts";

const timestamp = Date.parse("2026-09-27T01:00:00.000Z");
const PRICES = {
  [MODELS.triage]: { inputUsdPerMillion: 0.06, outputUsdPerMillion: 0.24, contextTokens: 262144 },
  [MODELS.extraction]: { inputUsdPerMillion: 0.3, outputUsdPerMillion: 0.9, contextTokens: 262144 },
  [MODELS.narrative]: { inputUsdPerMillion: 1, outputUsdPerMillion: 3, contextTokens: 1048576 },
};
const GUARD_ENV = { NEBIUS_EVAL_NO_PAID_ROLLOVER: "true", NEBIUS_EVAL_PRICES: JSON.stringify(PRICES), NEBIUS_EVAL_BUDGET_USD: "0.50", NEBIUS_EVAL_FREE_CREDIT_USD: "50", NEBIUS_EVAL_VERIFIED_AT: new Date(timestamp).toISOString() };
const PLAN: PlannedRequest[] = [
  { model: MODELS.triage, inputTokens: 16512, maxOutputTokens: 3000 },
  { model: MODELS.extraction, inputTokens: 16512, maxOutputTokens: 6000 },
  { model: MODELS.narrative, inputTokens: 16512, maxOutputTokens: 7000 },
];
const PIPELINE_ENV = { NEBIUS_MODEL: MODELS.extraction };

function makeBudget(overrides: Record<string, string> = {}) {
  const result = createEvaluationBudget({ ...GUARD_ENV, ...overrides }, Object.keys(PRICES), () => timestamp, PLAN);
  assert.equal(result.reason, null);
  return result.budget!;
}

function runner(budget: ReturnType<typeof makeBudget>, replies: (sample: PipelineCase) => Partial<Record<Step, Reply>>) {
  const upstream: string[] = [];
  const run = async (sample: PipelineCase, observe: Emit, calls: ModelCall[]) => {
    const mock = nebiusMock(replies(sample));
    const recording = recordingFetcher(budget.fetcher(async (input, init) => { upstream.push(String(JSON.parse(String(init?.body)).model)); return mock.fetcher(input, init); }), calls);
    const saved = process.env.NEBIUS_API_KEY;
    process.env.NEBIUS_API_KEY = "unit-test-key";
    try {
      const analysis = await runPipeline({ mode: "live", scenario: "blocked", env: PIPELINE_ENV, emit: observe, fetcher: recording, evaluationEvidence: sample.evidence, now: sample.evidence.asOf });
      return { analysis, calls };
    } finally { if (saved === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = saved; }
  };
  return { run, upstream };
}

const explicit = pipelineCase(developmentCases[0], AS_OF);
const triageFor = (sample: PipelineCase, role = "commitment") => JSON.stringify({ sources: sample.evidence.sources.map((source) => ({ sourceId: source.id, role: source.id === DELIVERY_SOURCE_ID ? "delivery-evidence" : role, features: ["audit-export"], injectionSuspected: false })) });
const explicitExtraction = JSON.stringify({ commitments: [{ id: "c1", featureId: "audit-export", title: "Audit log export", owner: "Maya Chen", dueDate: "2026-09-14", intent: "committed", evidence: [{ sourceId: "EVAL-01", quote: "Maya Chen: I will deliver audit log export for Northstar by 2026-09-14." }] }] });

test("pipeline cases keep the frozen case sources and add one curated availability snapshot", () => {
  const before = datasetHash(heldOutCases);
  const sample = pipelineCase(heldOutCases[0], HELD_OUT_AS_OF);
  assert.equal(datasetHash(heldOutCases), before);
  assert.deepEqual(sample.evidence.sources.slice(0, -1), heldOutCases[0].sources);
  const { source, facts } = deliveryContext(HELD_OUT_AS_OF);
  assert.deepEqual(sample.evidence.sources.at(-1), source);
  assert.equal(source.kind, "Availability");
  assert.ok(facts.every((fact) => fact.evidence.every((evidence) => source.text.includes(evidence.quote) && evidence.quote.length >= 12)));
  assert.ok(Date.parse(source.observedAt) < Date.parse(HELD_OUT_AS_OF));
  assert.equal(facts.some((fact) => fact.featureId === "dashboard"), false);
});

test("the demo pack runs all three models through the guard and scores extraction plus Ultra briefs", async () => {
  const budget = makeBudget();
  const { run, upstream } = runner(budget, () => ({}));
  const results = await runPipelineEvaluation([northstarPackCase()], run, async () => {}, () => budget.blockReason());
  assert.deepEqual(upstream, [MODELS.triage, MODELS.extraction, MODELS.narrative]);
  assert.equal(results[0].status, "passed");
  assert.deepEqual(results[0].routing?.directToRules, ["SRC-02", "SRC-03", "SRC-05"]);
  assert.equal(summarizePipelineEvaluation(results).triage.conversationsSkipped, 0);
  assert.deepEqual(results[0].briefs && [results[0].briefs.targets, results[0].briefs.accepted], [5, 5]);
  const metrics = summarizePipelineEvaluation(results);
  assert.equal(metrics.extraction.exactMatchRate, 1);
  assert.equal(metrics.briefs.acceptanceRate, 1);
  assert.equal(metrics.triage.calls, 1);
  const snapshot = budget.snapshot();
  assert.equal(snapshot.calls, 3);
  assert.equal(snapshot.uncertainCalls, 0);
  const expected = Math.ceil(900 * 0.06 + 400 * 0.24) + Math.ceil(900 * 0.3 + 400 * 0.9) + Math.ceil(900 * 1 + 400 * 3);
  assert.equal(snapshot.accountedUsd, expected / 1_000_000);
  assert.equal(snapshot.byModel[MODELS.narrative].calls, 1);
});

test("rejected Ultra briefs count against acceptance and keep their template fallback reason", async () => {
  const budget = makeBudget();
  const { run } = runner(budget, (sample) => ({ triage: { content: triageFor(sample) }, extraction: { content: explicitExtraction }, narrative: { content: "not json" } }));
  const results = await runPipelineEvaluation([explicit], run);
  assert.equal(results[0].status, "passed");
  assert.deepEqual(results[0].routing?.extraction, ["EVAL-01"]);
  assert.equal(results[0].briefs?.outcomes[0].verdict, "blocked");
  const metrics = summarizePipelineEvaluation(results);
  assert.deepEqual([metrics.briefs.targets, metrics.briefs.accepted, metrics.briefs.acceptanceRate], [1, 0, 0]);
  assert.match(Object.keys(metrics.briefs.rejectionReasons)[0], /did not return valid briefs/);
});

test("triage that routes a case away shows as a pipeline miss, not a Super miss", async () => {
  const budget = makeBudget();
  const { run, upstream } = runner(budget, (sample) => ({ triage: { content: triageFor(sample, "other") }, extraction: { content: JSON.stringify({ commitments: [] }) } }));
  const tentative = pipelineCase(developmentCases[1], AS_OF);
  const results = await runPipelineEvaluation([tentative], run);
  assert.equal(results[0].status, "failed");
  assert.deepEqual(results[0].routing?.directToRules, ["EVAL-01", DELIVERY_SOURCE_ID]);
  assert.equal(summarizePipelineEvaluation(results).triage.conversationsSkipped, 1);
  assert.equal(results[0].briefs?.ultraCalled, false);
  assert.deepEqual(upstream, [MODELS.triage, MODELS.extraction]);
});

test("grounding failures are scored as errors and later cases still run", async () => {
  const budget = makeBudget();
  const bad = JSON.stringify({ commitments: [{ id: "c1", featureId: "audit-export", title: "Audit log export", owner: "Maya Chen", dueDate: "2026-09-14", intent: "committed", evidence: [{ sourceId: "EVAL-01", quote: "a quote that is not in the source" }] }] });
  let count = 0;
  const { run } = runner(budget, (sample) => ({ triage: { content: triageFor(sample) }, extraction: { content: count++ === 0 ? bad : explicitExtraction } }));
  const results = await runPipelineEvaluation([explicit, explicit], run);
  assert.deepEqual(results.map((result) => [result.status, result.error?.code ?? null]), [["error", "grounding"], ["passed", null]]);
  assert.deepEqual(results[0].steps?.map((step) => [step.id, step.status]), [["triage", "done"], ["extraction", "failed"]], "an errored case keeps the steps it reached");
  assert.deepEqual(results[0].usage, { promptTokens: 1800, completionTokens: 800 });
  assert.equal(results[0].failedOutput?.content, bad, "the rejected extraction output is kept for diagnosis");
  assert.equal(summarizePipelineEvaluation(results).extraction.exactMatchRate, 0.5);
});

test("missing provider usage stops the guard; the rest of the suite is not run and nothing is fabricated", async () => {
  const budget = makeBudget();
  const { run, upstream } = runner(budget, (sample) => ({ triage: { content: triageFor(sample), usage: null }, extraction: { content: explicitExtraction } }));
  const results = await runPipelineEvaluation([explicit, explicit], run, async () => {}, () => budget.blockReason());
  assert.deepEqual(upstream, [MODELS.triage]);
  assert.equal(results[0].status, "error");
  assert.equal(results[1].status, "not_run");
  assert.equal(budget.snapshot().uncertainCalls, 1);
  const metrics = summarizePipelineEvaluation(results);
  assert.equal(metrics.extraction.notRun, 1);
  assert.equal(metrics.briefs.acceptanceRate, null);
});

test("the guard refuses unpriced models, usage-less streams and unaffordable cases before any provider call", async () => {
  const budget = makeBudget();
  let calls = 0;
  const guarded = budget.fetcher(async () => { calls++; return new Response("{}"); });
  const request = (body: Record<string, unknown>) => guarded("https://api.tokenfactory.nebius.com/v1/chat/completions", { method: "POST", body: JSON.stringify(body) });
  await assert.rejects(request({ model: "nvidia/unpriced-Nemotron", max_tokens: 10, messages: [] }), /No verified price/);
  await assert.rejects(request({ model: MODELS.triage, max_tokens: 10, stream: true, messages: [] }), /Streaming requests must include usage/);
  await assert.rejects(request({ model: MODELS.triage, messages: [] }), /max_tokens/);
  assert.equal(calls, 0);
  const tight = createEvaluationBudget({ ...GUARD_ENV, NEBIUS_EVAL_BUDGET_USD: "0.04" }, Object.keys(PRICES), () => timestamp, PLAN);
  assert.match(tight.reason ?? "", /cannot cover/);
  assert.ok(createEvaluationBudget({ ...GUARD_ENV, NEBIUS_EVAL_PRICES: JSON.stringify({ [MODELS.triage]: PRICES[MODELS.triage] }) }, Object.keys(PRICES), () => timestamp, PLAN).reason);
  assert.ok(createEvaluationBudget({ ...GUARD_ENV, NEBIUS_EVAL_PRICES: "{not json" }, Object.keys(PRICES), () => timestamp, PLAN).reason);
  assert.ok(createEvaluationBudget({ ...GUARD_ENV, NEBIUS_EVAL_BUDGET_USD: "1.50" }, Object.keys(PRICES), () => timestamp, PLAN).reason);
});

test("a guarded request reserves its UTF-8 input bound and settles to reported usage", async () => {
  const budget = makeBudget();
  const guarded = budget.fetcher(async () => Response.json({ id: "x", model: MODELS.narrative.toLowerCase(), choices: [{ finish_reason: "stop", message: { content: "{}" } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }));
  await guarded("https://api.tokenfactory.nebius.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: MODELS.narrative, max_tokens: 7000, messages: [{ role: "user", content: "x".repeat(1000) }] }) });
  const snapshot = budget.snapshot();
  assert.equal(snapshot.accountedUsd, (100 * 1 + 50 * 3) / 1_000_000);
  assert.equal(snapshot.blockedReason, null, "provider-reported model IDs are compared case-insensitively");
  const over = makeBudget();
  await over.fetcher(async () => Response.json({ id: "x", model: MODELS.triage, choices: [], usage: { prompt_tokens: 2000, completion_tokens: 1 } }))("https://api.tokenfactory.nebius.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: MODELS.triage, max_tokens: 10, messages: [{ role: "user", content: "short" }] }) });
  assert.match(over.blockReason() ?? "", /token bounds/);
});

test("streamed completions settle from the final usage chunk before the caller reads them", async () => {
  const budget = makeBudget();
  const chunks = [
    { id: "s", model: MODELS.triage, choices: [{ delta: { content: '{"sources":' }, finish_reason: null }] },
    { id: "s", model: MODELS.triage, choices: [{ delta: { content: "[]}" }, finish_reason: "stop" }] },
    { id: "s", model: MODELS.triage, choices: [], usage: { prompt_tokens: 400, completion_tokens: 80 } },
  ];
  const body = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;
  const calls: ModelCall[] = [];
  const guarded = recordingFetcher(budget.fetcher(async () => new Response(body, { headers: { "Content-Type": "text/event-stream" } })), calls);
  const response = await guarded("https://api.tokenfactory.nebius.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: MODELS.triage, max_tokens: 3000, stream: true, stream_options: { include_usage: true }, messages: [{ role: "user", content: "hello" }] }) });
  assert.equal(budget.snapshot().accountedUsd, Math.ceil(400 * 0.06 + 80 * 0.24) / 1_000_000);
  assert.equal(await response.text(), body);
  assert.deepEqual(calls, [{ model: MODELS.triage, content: '{"sources":[]}' }]);
  const missing = makeBudget();
  await missing.fetcher(async () => new Response(`data: ${JSON.stringify(chunks[0])}\n\ndata: [DONE]\n\n`, { headers: { "Content-Type": "text/event-stream" } }))("https://api.tokenfactory.nebius.com/v1/chat/completions", { method: "POST", body: JSON.stringify({ model: MODELS.triage, max_tokens: 3000, stream: true, stream_options: { include_usage: true }, messages: [] }) });
  assert.match(missing.blockReason() ?? "", /reconciled/);
});
