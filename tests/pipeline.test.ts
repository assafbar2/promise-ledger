import assert from "node:assert/strict";
import test from "node:test";
import type { EvidenceProvider } from "../lib/evidence/types.ts";
import type { PipelineEvent } from "../lib/pipeline/events.ts";
import { PipelineError, runPipeline } from "../lib/pipeline/run.ts";
import { AUDIT_EXPORT_BRIEF, briefsFor, nebiusMock, type Reply, type Step } from "./helpers/nebius-mock.ts";

const ENV = { NEBIUS_API_KEY: "unit-test-key", NEBIUS_MODEL: "nvidia/test-Nemotron" };

async function live(replies: Partial<Record<Step, Reply>> = {}, env: Record<string, string> = {}, extra: { providers?: EvidenceProvider[] } = {}) {
  const savedKey = process.env.NEBIUS_API_KEY;
  process.env.NEBIUS_API_KEY = ENV.NEBIUS_API_KEY;
  const mock = nebiusMock(replies);
  const events: PipelineEvent[] = [];
  try {
    const analysis = await runPipeline({ mode: "live", scenario: "blocked", fetcher: mock.fetcher, emit: (event) => events.push(event), env: { ...ENV, ...env }, ...extra });
    return { analysis, events, calls: mock.calls };
  } finally { if (savedKey === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = savedKey; }
}

const step = (analysis: Awaited<ReturnType<typeof live>>["analysis"], id: string) => analysis.pipeline.steps.find((candidate) => candidate.id === id)!;

test("live pipeline runs Nano, Super and Ultra in order with streaming, usage and cost", async () => {
  const { analysis, events, calls } = await live();
  assert.deepEqual(calls.map((call) => [call.step, call.body.model, call.body.stream]), [
    ["triage", "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", true],
    ["extraction", "nvidia/test-Nemotron", true],
    ["narrative", "nvidia/Nemotron-3-Ultra-550b-a55b", true],
  ]);
  for (const call of calls) {
    assert.deepEqual(call.body.stream_options, { include_usage: true });
    assert.equal(call.body.store, false);
    assert.equal(typeof call.body.max_tokens, "number");
    assert.equal(JSON.stringify(call.body).includes("unit-test-key"), false);
  }
  assert.deepEqual(calls.map((call) => call.body.reasoning_effort), ["none", undefined, "none"], "measured defaults; extraction keeps its verified settings");
  assert.deepEqual(analysis.pipeline.steps.map((item) => item.status), ["done", "done", "done", "done"]);
  assert.equal(step(analysis, "extraction").runId, "stub-extraction-run");
  assert.deepEqual(analysis.usage, { promptTokens: 2700, completionTokens: 1200 });
  assert.ok(analysis.pipeline.costUsd! > 0 && analysis.pipeline.costUsd! <= analysis.pipeline.budgetUsd!);
  assert.equal(analysis.commitments[0].verdict, "blocked");
  assert.equal(analysis.commitments[0].narrative?.origin, "model");
  assert.match(analysis.commitments[0].narrative?.draftText ?? "", /not yet switched on for your workspace/);
  assert.equal(analysis.commitments.find((commitment) => commitment.intent === "tentative")?.narrative, null);
  assert.equal(events[0].type, "run");
  assert.equal(events.at(-1)?.type, "result");
  assert.ok(events.some((event) => event.type === "progress"));
});

test("triage routes delivery records past extraction; the recall guard keeps commitment language", async () => {
  const { calls, analysis } = await live();
  const extractionInput = JSON.parse((calls[1].body.messages as { content: string }[])[1].content) as { untrustedSources: { id: string }[] };
  assert.deepEqual(extractionInput.untrustedSources.map((source) => source.id), ["SRC-01", "SRC-04", "SRC-06"]);
  assert.match(step(analysis, "triage").detail, /Routed 3 of 6 sources/);
  const guarded = await live({ triage: { content: JSON.stringify({ sources: ["SRC-01", "SRC-02", "SRC-03", "SRC-04", "SRC-05", "SRC-06"].map((sourceId) => ({ sourceId, role: sourceId === "SRC-04" ? "customer-signal" : "delivery-evidence", features: [], injectionSuspected: false })) }) } });
  const routed = JSON.parse((guarded.calls[1].body.messages as { content: string }[])[1].content) as { untrustedSources: { id: string }[] };
  assert.deepEqual(routed.untrustedSources.map((source) => source.id), ["SRC-01", "SRC-04", "SRC-06"], "triage cannot hide the meeting or SAML promise");
  assert.match(step(guarded.analysis, "triage").detail, /Recall guard kept SRC-01, SRC-06/);
});

test("invalid, failed or disabled triage falls back to sending every source", async () => {
  for (const reply of [{ content: "not json at all" }, { content: JSON.stringify({ sources: [] }) }, { status: 500 }, { throws: true }, { finishReason: "length" }] satisfies Reply[]) {
    const { analysis, calls } = await live({ triage: reply });
    assert.equal(step(analysis, "triage").status, "fallback", JSON.stringify(reply));
    const input = JSON.parse((calls[1].body.messages as { content: string }[])[1].content) as { untrustedSources: unknown[] };
    assert.equal(input.untrustedSources.length, 6);
    assert.equal(step(analysis, "extraction").status, "done");
    assert.doesNotMatch(JSON.stringify(analysis), /provider-secret-body|secret-transport-detail/);
  }
  const off = await live({}, { NEBIUS_TRIAGE_MODEL: "off" });
  assert.equal(step(off.analysis, "triage").status, "skipped");
  assert.deepEqual(off.calls.map((call) => call.step), ["extraction", "narrative"]);
});

test("extraction failure stops the run with no fixture substitution and no narrative call", async () => {
  for (const [reply, code] of [[{ status: 429 }, "rate_limit"], [{ content: JSON.stringify({ commitments: [{ id: "X", featureId: "audit-export", title: "Audit", owner: "Invented Person", dueDate: null, intent: "committed", evidence: [{ sourceId: "SRC-01", quote: "Maya Chen: I will make audit log export" }] }] }) }, "grounding"], [{ model: "other/model" }, "wrong_model"]] as const) {
    const events: PipelineEvent[] = [];
    const mock = nebiusMock({ extraction: reply });
    process.env.NEBIUS_API_KEY = ENV.NEBIUS_API_KEY;
    await assert.rejects(() => runPipeline({ mode: "live", scenario: "blocked", fetcher: mock.fetcher, emit: (event) => events.push(event), env: ENV }), (error: unknown) => {
      assert.ok(error instanceof PipelineError);
      assert.equal(error.code, code);
      assert.equal(error.fallback, "reference");
      return true;
    });
    delete process.env.NEBIUS_API_KEY;
    assert.deepEqual(mock.calls.map((call) => call.step), ["triage", "extraction"]);
    assert.ok(!events.some((event) => event.type === "result"));
    const failed = events.filter((event) => event.type === "step" && event.step.id === "extraction").at(-1);
    assert.equal(failed?.type === "step" && failed.step.status, "failed");
  }
});

test("Ultra failure falls back to clearly labelled template drafts; verdicts never change", async () => {
  const baseline = await live();
  for (const reply of [{ status: 503 }, { content: "{}" }, { content: "garbage" }, { throws: true }, { finishReason: "length" }] satisfies Reply[]) {
    const { analysis } = await live({ narrative: reply });
    assert.equal(step(analysis, "narrative").status, "fallback", JSON.stringify(reply));
    for (const commitment of analysis.commitments.filter((item) => item.intent === "committed")) {
      assert.equal(commitment.narrative?.origin, "template");
      assert.match(commitment.narrative?.fallbackReason ?? "", /^Template draft: /);
    }
    assert.deepEqual(analysis.commitments.map((commitment) => commitment.verdict), baseline.analysis.commitments.map((commitment) => commitment.verdict));
  }
});

test("one bad brief falls back alone and is reported as a guardrail rejection", async () => {
  const content = JSON.stringify({ briefs: briefsFor({ "PL-101": AUDIT_EXPORT_BRIEF, "PL-104": { customerUpdate: [{ text: "The weekly usage report will be delivered by Friday.", citations: [{ sourceId: "SRC-01", quote: "Maya Chen: I will deliver the weekly usage report to Northstar by 2026-09-11." }] }] } }) });
  const { analysis, events } = await live({ narrative: { content } });
  assert.equal(step(analysis, "narrative").status, "fallback");
  assert.match(step(analysis, "narrative").detail, /4 of 5 briefs accepted/);
  const pl104 = analysis.commitments.find((commitment) => commitment.id === "PL-104")!;
  assert.equal(pl104.narrative?.origin, "template");
  assert.match(pl104.narrative?.fallbackReason ?? "", /Friday/);
  assert.equal(analysis.commitments[0].narrative?.origin, "model");
  const rejection = events.find((event) => event.type === "check" && !event.check.ok);
  assert.ok(rejection && rejection.type === "check" && rejection.check.commitmentId === "PL-104");
});

test("a model cannot smuggle a verdict change through the narrative", async () => {
  const content = JSON.stringify({ briefs: briefsFor({ "PL-101": { customerUpdate: [{ text: "Audit log export has been delivered to your workspace.", citations: [{ sourceId: "SRC-02", quote: "implementation complete; built=true. Build 2.14 passed internal CI." }] }] } }) });
  const { analysis } = await live({ narrative: { content } });
  assert.equal(analysis.commitments[0].verdict, "blocked");
  assert.equal(analysis.commitments[0].narrative?.origin, "template");
  assert.match(analysis.commitments[0].narrative?.fallbackReason ?? "", /claims delivery/);
});

test("the run budget skips optional steps rather than exceed its worst case", async () => {
  const { analysis, calls } = await live({}, { LIVE_RUN_BUDGET_USD: "0.025" });
  assert.deepEqual(calls.map((call) => call.step), ["triage", "extraction"]);
  assert.equal(step(analysis, "narrative").status, "skipped");
  assert.match(step(analysis, "narrative").detail, /budget/);
  assert.equal(analysis.commitments[0].narrative?.origin, "template");
  const tiny = await live({}, { LIVE_RUN_BUDGET_USD: "0.001" }).catch((error: unknown) => error);
  assert.ok(tiny instanceof PipelineError && tiny.code === "run_budget", "extraction is never dispatched over budget");
});

test("usage above the budgeted bound stops every later paid call", async () => {
  const mock = nebiusMock({ triage: { usage: { prompt_tokens: 10_000_000, completion_tokens: 10 } } });
  process.env.NEBIUS_API_KEY = ENV.NEBIUS_API_KEY;
  await assert.rejects(() => runPipeline({ mode: "live", scenario: "blocked", fetcher: mock.fetcher, env: ENV }), (error: unknown) => error instanceof PipelineError && error.code === "run_budget");
  delete process.env.NEBIUS_API_KEY;
  assert.deepEqual(mock.calls.map((call) => call.step), ["triage"]);
});

test("missing usage keeps the full reservation as the cost estimate", async () => {
  const { analysis } = await live({ triage: { usage: null } });
  const triage = step(analysis, "triage");
  assert.equal(triage.usage, null);
  assert.equal(triage.costUsd, triage.reservedUsd);
});

test("provider streaming can be turned off without changing results", async () => {
  const { analysis, calls } = await live({}, { NEBIUS_STREAM: "false" });
  assert.ok(calls.every((call) => call.body.stream === false && call.body.stream_options === undefined));
  assert.deepEqual(analysis.pipeline.steps.map((item) => item.status), ["done", "done", "done", "done"]);
});

test("reference mode replays the same steps with fixtures, templates and no network", async () => {
  const events: PipelineEvent[] = [];
  const analysis = await runPipeline({ mode: "reference", scenario: "blocked", emit: (event) => events.push(event), fetcher: async () => { throw new Error("network used in reference mode"); }, env: {} });
  assert.equal(analysis.pipeline.replay, true);
  assert.deepEqual(analysis.pipeline.steps.map((item) => [item.engine, item.status]), [["fixture", "done"], ["fixture", "done"], ["rules", "done"], ["template", "done"]]);
  assert.equal(analysis.usage, null);
  assert.equal(analysis.pipeline.costUsd, null);
  assert.ok(analysis.commitments.filter((commitment) => commitment.intent === "committed").every((commitment) => commitment.narrative?.origin === "template"));
  const run = events[0];
  assert.ok(run.type === "run" && run.replay === true);
  assert.equal(events.filter((event) => event.type === "quote").length, 6);
  assert.ok(events.filter((event) => event.type === "quote").every((event) => event.type === "quote" && event.matched));
});

test("an optional evidence provider failure is reported without breaking the run", async () => {
  const broken: EvidenceProvider = { id: "broken", label: "Broken provider", trust: "untrusted", kinds: ["PublicClaim"], required: false, timeoutMs: 50, enabled: () => true, fetch: async () => { throw new Error("boom"); } };
  const analysis = await runPipeline({ mode: "reference", scenario: "blocked", env: {}, providers: [(await import("../lib/evidence/providers/synthetic-pack.ts")).syntheticPackProvider, broken] });
  assert.deepEqual(analysis.pipeline.providers.map((provider) => [provider.id, provider.status]), [["synthetic-pack", "ok"], ["broken", "failed"]]);
  assert.equal(analysis.commitments.length, 6);
});
