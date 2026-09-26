import type { Analysis, EvidenceProviderReport, PipelineCheck, Scenario, StepId, StepSummary, Verdict } from "../schema";

/** Newline-delimited JSON events streamed by POST /api/pipeline, in order. */
export type PipelineEvent =
  | { type: "run"; runId: string; mode: "reference" | "live"; scenario: Scenario; replay: boolean; budgetUsd: number | null; steps: StepSummary[]; providers: EvidenceProviderReport[] }
  | { type: "step"; step: StepSummary }
  | { type: "progress"; stepId: StepId; outputTokens: number; elapsedMs: number }
  | { type: "quote"; stepId: StepId; sourceId: string; quote: string; matched: boolean }
  | { type: "verdict"; commitmentId: string; title: string; verdict: Verdict }
  | { type: "check"; check: PipelineCheck }
  | { type: "result"; analysis: Analysis }
  | { type: "error"; error: string; code: string; status: number; fallback?: "reference" };

export type Emit = (event: PipelineEvent) => void;

const TYPES = new Set(["run", "step", "progress", "quote", "verdict", "check", "result", "error"]);

export function isPipelineEvent(value: unknown): value is PipelineEvent {
  return typeof value === "object" && value !== null && "type" in value && typeof value.type === "string" && TYPES.has(value.type);
}

/** Reads an NDJSON response body into events. Malformed lines are skipped. */
export async function* readPipelineEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<PipelineEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = done ? "" : lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(line); } catch { continue; }
      if (isPipelineEvent(parsed)) yield parsed;
    }
    if (done) return;
  }
}
