import type { StepId, StepSummary } from "../schema";

export const STEP_ORDER: StepId[] = ["triage", "extraction", "rules", "narrative"];

export const STEP_META: Record<StepId, { label: string; role: string }> = {
  triage: { label: "Triage", role: "Classify and route every source" },
  extraction: { label: "Extract", role: "Find promises with exact quotes" },
  rules: { label: "Decide", role: "Deterministic delivery policy" },
  narrative: { label: "Explain", role: "Explain, draft and nudge. Never decides." },
};

export function stepSummary(id: StepId, patch: Partial<StepSummary> = {}): StepSummary {
  return { id, ...STEP_META[id], engine: "nemotron", model: null, reportedModel: null, status: "queued", latencyMs: null, usage: null, runId: null, reservedUsd: null, costUsd: null, detail: "", ...patch };
}

export type PlannedModels = { triage: string | null; extraction: string | null; narrative: string | null };

export function plannedSteps(mode: "reference" | "live", models: PlannedModels | null): StepSummary[] {
  if (mode === "reference" || !models) {
    return [
      stepSummary("triage", { engine: "fixture" }),
      stepSummary("extraction", { engine: "fixture" }),
      stepSummary("rules", { engine: "rules" }),
      stepSummary("narrative", { engine: "template" }),
    ];
  }
  return [
    stepSummary("triage", { model: models.triage }),
    stepSummary("extraction", { model: models.extraction }),
    stepSummary("rules", { engine: "rules" }),
    stepSummary("narrative", { model: models.narrative }),
  ];
}
