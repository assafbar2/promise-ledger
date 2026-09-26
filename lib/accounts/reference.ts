import { templateNarrative } from "../pipeline/narrative";
import { plannedSteps } from "../pipeline/steps";
import { reconcile } from "../reconcile";
import type { Analysis, AnalyzedCommitment, Scenario } from "../schema";
import type { AccountPack } from "./types";

/**
 * The deterministic reference result for a sample account, computed locally with no network call.
 * It reads only the curated pack, so "crashing" (which needs the recorded Sentry replay) is not offered here.
 */
export function referenceAnalysis(pack: AccountPack, scenario: Exclude<Scenario, "crashing"> = pack.defaultScenario === "crashing" ? "blocked" : pack.defaultScenario): Analysis {
  const { sources, facts } = pack.createScenario(scenario);
  const commitments = pack.referenceCommitments
    .map((commitment) => reconcile(commitment, facts, pack.id, pack.asOf, undefined, pack.name))
    .map((commitment): AnalyzedCommitment => ({ ...commitment, narrative: commitment.intent === "committed" ? templateNarrative(commitment, null, pack.name) : null }));
  return { mode: "reference", model: null, runId: `reference-${pack.id}-${scenario}`, asOf: pack.asOf, scenario, account: { id: pack.id, name: pack.name, kind: "sample" }, commitments, sources, elapsedMs: 0, usage: null, pipeline: { replay: true, steps: plannedSteps("reference", null), checks: [], providers: [], budgetUsd: null, reservedUsd: null, costUsd: null } };
}
