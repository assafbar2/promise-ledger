import type { EvidenceProviderReport, PipelineCheck, StepId, StepSummary, Usage, Verdict } from "../schema";
import type { PipelineEvent } from "./events";

export type TraceQuote = { key: number; stepId: StepId; sourceId: string; quote: string; matched: boolean };
export type TraceState = {
  /** `awaiting`: a bring-your-own extraction finished and its facts wait for human confirmation. */
  status: "idle" | "running" | "done" | "failed" | "awaiting";
  runId: string | null;
  mode: "reference" | "live";
  replay: boolean;
  budgetUsd: number | null;
  steps: StepSummary[];
  progress: Partial<Record<StepId, { outputTokens: number; elapsedMs: number }>>;
  quotes: TraceQuote[];
  checks: PipelineCheck[];
  verdicts: { commitmentId: string; title: string; verdict: Verdict }[];
  error: string | null;
  totalMs: number | null;
  usage: Usage | null;
  costUsd: number | null;
  providers: EvidenceProviderReport[];
};

export function idleTrace(mode: "reference" | "live", steps: StepSummary[]): TraceState {
  return { status: "idle", runId: null, mode, replay: mode === "reference", budgetUsd: null, steps, progress: {}, quotes: [], checks: [], verdicts: [], error: null, totalMs: null, usage: null, costUsd: null, providers: [] };
}

export function traceReducer(state: TraceState, event: PipelineEvent): TraceState {
  switch (event.type) {
    case "run":
      return { ...idleTrace(event.mode, event.steps), status: "running", runId: event.runId, replay: event.replay, budgetUsd: event.budgetUsd, providers: event.providers };
    case "step":
      return { ...state, steps: state.steps.map((step) => step.id === event.step.id ? event.step : step) };
    case "progress":
      return { ...state, progress: { ...state.progress, [event.stepId]: { outputTokens: event.outputTokens, elapsedMs: event.elapsedMs } } };
    case "quote":
      return { ...state, quotes: [...state.quotes, { key: state.quotes.length, stepId: event.stepId, sourceId: event.sourceId, quote: event.quote, matched: event.matched }] };
    case "verdict":
      return { ...state, verdicts: [...state.verdicts.filter((verdict) => verdict.commitmentId !== event.commitmentId), { commitmentId: event.commitmentId, title: event.title, verdict: event.verdict }] };
    case "check":
      return { ...state, checks: [...state.checks, event.check] };
    case "result":
      return { ...state, status: "done", steps: event.analysis.pipeline.steps, totalMs: event.analysis.elapsedMs, usage: event.analysis.usage, costUsd: event.analysis.pipeline.costUsd, providers: event.analysis.pipeline.providers };
    case "proposal":
      return { ...state, status: "awaiting", steps: event.proposal.pipeline.steps, totalMs: event.proposal.elapsedMs, usage: event.proposal.usage, costUsd: event.proposal.pipeline.costUsd, providers: event.proposal.pipeline.providers };
    case "error":
      return { ...state, status: "failed", error: event.error, steps: state.steps.map((step) => step.status === "running" ? { ...step, status: "failed" } : step) };
  }
}

/** Display delay for replayed reference traces, so each step can be followed. Live traces are not delayed. */
export function replayDelayMs(event: PipelineEvent) {
  if (event.type === "step") return event.step.status === "running" ? 260 : 420;
  if (event.type === "quote") return 150;
  if (event.type === "verdict") return 120;
  if (event.type === "check") return 160;
  return 0;
}
