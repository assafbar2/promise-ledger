import type { ExpectedCommitment, ExtractionCase } from "../evals/types";
import { InferenceError, type InferenceTrace } from "./nebius";
import type { Commitment, Source } from "./schema";

export type EvaluationResult = {
  id: string;
  category: string;
  status: "passed" | "failed" | "error" | "not_run";
  expected: ExpectedCommitment[];
  actual: ExpectedCommitment[] | null;
  trace: InferenceTrace | null;
  error: { code: string; message: string; status: number | null } | null;
};

export type ExtractionRunner = (sources: Source[]) => Promise<{ commitments: Commitment[]; trace: InferenceTrace }>;

export function normalizedCommitments(commitments: ExpectedCommitment[]): ExpectedCommitment[] {
  return commitments.map(({ featureId, intent, owner, dueDate }) => ({ featureId, intent, owner, dueDate })).sort((left, right) => left.featureId.localeCompare(right.featureId));
}

export function unrunResults(cases: ExtractionCase[], reason: string): EvaluationResult[] {
  return cases.map((sample) => ({ id: sample.id, category: sample.category, status: "not_run", expected: normalizedCommitments(sample.expected), actual: null, trace: null, error: { code: "not_run", message: reason, status: null } }));
}

export async function runEvaluation(cases: ExtractionCase[], runner: ExtractionRunner, checkpoint: (results: EvaluationResult[]) => Promise<void> = async () => {}, beforeRequest: () => string | null = () => null) {
  const results = unrunResults(cases, "Awaiting this case's inference request.");
  for (const [index, sample] of cases.entries()) {
    const blockedReason = beforeRequest();
    if (blockedReason) {
      results.splice(index, results.length - index, ...unrunResults(cases.slice(index), blockedReason));
      await checkpoint(results);
      return results;
    }
    try {
      const result = await runner(sample.sources);
      const expected = normalizedCommitments(sample.expected);
      const actual = normalizedCommitments(result.commitments);
      results[index] = { id: sample.id, category: sample.category, status: JSON.stringify(actual) === JSON.stringify(expected) ? "passed" : "failed", expected, actual, trace: result.trace, error: null };
    } catch (error) {
      const known = error instanceof InferenceError;
      results[index] = { ...results[index], status: "error", trace: known ? error.trace : null, error: { code: known ? error.code : "unexpected", message: known ? error.message : "Unexpected evaluation error; raw details withheld.", status: known ? error.status : null } };
      if (!known || ["configuration", "transport", "http", "rate_limit"].includes(error.code)) {
        for (let pending = index + 1; pending < results.length; pending++) results[pending] = { ...results[pending], error: { code: "not_run", message: "Stopped after a provider/configuration failure; no automatic retry.", status: null } };
        await checkpoint(results);
        return results;
      }
    }
    await checkpoint(results);
  }
  return results;
}

export function summarizeEvaluation(results: EvaluationResult[]) {
  const executed = results.filter((result) => result.status !== "not_run");
  const accepted = executed.filter((result) => result.actual !== null);
  const passed = executed.filter((result) => result.status === "passed").length;
  const latency = executed.flatMap((result) => result.trace ? [result.trace.elapsedMs] : []).sort((left, right) => left - right);
  const usage = executed.flatMap((result) => result.trace?.usage ? [result.trace.usage] : []);
  let correctFeatures = 0;
  let predictedFeatures = 0;
  let expectedFeatures = 0;
  let correctFields = 0;
  for (const result of accepted) {
    predictedFeatures += result.actual!.length;
    expectedFeatures += result.expected.length;
    for (const prediction of result.actual!) {
      const expected = result.expected.find((candidate) => candidate.featureId === prediction.featureId);
      if (!expected) continue;
      correctFeatures++;
      correctFields += ["intent", "owner", "dueDate"].filter((field) => prediction[field as keyof ExpectedCommitment] === expected[field as keyof ExpectedCommitment]).length;
    }
  }
  const percentile = (fraction: number) => latency.length ? latency[Math.max(0, Math.ceil(latency.length * fraction) - 1)] : null;
  return {
    plannedCases: results.length,
    executedCases: executed.length,
    passed,
    failed: executed.filter((result) => result.status === "failed").length,
    errors: executed.filter((result) => result.status === "error").length,
    notRun: results.length - executed.length,
    exactMatchRate: executed.length ? passed / executed.length : null,
    acceptedOutputMetrics: { cases: accepted.length, featurePrecision: predictedFeatures ? correctFeatures / predictedFeatures : null, featureRecall: expectedFeatures ? correctFeatures / expectedFeatures : null, extraFeatures: predictedFeatures - correctFeatures, missedFeatures: expectedFeatures - correctFeatures, matchedFeatureFieldAccuracy: correctFeatures ? correctFields / (correctFeatures * 3) : null },
    groundingRejections: executed.filter((result) => result.error?.code === "grounding").length,
    latencyMs: { samples: latency.length, p50: percentile(0.5), p95: percentile(0.95), maximum: latency.at(-1) ?? null },
    recordedUsage: { callsWithUsage: usage.length, promptTokens: usage.reduce((total, value) => total + value.promptTokens, 0), completionTokens: usage.reduce((total, value) => total + value.completionTokens, 0) },
  };
}
