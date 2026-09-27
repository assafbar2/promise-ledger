import type { ExpectedCommitment, ExtractionCase } from "../evals/types";
import { normalizedCommitments, summarizeEvaluation, type EvaluationResult } from "./evaluation";
import { ACCOUNT, AS_OF, createScenario, FEATURE_IDS, referenceCommitments } from "./fixtures";
import { InferenceError } from "./nebius";
import { parseModelJson } from "./pipeline/json";
import { PipelineError } from "./pipeline/run";
import { allSourcesRouting, routeSources, validateTriage, type Routing, type TriageLabel } from "./pipeline/triage";
import type { Analysis, ProductFact, Source, StepId, StepSummary } from "./schema";

export const PIPELINE_EVALUATION_VERSION = "pipeline-evaluation-v1";
export const DELIVERY_SOURCE_ID = "EVAL-DELIVERY";
/** Held-out sources are dated 2026-09-19T12:00Z; development sources use the demo snapshot time. */
export const HELD_OUT_AS_OF = "2026-09-19T17:00:00Z";

type FactState = { featureId: string; built: boolean | null; enabled: boolean | null; verified: boolean | null };
// One fixed customer-specific availability record per case, so the rules and Ultra see a mix of verdicts.
const DELIVERY_STATES: FactState[] = [
  { featureId: "audit-export", built: true, enabled: false, verified: false },
  { featureId: "eu-residency", built: false, enabled: false, verified: false },
  { featureId: "usage-report", built: false, enabled: false, verified: false },
  { featureId: "scim", built: true, enabled: true, verified: null },
  { featureId: "saml", built: true, enabled: true, verified: true },
];

const flag = (value: boolean | null) => value === null ? "unknown" : String(value);

/** A curated availability snapshot observed 15 minutes before `asOf`, with one fact per line. */
export function deliveryContext(asOf: string): { source: Source; facts: ProductFact[] } {
  const observedAt = new Date(Date.parse(asOf) - 15 * 60 * 1000).toISOString();
  const lines = DELIVERY_STATES.map((state) => `account=${ACCOUNT.id}; feature=${state.featureId}; built=${flag(state.built)}; enabled=${flag(state.enabled)}; verified=${flag(state.verified)}.`);
  const source: Source = { id: DELIVERY_SOURCE_ID, accountId: ACCOUNT.id, kind: "Availability", title: "Northstar availability snapshot", author: "Release service · synthetic evaluation context", observedAt, text: lines.join("\n") };
  const facts = DELIVERY_STATES.map((state, index): ProductFact => ({ ...state, accountId: ACCOUNT.id, observedAt, evidence: [{ sourceId: DELIVERY_SOURCE_ID, quote: lines[index] }] }));
  return { source, facts };
}

export type PipelineCase = ExtractionCase & { evidence: { sources: Source[]; facts: ProductFact[]; asOf: string } };

/** The case's own sources, unchanged, plus the fixed availability snapshot. Expected labels are the case's. */
export function pipelineCase(sample: ExtractionCase, asOf: string): PipelineCase {
  const { source, facts } = deliveryContext(asOf);
  return { ...sample, evidence: { sources: [...sample.sources, source], facts, asOf } };
}

/** The app's own Northstar demo pack (blocked scenario) with its hand-labelled commitments. Development data. */
export function northstarPackCase(): PipelineCase {
  const { sources, facts } = createScenario("blocked");
  const expected: ExpectedCommitment[] = referenceCommitments.map(({ featureId, intent, owner, dueDate }) => ({ featureId, intent, owner, dueDate }));
  return { id: "dev-northstar-pack", category: "sample-pack", sources, expected, evidence: { sources, facts, asOf: AS_OF } };
}

export type ModelCall = { model: string; content: string | null };

/** Assistant content from a JSON completion or a server-sent event stream; null if there is none. */
export function completionContent(text: string): string | null {
  if (!/^\s*data:/m.test(text)) return (JSON.parse(text) as { choices?: { message?: { content?: string | null } }[] }).choices?.[0]?.message?.content ?? null;
  let content = "";
  for (const line of text.split(/\r?\n/)) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (!data || data === "[DONE]") continue;
    for (const choice of (JSON.parse(data) as { choices?: { delta?: { content?: string | null } }[] }).choices ?? []) content += choice.delta?.content ?? "";
  }
  return content || null;
}

/** Records each call's model and returned content for routing analysis; the response passes through unchanged. */
export function recordingFetcher(base: typeof fetch, calls: ModelCall[]): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init);
    let content: string | null = null;
    if (response.ok) { try { content = completionContent(await response.clone().text()); } catch { content = null; } }
    calls.push({ model: String(JSON.parse(String(init?.body)).model), content });
    return response;
  };
}
export type PipelineRunOutput = { analysis: Analysis; calls: ModelCall[] };
export type PipelineCaseRunner = (sample: PipelineCase) => Promise<PipelineRunOutput>;

type StepRecord = Pick<StepSummary, "id" | "status" | "model" | "reportedModel" | "latencyMs" | "usage" | "costUsd" | "detail">;

export type BriefOutcome = { commitmentId: string; featureId: string; verdict: string; origin: "model" | "template"; fallbackReason: string | null; customerUpdate: string[] };

export type PipelineCaseResult = {
  id: string;
  category: string;
  status: "passed" | "failed" | "error" | "not_run";
  expected: ExpectedCommitment[];
  actual: ExpectedCommitment[] | null;
  elapsedMs: number | null;
  usage: { promptTokens: number; completionTokens: number } | null;
  pipelineCostUsd: number | null;
  triageLabels: TriageLabel[] | null;
  routing: Pick<Routing, "guardKept"> & { extraction: string[]; directToRules: string[] } | null;
  steps: StepRecord[] | null;
  /** Committed items the rules handed to Ultra; `ultraCalled` is false when the step was skipped. */
  briefs: { ultraCalled: boolean; targets: number; accepted: number; outcomes: BriefOutcome[] } | null;
  error: { code: string; message: string; status: number | null } | null;
};

export function unrunPipelineResults(cases: PipelineCase[], reason: string): PipelineCaseResult[] {
  return cases.map((sample) => ({ id: sample.id, category: sample.category, status: "not_run", expected: normalizedCommitments(sample.expected), actual: null, elapsedMs: null, usage: null, pipelineCostUsd: null, triageLabels: null, routing: null, steps: null, briefs: null, error: { code: "not_run", message: reason, status: null } }));
}

/** Rebuilds the routing the pipeline applied from Nano's recorded output, using the pipeline's own validation. */
function triageRouting(sample: PipelineCase, analysis: Analysis, calls: ModelCall[]) {
  const triage = analysis.pipeline.steps.find((step) => step.id === "triage");
  const content = triage?.status === "done" ? calls.find((call) => triage.model && call.model === triage.model)?.content ?? null : null;
  if (content === null) return { labels: null, routing: allSourcesRouting(sample.evidence.sources) };
  try {
    const labels = validateTriage(parseModelJson(content), sample.evidence.sources, FEATURE_IDS);
    return { labels, routing: routeSources(sample.evidence.sources, labels) };
  } catch {
    return { labels: null, routing: allSourcesRouting(sample.evidence.sources) };
  }
}

export function scorePipelineCase(sample: PipelineCase, { analysis, calls }: PipelineRunOutput): PipelineCaseResult {
  const expected = normalizedCommitments(sample.expected);
  const actual = normalizedCommitments(analysis.commitments);
  const steps = analysis.pipeline.steps.map(({ id, status, model, reportedModel, latencyMs, usage, costUsd, detail }) => ({ id, status, model, reportedModel, latencyMs, usage, costUsd, detail }));
  const narrative = steps.find((step) => step.id === "narrative");
  const targets = analysis.commitments.filter((commitment) => commitment.intent === "committed");
  const outcomes = targets.map((commitment): BriefOutcome => ({ commitmentId: commitment.id, featureId: commitment.featureId, verdict: commitment.verdict, origin: commitment.narrative?.origin ?? "template", fallbackReason: commitment.narrative?.fallbackReason ?? null, customerUpdate: commitment.narrative?.customerUpdate.map((claim) => claim.text) ?? [] }));
  const { labels, routing } = triageRouting(sample, analysis, calls);
  return {
    id: sample.id,
    category: sample.category,
    status: JSON.stringify(actual) === JSON.stringify(expected) ? "passed" : "failed",
    expected,
    actual,
    elapsedMs: analysis.elapsedMs,
    usage: analysis.usage,
    pipelineCostUsd: analysis.pipeline.costUsd,
    triageLabels: labels,
    routing: { extraction: routing.extraction.map((source) => source.id), directToRules: routing.directToRules.map((source) => source.id), guardKept: routing.guardKept },
    steps,
    briefs: { ultraCalled: narrative?.status === "done" || narrative?.status === "fallback", targets: targets.length, accepted: outcomes.filter((outcome) => outcome.origin === "model").length, outcomes },
    error: null,
  };
}

const FATAL = ["configuration", "transport", "http", "rate_limit", "run_budget", "budget_preflight", "unexpected"];

export async function runPipelineEvaluation(cases: PipelineCase[], runner: PipelineCaseRunner, checkpoint: (results: PipelineCaseResult[]) => Promise<void> = async () => {}, beforeCase: () => string | null = () => null) {
  const results = unrunPipelineResults(cases, "Awaiting this case's pipeline run.");
  for (const [index, sample] of cases.entries()) {
    const blockedReason = beforeCase();
    if (blockedReason) {
      results.splice(index, results.length - index, ...unrunPipelineResults(cases.slice(index), blockedReason));
      await checkpoint(results);
      return results;
    }
    try {
      results[index] = scorePipelineCase(sample, await runner(sample));
    } catch (error) {
      const known = error instanceof PipelineError || error instanceof InferenceError;
      const code = known ? error.code : "unexpected";
      results[index] = { ...results[index], status: "error", error: { code, message: known ? error.message : "Unexpected evaluation error; raw details withheld.", status: known ? error.status : null } };
      if (FATAL.includes(code)) {
        for (let pending = index + 1; pending < results.length; pending++) results[pending] = { ...results[pending], error: { code: "not_run", message: "Stopped after a provider/configuration failure; no automatic retry.", status: null } };
        await checkpoint(results);
        return results;
      }
    }
    await checkpoint(results);
  }
  return results;
}

function stepTotals(results: PipelineCaseResult[], id: StepId) {
  const steps = results.flatMap((result) => result.steps?.filter((step) => step.id === id) ?? []);
  const called = steps.filter((step) => step.reportedModel !== null || step.usage !== null);
  const latency = called.flatMap((step) => step.latencyMs === null ? [] : [step.latencyMs]).sort((left, right) => left - right);
  const count = (status: StepSummary["status"]) => steps.filter((step) => step.status === status).length;
  return {
    calls: called.length,
    done: count("done"),
    fallback: count("fallback"),
    skipped: count("skipped"),
    failed: count("failed"),
    promptTokens: called.reduce((total, step) => total + (step.usage?.promptTokens ?? 0), 0),
    completionTokens: called.reduce((total, step) => total + (step.usage?.completionTokens ?? 0), 0),
    reasoningTokens: called.reduce((total, step) => total + (step.usage?.reasoningTokens ?? 0), 0),
    latencyP50Ms: latency.length ? latency[Math.ceil(latency.length / 2) - 1] : null,
    latencyMaxMs: latency.at(-1) ?? null,
  };
}

export function summarizePipelineEvaluation(results: PipelineCaseResult[]) {
  const asExtraction: EvaluationResult[] = results.map((result) => ({ id: result.id, category: result.category, status: result.status, expected: result.expected, actual: result.actual, trace: result.elapsedMs === null ? null : { requestedModel: "pipeline", model: null, runId: null, requestId: null, httpStatus: null, elapsedMs: result.elapsedMs, usage: result.usage }, error: result.error }));
  const { latencyMs, recordedUsage, ...extraction } = summarizeEvaluation(asExtraction);
  const briefs = results.flatMap((result) => result.briefs?.ultraCalled ? [result.briefs] : []);
  const targets = briefs.reduce((total, brief) => total + brief.targets, 0);
  const accepted = briefs.reduce((total, brief) => total + brief.accepted, 0);
  const reasons = new Map<string, number>();
  for (const outcome of briefs.flatMap((brief) => brief.outcomes)) if (outcome.origin === "template") reasons.set(outcome.fallbackReason ?? "unknown", (reasons.get(outcome.fallbackReason ?? "unknown") ?? 0) + 1);
  const routed = results.filter((result) => result.routing);
  return {
    extraction,
    endToEndLatencyMs: latencyMs,
    recordedUsage,
    pipelineCostEstimateUsd: Math.round(results.reduce((total, result) => total + (result.pipelineCostUsd ?? 0), 0) * 1_000_000) / 1_000_000,
    triage: {
      ...stepTotals(results, "triage"),
      caseSourcesRoutedAway: routed.reduce((total, result) => total + result.routing!.directToRules.filter((id) => id !== DELIVERY_SOURCE_ID).length, 0),
      deliverySnapshotsSentToExtraction: routed.filter((result) => result.routing!.extraction.includes(DELIVERY_SOURCE_ID)).length,
      guardKept: routed.reduce((total, result) => total + result.routing!.guardKept.length, 0),
    },
    extractionStep: stepTotals(results, "extraction"),
    narrative: stepTotals(results, "narrative"),
    briefs: { casesWithUltraCall: briefs.length, targets, accepted, rejected: targets - accepted, acceptanceRate: targets ? accepted / targets : null, rejectionReasons: Object.fromEntries(reasons) },
  };
}
