import { collectEvidence, EvidenceError } from "../evidence/registry";
import type { EvidenceProvider } from "../evidence/types";
import { ACCOUNT, AS_OF, FEATURE_IDS, referenceCommitments } from "../fixtures";
import { chatCompletion, extractionMessages, extractWithNebius, InferenceError, NEBIUS_MAX_OUTPUT_TOKENS, type InferenceTrace, type StreamProgress } from "../nebius";
import { publicClaimNotes } from "../public-claims/claims";
import { reconcile, validateExtraction } from "../reconcile";
import type { Analysis, Commitment, Narrative, PipelineCheck, ReconciledCommitment, Scenario, StepId, StepSummary, Usage } from "../schema";
import { RunBudget, utf8Bytes } from "./budget";
import type { Emit } from "./events";
import { validateBriefs } from "./guardrails";
import { parseModelJson } from "./json";
import { modelInfo, pipelineModels, RUN_DEADLINE_MS, runBudgetUsd, STEP_LIMITS, stepReasoningEffort, type Env } from "./models";
import { briefNarrative, NARRATIVE_PROMPT, narrativeInput, narrativeSources, templateNarrative } from "./narrative";
import { createQuoteScanner } from "./quotes";
import { stepSummary } from "./steps";
import { allSourcesRouting, referenceTriage, routeSources, triageInput, triagePrompt, validateTriage, type Routing, type TriageLabel } from "./triage";

export class PipelineError extends Error {
  constructor(message: string, public status: number, public code: string, public fallback?: "reference") { super(message); }
}

export type PipelineOptions = {
  mode: "reference" | "live";
  scenario: Scenario;
  emit?: Emit;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  env?: Env;
  providers?: readonly EvidenceProvider[];
};

function modelName(model: string | null) {
  return model ? modelInfo(model).name : "model";
}

function callFailure(error: unknown, model: string | null) {
  const name = modelName(model);
  if (!(error instanceof InferenceError)) return `${name} did not return valid output`;
  if (error.code === "http") return `${name} returned an error (HTTP ${error.trace?.httpStatus ?? error.status})`;
  if (error.code === "rate_limit") return `${name} is rate limited right now`;
  if (error.code === "transport") return `${name} did not respond in time`;
  if (error.code === "incomplete") return `${name} returned an incomplete result`;
  if (error.code === "wrong_model") return "the provider reported a non-Nemotron model";
  return `${name} returned an unexpected response`;
}

function usageOf(trace: InferenceTrace | null | undefined) {
  return trace?.usage ? { ...trace.usage, reasoningTokens: trace.reasoningTokens ?? null } : null;
}

export async function runPipeline(options: PipelineOptions): Promise<Analysis> {
  const env = options.env ?? process.env;
  const emit: Emit = options.emit ?? (() => {});
  const fetcher = options.fetcher ?? fetch;
  const live = options.mode === "live";
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const timeLeft = () => RUN_DEADLINE_MS - elapsed();
  const runId = crypto.randomUUID();
  const stream = !/^(false|0|off|no)$/i.test((env.NEBIUS_STREAM ?? "").trim());

  let evidence;
  try {
    evidence = await collectEvidence({ accountId: ACCOUNT.id, featureIds: FEATURE_IDS, scenario: options.scenario, mode: options.mode, asOf: AS_OF, now: new Date().toISOString(), signal: options.signal, env }, options.providers);
  } catch (error) {
    throw new PipelineError(`Evidence could not be collected${error instanceof EvidenceError ? `: ${error.message}` : "."} No results were accepted.`, 502, "evidence", live ? "reference" : undefined);
  }
  const { sources, facts } = evidence;
  const models = pipelineModels(env);
  const budget = live ? new RunBudget(runBudgetUsd(env)) : null;
  const checks: PipelineCheck[] = [];
  const steps: Record<StepId, StepSummary> = live
    ? {
      triage: stepSummary("triage", { model: models.triage.model }),
      extraction: stepSummary("extraction", { model: models.extraction }),
      rules: stepSummary("rules", { engine: "rules" }),
      narrative: stepSummary("narrative", { model: models.narrative.model }),
    }
    : {
      triage: stepSummary("triage", { engine: "fixture" }),
      extraction: stepSummary("extraction", { engine: "fixture" }),
      rules: stepSummary("rules", { engine: "rules" }),
      narrative: stepSummary("narrative", { engine: "template" }),
    };
  const update = (id: StepId, patch: Partial<StepSummary>) => {
    steps[id] = { ...steps[id], ...patch };
    emit({ type: "step", step: steps[id] });
  };
  const check = (value: PipelineCheck) => {
    checks.push(value);
    emit({ type: "check", check: value });
  };
  const progress = (stepId: StepId, onContent?: (content: string) => void) => {
    const callStarted = performance.now();
    let last = 0;
    let lastBrace = -1;
    return ({ content, outputChunks }: StreamProgress) => {
      const brace = content.lastIndexOf("}");
      if (onContent && brace > lastBrace) { lastBrace = brace; onContent(content); }
      const now = performance.now();
      if (now - last < 150) return;
      last = now;
      emit({ type: "progress", stepId, outputTokens: outputChunks, elapsedMs: Math.round(now - callStarted) });
    };
  };

  emit({ type: "run", runId, mode: options.mode, scenario: options.scenario, replay: !live, budgetUsd: budget?.limitUsd ?? null, steps: Object.values(steps), providers: evidence.providers });

  if (live && budget) {
    const { system, user } = extractionMessages(sources);
    budget.hold("extraction", models.extraction, utf8Bytes(system, user), NEBIUS_MAX_OUTPUT_TOKENS);
  }

  // 1. Triage
  let labels: TriageLabel[] = referenceTriage(sources, FEATURE_IDS);
  let routing: Routing;
  if (!live) {
    const stepStarted = performance.now();
    routing = routeSources(sources, labels);
    update("triage", { status: "done", latencyMs: Math.round(performance.now() - stepStarted), detail: `Reference routing by source type: ${routing.extraction.length} of ${sources.length} sources go to extraction. No AI call.` });
  } else {
    routing = allSourcesRouting(sources);
    const model = models.triage.model;
    const system = triagePrompt(FEATURE_IDS);
    const user = triageInput(sources);
    const bytes = utf8Bytes(system, user);
    const timeoutMs = Math.min(STEP_LIMITS.triage.timeoutMs, timeLeft() - STEP_LIMITS.extraction.timeoutMs - 5000);
    const reservation = model && bytes <= STEP_LIMITS.triage.maxInputBytes && timeoutMs >= 3000 ? budget!.reserve("triage", model, bytes, STEP_LIMITS.triage.maxOutputTokens) : null;
    const skipReason = !model ? models.triage.disabledReason : bytes > STEP_LIMITS.triage.maxInputBytes ? "The source pack is larger than triage's input cap." : timeoutMs < 3000 ? "Not enough time left in this request." : reservation && !reservation.ok ? `Skipped because ${reservation.reason}.` : null;
    if (skipReason || !model || !reservation?.ok) {
      labels = sources.map((source) => ({ sourceId: source.id, role: "commitment", features: [], injectionSuspected: false }));
      update("triage", { status: "skipped", detail: `${skipReason ?? "Triage is off."} All ${sources.length} sources go to extraction.` });
    } else {
      update("triage", { status: "running", reservedUsd: reservation.reservedUsd, detail: `Classifying ${sources.length} sources…` });
      let trace: InferenceTrace | null = null;
      try {
        const result = await chatCompletion({ model, system, user, maxTokens: STEP_LIMITS.triage.maxOutputTokens, reasoningEffort: stepReasoningEffort(env).triage, timeoutMs, stream, signal: options.signal, onProgress: progress("triage"), fetcher });
        trace = result.trace;
        const cost = budget!.settle("triage", trace.usage);
        const common = { reportedModel: trace.model, latencyMs: trace.elapsedMs, usage: usageOf(trace), runId: trace.runId, costUsd: cost };
        try {
          labels = validateTriage(parseModelJson(result.content), sources, FEATURE_IDS);
          routing = routeSources(sources, labels);
          const flagged = labels.filter((label) => label.injectionSuspected).map((label) => label.sourceId);
          update("triage", { ...common, status: "done", detail: `Routed ${routing.extraction.length} of ${sources.length} sources to extraction; ${routing.directToRules.length} delivery records go straight to the rules.${routing.guardKept.length ? ` Recall guard kept ${routing.guardKept.join(", ")} (explicit commitment language).` : ""}${flagged.length ? ` Possible prompt injection flagged in ${flagged.join(", ")}.` : ""}` });
          check({ stepId: "triage", ok: true, label: `Every source classified exactly once (${sources.length}/${sources.length})` });
          if (routing.guardKept.length) check({ stepId: "triage", ok: true, label: `Recall guard kept ${routing.guardKept.join(", ")} for extraction` });
        } catch {
          labels = sources.map((source) => ({ sourceId: source.id, role: "commitment", features: [], injectionSuspected: false }));
          update("triage", { ...common, status: "fallback", detail: `Triage output failed validation, so all ${sources.length} sources go to extraction.` });
          check({ stepId: "triage", ok: false, label: "Triage output rejected; routing fell back to all sources" });
        }
      } catch (error) {
        const failed = error instanceof InferenceError ? error.trace : null;
        if (error instanceof InferenceError && (error.code === "http" || error.code === "rate_limit")) budget!.release("triage");
        const cost = budget!.settle("triage", failed?.usage ?? null);
        labels = sources.map((source) => ({ sourceId: source.id, role: "commitment", features: [], injectionSuspected: false }));
        update("triage", { status: "fallback", reportedModel: failed?.model ?? null, latencyMs: failed?.elapsedMs ?? null, usage: usageOf(failed), costUsd: cost, reservedUsd: cost === null ? null : reservation.reservedUsd, detail: `${callFailure(error, model)}. All ${sources.length} sources go to extraction.` });
      }
    }
  }

  // 2. Extraction
  const scanExtraction = createQuoteScanner(routing.extraction, ACCOUNT.id);
  const emitQuotes = (stepId: StepId, scan: ReturnType<typeof createQuoteScanner>) => (content: string) => {
    for (const quote of scan(content)) emit({ type: "quote", stepId, ...quote });
  };
  let commitments: Commitment[];
  let extractionTrace: InferenceTrace | null = null;
  if (!live) {
    update("extraction", { status: "running", detail: "Loading hand-labelled reference commitments…" });
    const stepStarted = performance.now();
    commitments = validateExtraction({ commitments: referenceCommitments }, routing.extraction, ACCOUNT.id, FEATURE_IDS);
    emitQuotes("extraction", scanExtraction)(JSON.stringify({ commitments }));
    update("extraction", { status: "done", latencyMs: Math.round(performance.now() - stepStarted), detail: `${commitments.length} hand-labelled commitments, every quote checked against its source. No AI call.` });
  } else {
    const model = models.extraction;
    const { system, user } = extractionMessages(routing.extraction);
    const bytes = utf8Bytes(system, user);
    if (bytes > STEP_LIMITS.extraction.maxInputBytes) {
      update("extraction", { status: "failed", detail: "The routed sources exceed the extraction input cap." });
      throw new PipelineError("The evidence pack is too large for one extraction call. No results were accepted.", 413, "input_too_large", "reference");
    }
    const reservation = budget!.reserve("extraction", model, bytes, NEBIUS_MAX_OUTPUT_TOKENS);
    if (!reservation.ok) {
      update("extraction", { status: "failed", detail: `Not dispatched: ${reservation.reason}.` });
      throw new PipelineError("This run's cost budget cannot cover extraction. No results were accepted.", 503, "run_budget", "reference");
    }
    update("extraction", { status: "running", reservedUsd: reservation.reservedUsd, detail: `Reading ${routing.extraction.length} routed sources…` });
    try {
      const result = await extractWithNebius(routing.extraction, fetcher, { model, stream, timeoutMs: Math.min(STEP_LIMITS.extraction.timeoutMs, timeLeft() - 3000), signal: options.signal, onProgress: progress("extraction", emitQuotes("extraction", scanExtraction)) });
      extractionTrace = result.trace;
      commitments = result.commitments;
      emitQuotes("extraction", scanExtraction)(JSON.stringify({ commitments }));
      const cost = budget!.settle("extraction", extractionTrace.usage);
      update("extraction", { status: "done", reportedModel: extractionTrace.model, latencyMs: extractionTrace.elapsedMs, usage: usageOf(extractionTrace), runId: extractionTrace.runId, costUsd: cost, detail: `${commitments.length} commitments accepted; owners and dates appear in their quotes.` });
    } catch (error) {
      const failed = error instanceof InferenceError ? error.trace : null;
      if (error instanceof InferenceError && (error.code === "http" || error.code === "rate_limit")) budget!.release("extraction");
      const cost = budget!.settle("extraction", failed?.usage ?? null);
      update("extraction", { status: "failed", reportedModel: failed?.model ?? null, latencyMs: failed?.elapsedMs ?? null, usage: usageOf(failed), runId: failed?.runId ?? null, costUsd: cost, detail: error instanceof InferenceError ? error.message : "Extraction failed." });
      if (error instanceof InferenceError) throw new PipelineError(error.message, error.status, error.code, "reference");
      throw new PipelineError("Analysis could not be validated. No results were accepted.", 500, "extraction", "reference");
    }
  }
  const quoteCount = commitments.reduce((total, commitment) => total + commitment.evidence.length, 0);
  check({ stepId: "extraction", ok: true, label: `${quoteCount} of ${quoteCount} quotes are exact text from their sources` });

  // 3. Deterministic rules
  update("rules", { status: "running", detail: "Applying the ordered delivery policy…" });
  const rulesStarted = performance.now();
  const reconciled: ReconciledCommitment[] = commitments.map((commitment) => reconcile(commitment, facts, ACCOUNT.id, AS_OF, evidence));
  for (const commitment of reconciled) emit({ type: "verdict", commitmentId: commitment.id, title: commitment.title, verdict: commitment.verdict });
  const publicClaims = publicClaimNotes(evidence.signals, sources, reconciled, ACCOUNT.name);
  for (const [commitmentId, note] of publicClaims) if (note.conflict) check({ stepId: "rules", ok: true, commitmentId, label: `${commitmentId}: public GA claim ≠ customer access. Flagged for review; verdict unchanged` });
  const gaps = reconciled.filter((commitment) => ["blocked", "overdue", "verify", "unknown"].includes(commitment.verdict)).length;
  update("rules", { status: "done", latencyMs: Math.max(1, Math.round(performance.now() - rulesStarted)), detail: `${reconciled.length} verdicts from customer-specific facts; ${gaps} need attention. No model can change these.` });

  // 4. Narrative
  const targets = reconciled.filter((commitment) => commitment.intent === "committed");
  const narratives = new Map<string, Narrative>();
  const applyTemplates = (reason: string | null) => { for (const commitment of targets) narratives.set(commitment.id, templateNarrative(commitment, reason)); };
  if (!live) {
    applyTemplates(null);
    update("narrative", { status: "done", latencyMs: 1, detail: `${targets.length} template drafts built from the verdicts and exact evidence. Reference mode makes no AI call.` });
  } else {
    const model = models.narrative.model;
    const allowed = narrativeSources(targets, sources, labels);
    const user = narrativeInput(targets, allowed, ACCOUNT.name, AS_OF);
    const bytes = utf8Bytes(NARRATIVE_PROMPT, user);
    const timeoutMs = Math.min(STEP_LIMITS.narrative.timeoutMs, timeLeft() - 2000);
    const reservation = model && targets.length > 0 && bytes <= STEP_LIMITS.narrative.maxInputBytes && timeoutMs >= 8000 ? budget!.reserve("narrative", model, bytes, STEP_LIMITS.narrative.maxOutputTokens) : null;
    const skipReason = !model ? models.narrative.disabledReason : targets.length === 0 ? "No active commitments to explain." : bytes > STEP_LIMITS.narrative.maxInputBytes ? "The evidence is larger than the narrative input cap." : timeoutMs < 8000 ? "Not enough time left in this request." : reservation && !reservation.ok ? `Skipped because ${reservation.reason}.` : null;
    if (skipReason || !model || !reservation?.ok) {
      applyTemplates(`Template draft: ${skipReason ?? "the narrative step is off"}`);
      update("narrative", { status: "skipped", detail: `${skipReason ?? "Narrative step is off."} Template drafts are shown instead, clearly labelled.` });
    } else {
      update("narrative", { status: "running", reservedUsd: reservation.reservedUsd, detail: `Writing ${targets.length} evidence briefs…` });
      const scanNarrative = createQuoteScanner(sources, ACCOUNT.id);
      try {
        const { content, trace } = await chatCompletion({ model, system: NARRATIVE_PROMPT, user, maxTokens: STEP_LIMITS.narrative.maxOutputTokens, reasoningEffort: stepReasoningEffort(env).narrative, timeoutMs, stream, signal: options.signal, onProgress: progress("narrative", emitQuotes("narrative", scanNarrative)), fetcher });
        const cost = budget!.settle("narrative", trace.usage);
        const common = { reportedModel: trace.model, latencyMs: trace.elapsedMs, usage: usageOf(trace), runId: trace.runId, costUsd: cost };
        let decisions;
        try { decisions = validateBriefs(parseModelJson(content), targets, allowed); } catch { decisions = null; }
        if (!decisions) {
          applyTemplates(`Template draft: ${modelName(model)} did not return valid briefs`);
          update("narrative", { ...common, status: "fallback", detail: "The briefs failed format validation, so every commitment uses its template draft." });
          check({ stepId: "narrative", ok: false, label: "Narrative output rejected; template drafts used" });
        } else {
          emitQuotes("narrative", scanNarrative)(content);
          let accepted = 0;
          for (const decision of decisions) {
            const commitment = targets.find((candidate) => candidate.id === decision.commitmentId)!;
            if (decision.brief) {
              accepted++;
              narratives.set(commitment.id, briefNarrative(commitment, decision.brief, trace.model, ACCOUNT.name));
              check({ stepId: "narrative", ok: true, commitmentId: commitment.id, label: `${commitment.id} brief accepted: ${decision.citations} exact citations, no new dates or promises, verdict unchanged` });
            } else {
              narratives.set(commitment.id, templateNarrative(commitment, `Template draft: the ${modelName(model)} draft ${decision.reason}`));
              check({ stepId: "narrative", ok: false, commitmentId: commitment.id, label: `${commitment.id} brief rejected: it ${decision.reason}. Template draft used.` });
            }
          }
          update("narrative", { ...common, status: accepted === targets.length ? "done" : "fallback", detail: accepted === targets.length ? `${accepted} briefs accepted. Every claim cites exact source text.` : `${accepted} of ${targets.length} briefs accepted; ${targets.length - accepted} fell back to the labelled template draft.` });
        }
      } catch (error) {
        const failed = error instanceof InferenceError ? error.trace : null;
        if (error instanceof InferenceError && (error.code === "http" || error.code === "rate_limit")) budget!.release("narrative");
        const cost = budget!.settle("narrative", failed?.usage ?? null);
        const reason = callFailure(error, model);
        applyTemplates(`Template draft: ${reason}`);
        update("narrative", { status: "fallback", reportedModel: failed?.model ?? null, latencyMs: failed?.elapsedMs ?? null, usage: usageOf(failed), costUsd: cost, reservedUsd: cost === null ? null : reservation.reservedUsd, detail: `${reason}. Template drafts are shown instead, clearly labelled.` });
      }
    }
  }

  const stepList = Object.values(steps);
  const usage = live ? stepList.reduce<Usage | null>((total, step) => step.usage ? { promptTokens: (total?.promptTokens ?? 0) + step.usage.promptTokens, completionTokens: (total?.completionTokens ?? 0) + step.usage.completionTokens } : total, null) : null;
  const totals = budget?.totals() ?? null;
  const analysis: Analysis = {
    mode: options.mode,
    model: live ? extractionTrace?.model ?? null : null,
    runId: live ? extractionTrace?.runId ?? runId : runId,
    asOf: AS_OF,
    scenario: options.scenario,
    commitments: reconciled.map((commitment) => ({ ...commitment, narrative: narratives.get(commitment.id) ?? null, publicClaim: publicClaims.get(commitment.id) ?? null })),
    sources,
    elapsedMs: Math.round(elapsed()),
    usage,
    pipeline: { replay: !live, steps: stepList, checks, providers: evidence.providers, budgetUsd: budget?.limitUsd ?? null, reservedUsd: totals?.reservedUsd ?? null, costUsd: totals?.costUsd ?? null },
  };
  emit({ type: "result", analysis });
  return analysis;
}
