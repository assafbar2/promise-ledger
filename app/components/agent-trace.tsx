"use client";

import { Check, ChevronDown, CircleAlert, CircleDashed, Cpu, FileText, Gauge, History, Minus, RotateCcw, Scale, ShieldCheck, X } from "lucide-react";
import { modelInfo } from "@/lib/pipeline/models";
import type { TraceState } from "@/lib/pipeline/trace-state";
import type { StepStatus, StepSummary } from "@/lib/schema";
import { VERDICTS } from "@/lib/verdicts";
import { ProviderStatus } from "./evidence-sources";

const STATUS: Record<StepStatus, { label: string; icon: typeof Check }> = {
  queued: { label: "Queued", icon: CircleDashed },
  running: { label: "Running", icon: CircleDashed },
  done: { label: "Done", icon: Check },
  fallback: { label: "Fallback used", icon: RotateCcw },
  skipped: { label: "Skipped", icon: Minus },
  failed: { label: "Failed", icon: X },
};

export function formatMs(ms: number | null) {
  if (ms === null) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

export function formatUsd(value: number | null) {
  if (value === null) return "—";
  if (value === 0) return "$0";
  return value < 0.0001 ? "< $0.0001" : `$${value.toFixed(4)}`;
}

function engineLabel(step: StepSummary) {
  if (step.engine === "fixture") return "Reference fixture · no AI call";
  if (step.engine === "rules") return "Deterministic rules · no AI";
  if (step.engine === "template") return "Template drafts · no AI call";
  if (step.engine === "pattern") return "Pattern matcher · no AI call";
  if (step.engine === "confirmed") return "Your confirmed extraction · no AI call";
  return step.model ? modelInfo(step.model).name : "Step turned off";
}

function StepCard({ step, index, live }: { step: StepSummary; index: number; live: { outputTokens: number; elapsedMs: number } | undefined }) {
  const status = STATUS[step.status];
  const Icon = status.icon;
  const aiStep = step.engine === "nemotron";
  const tokens = step.usage ? `${step.usage.promptTokens.toLocaleString("en-US")} in · ${step.usage.completionTokens.toLocaleString("en-US")} out` : step.status === "running" && live ? `≈ ${live.outputTokens.toLocaleString("en-US")} out, streaming` : aiStep ? "—" : "No model call";
  const latency = step.status === "running" && live ? formatMs(live.elapsedMs) : formatMs(step.latencyMs);
  return (
    <li className={`pipeline-step status-${step.status} engine-${step.engine}`} aria-current={step.status === "running" ? "step" : undefined}>
      <div className="step-top"><span className="step-index">{String(index + 1).padStart(2, "0")}</span><span className="step-status"><Icon size={12} className={step.status === "running" ? "spinning" : ""} aria-hidden="true" />{status.label}</span></div>
      <h3>{step.label}</h3>
      <p className="step-role">{step.role}</p>
      <p className="step-model">{step.engine === "rules" ? <Scale size={12} aria-hidden="true" /> : step.engine === "nemotron" ? <Cpu size={12} aria-hidden="true" /> : <FileText size={12} aria-hidden="true" />}<span>{engineLabel(step)}</span></p>
      <dl className="step-metrics">
        <div><dt>Latency</dt><dd>{latency}</dd></div>
        <div><dt>Tokens</dt><dd>{tokens}</dd></div>
        {aiStep && <div><dt>Cost</dt><dd>{step.costUsd !== null ? formatUsd(step.costUsd) : step.reservedUsd !== null ? `≤ ${formatUsd(step.reservedUsd)}` : "—"}</dd></div>}
      </dl>
      {step.detail && <p className="step-detail">{step.detail}</p>}
    </li>
  );
}

export function AgentTrace({ trace, expanded, onToggle, onOpenSource }: { trace: TraceState; expanded: boolean; onToggle: () => void; onOpenSource: (sourceId: string) => void }) {
  const running = trace.status === "running";
  const aiSteps = trace.steps.filter((step) => step.engine === "nemotron" && step.model).length;
  const heading = trace.mode === "live" ? `Live agent run · ${aiSteps} Nemotron model${aiSteps === 1 ? "" : "s"}` : "Replayed reference trace · no AI calls";
  const announcement = trace.steps.filter((step) => step.status !== "queued").map((step) => `${step.label}: ${STATUS[step.status].label}`).join(". ");
  const failedChecks = trace.checks.filter((check) => !check.ok).length;
  return (
    <section className={`agent-trace mode-${trace.mode} trace-${trace.status}`} aria-labelledby="agent-trace-title">
      <header className="trace-header">
        <div>
          <div className="eyebrow"><span />AGENT PIPELINE</div>
          <h2 id="agent-trace-title">{heading}</h2>
          <p>{trace.status === "idle"
            ? trace.mode === "live" ? "Run the evidence check to watch each model work. Rules, not models, decide every verdict." : "Reference mode replays the same four steps with hand-labelled fixtures and template drafts. Nothing is sent to a model."
            : trace.replay ? "Replayed for readability; timings are illustrative. The fixtures pass the same quote checks as live output."
              : trace.status === "failed" ? "The run stopped. Previous results are still shown below." : "Every quote is checked against its source as it streams in. The Explain step writes only after the rules decide."}</p>
        </div>
        <div className="trace-stats">
          {trace.status !== "idle" && <dl>
            <div><dt><History size={12} aria-hidden="true" />Time</dt><dd>{trace.totalMs !== null ? formatMs(trace.totalMs) : running ? "Running…" : "—"}</dd></div>
            {trace.mode === "live" && <div><dt><Cpu size={12} aria-hidden="true" />Tokens</dt><dd>{trace.usage ? (trace.usage.promptTokens + trace.usage.completionTokens).toLocaleString("en-US") : "—"}</dd></div>}
            {trace.mode === "live" && <div><dt><Gauge size={12} aria-hidden="true" />Cost</dt><dd>{formatUsd(trace.costUsd)}{trace.budgetUsd !== null && <small> of {formatUsd(trace.budgetUsd)} budget</small>}</dd></div>}
          </dl>}
          <button className="trace-toggle" onClick={onToggle} aria-expanded={expanded} aria-controls="agent-trace-body"><ChevronDown size={14} aria-hidden="true" />{expanded ? "Hide details" : "Show details"}</button>
        </div>
      </header>
      <p className="visually-hidden" aria-live="polite">{running || trace.status === "done" ? announcement : ""}</p>
      <ol className="pipeline-steps" aria-label="Pipeline steps">
        {trace.steps.map((step, index) => <StepCard key={step.id} step={step} index={index} live={trace.progress[step.id]} />)}
      </ol>
      <ProviderStatus providers={trace.providers} />
      {trace.error && <p className="trace-error" role="alert"><CircleAlert size={14} aria-hidden="true" />{trace.error}</p>}
      {expanded && <div className="trace-body" id="agent-trace-body">
        <div className="trace-column">
          <h3>Cited quotes <span>{trace.quotes.length}</span></h3>
          {trace.quotes.length === 0 ? <p className="trace-empty">{running ? "Waiting for the first citation…" : "Quotes appear here as each model cites its sources."}</p>
            : <ol className="quote-feed" aria-label="Cited quotes, in the order they arrived">
              {trace.quotes.map((quote) => <li key={quote.key} className={quote.matched ? "matched" : "unmatched"}>
                <span className="quote-step">{quote.stepId === "narrative" ? "Explain" : "Extract"}</span>
                <button className="cite-chip" onClick={() => onOpenSource(quote.sourceId)} aria-label={`Open source ${quote.sourceId}`}>{quote.sourceId}</button>
                <q>{quote.quote}</q>
                <span className="quote-check">{quote.matched ? <><Check size={11} aria-hidden="true" />Exact match</> : <><X size={11} aria-hidden="true" />Not in source</>}</span>
              </li>)}
            </ol>}
        </div>
        <div className="trace-column">
          <h3>Verdicts and guardrails {failedChecks > 0 && <span className="warn">{failedChecks} rejected</span>}</h3>
          {trace.verdicts.length === 0 && trace.checks.length === 0 ? <p className="trace-empty">Deterministic verdicts and guardrail results appear here.</p> : <>
            {trace.verdicts.length > 0 && <ul className="verdict-feed" aria-label="Deterministic verdicts">
              {trace.verdicts.map((verdict) => <li key={verdict.commitmentId}><span className="verdict-id">{verdict.commitmentId}</span><span className="verdict-title">{verdict.title}</span><span className={`badge ${VERDICTS[verdict.verdict].className}`}><span />{VERDICTS[verdict.verdict].label}</span></li>)}
            </ul>}
            <ul className="check-feed" aria-label="Guardrail checks">
              {trace.checks.map((check, index) => <li key={index} className={check.ok ? "ok" : "rejected"}>{check.ok ? <ShieldCheck size={13} aria-hidden="true" /> : <CircleAlert size={13} aria-hidden="true" />}<span>{check.label}</span></li>)}
            </ul>
          </>}
        </div>
      </div>}
    </section>
  );
}
