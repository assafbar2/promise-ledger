import { accountPack } from "../accounts";
import { compactSteps, continuationSecret, signContinuation, type ContinuationPayload } from "../byo/continuation";
import { byoExtractionMessages, validateByoExtraction, type ByoExtraction } from "../byo/extraction";
import { detectInjection } from "../byo/injection";
import { BYO_LIMITS } from "../byo/limits";
import { patternExtract } from "../byo/pattern";
import type { ByoRequest } from "../byo/schema";
import { BYO_ACCOUNT, normalizeByoSource, sourcesDigest, workspaceName } from "../byo/sources";
import { EVIDENCE_PROVIDERS, providersFor } from "../evidence/providers";
import { collectEvidence, EvidenceError } from "../evidence/registry";
import type { EvidenceProvider } from "../evidence/types";
import { extractionPrompt } from "../extraction-prompt";
import { chatCompletion, extractionMessages, extractWithNebius, InferenceError, NEBIUS_MAX_OUTPUT_TOKENS, type InferenceTrace, type StreamProgress } from "../nebius";
import { reconcile, validateExtraction } from "../reconcile";
import type { Analysis, AnalysisAccount, ByoProposal, Commitment, Narrative, PipelineCheck, ProductFact, ReconciledCommitment, Scenario, Source, StepId, StepSummary, Usage } from "../schema";
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
  /** Sample account ID; defaults to Northstar. Ignored when `byo` is set. */
  account?: string;
  /** Bring-your-own evidence: the extract step proposes facts, the decide step runs rules on confirmed ones. */
  byo?: ByoRequest;
  /** Verified by the service before a live decide step; carries the extraction's steps and cost. */
  continuation?: ContinuationPayload | null;
  now?: string;
};

export type PipelineOutcome = { kind: "analysis"; analysis: Analysis } | { kind: "proposal"; proposal: ByoProposal };

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

function sumUsage(steps: StepSummary[]) {
  return steps.reduce<Usage | null>((total, step) => step.usage ? { promptTokens: (total?.promptTokens ?? 0) + step.usage.promptTokens, completionTokens: (total?.completionTokens ?? 0) + step.usage.completionTokens } : total, null);
}

/** Turns confirmed facts from the browser into rule inputs, re-checking every quote against the sources. */
function confirmedFacts(byo: Extract<ByoRequest, { phase: "decide" }>, sources: Source[]): ProductFact[] {
  const seen = new Set<string>();
  return byo.facts.map((fact) => {
    if (seen.has(fact.featureId)) throw new PipelineError(`Two confirmed facts describe ${fact.featureId}. Keep one per feature.`, 400, "byo_facts");
    seen.add(fact.featureId);
    for (const evidence of fact.evidence) {
      const source = sources.find((candidate) => candidate.id === evidence.sourceId);
      if (!source || evidence.quote.length < 12 || !source.text.includes(evidence.quote)) throw new PipelineError(`A confirmed fact for ${fact.featureId} quotes text that is not in its source.`, 400, "byo_facts");
    }
    return { featureId: fact.featureId, accountId: BYO_ACCOUNT, built: fact.built, enabled: fact.enabled, verified: fact.verified, observedAt: new Date(fact.observedAt).toISOString(), evidence: fact.evidence, confirmation: { by: "user", proposedBy: fact.proposedBy, corrected: fact.corrected } };
  });
}

export async function executePipeline(options: PipelineOptions): Promise<PipelineOutcome> {
  const env = options.env ?? process.env;
  const emit: Emit = options.emit ?? (() => {});
  const fetcher = options.fetcher ?? fetch;
  const live = options.mode === "live";
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  const timeLeft = () => RUN_DEADLINE_MS - elapsed();
  const stream = !/^(false|0|off|no)$/i.test((env.NEBIUS_STREAM ?? "").trim());
  const byo = options.byo ?? null;
  const extracting = byo?.phase === "extract";
  const deciding = byo?.phase === "decide" ? byo : null;
  const prior = deciding && live ? options.continuation ?? null : null;
  if (deciding && live && !prior) throw new PipelineError("This confirmation needs its extraction run. Start a new extraction, or re-run the rules without AI.", 409, "continuation", "reference");
  const runId = prior?.runId ?? crypto.randomUUID();
  const pack = byo ? null : accountPack(options.account);
  if (!byo && !pack) throw new PipelineError("Choose one of the sample accounts.", 400, "account");
  if (pack && !pack.scenarios.includes(options.scenario)) throw new PipelineError(`${pack.name} does not have that demo scenario.`, 400, "scenario");
  const now = options.now ?? new Date().toISOString();
  const account: AnalysisAccount = pack ? { id: pack.id, name: pack.name, kind: "sample" } : { id: BYO_ACCOUNT, name: workspaceName(byo!.workspace), kind: "byo" };
  const asOf = pack ? pack.asOf : now;
  const featureIds = pack ? pack.featureIds : null;
  const byoInputs = byo ? byo.sources.map(normalizeByoSource) : undefined;

  let evidence;
  try {
    evidence = await collectEvidence({ accountId: account.id, featureIds: featureIds ?? [], scenario: options.scenario, mode: options.mode, asOf, now, signal: options.signal, env, userEvidence: byoInputs }, providersFor(account.id, options.providers ?? EVIDENCE_PROVIDERS));
  } catch (error) {
    throw new PipelineError(`Evidence could not be collected${error instanceof EvidenceError ? `: ${error.message}` : "."} No results were accepted.`, byo ? 400 : 502, "evidence", live && !byo ? "reference" : undefined);
  }
  const { sources } = evidence;
  const models = pipelineModels(env);
  const budgetUsd = live ? runBudgetUsd(env) : null;
  const budget = live ? new RunBudget(Math.max(0, runBudgetUsd(env) - (prior?.costUsd ?? 0))) : null;
  const checks: PipelineCheck[] = [...(prior?.checks ?? [])];
  const extractionEngine = byo && !live ? (deciding?.extractor === "nemotron" ? "confirmed" : "pattern") : "fixture";
  const steps: Record<StepId, StepSummary> = live
    ? {
      triage: stepSummary("triage", { model: models.triage.model }),
      extraction: stepSummary("extraction", { model: models.extraction }),
      rules: stepSummary("rules", { engine: "rules" }),
      narrative: stepSummary("narrative", { model: models.narrative.model }),
    }
    : {
      triage: stepSummary("triage", { engine: "fixture" }),
      extraction: stepSummary("extraction", { engine: extractionEngine }),
      rules: stepSummary("rules", { engine: "rules" }),
      narrative: stepSummary("narrative", { engine: "template" }),
    };
  for (const step of prior?.steps ?? []) if (step.id === "triage" || step.id === "extraction") steps[step.id] = step;
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

  emit({ type: "run", runId, mode: options.mode, scenario: options.scenario, replay: !live, budgetUsd, steps: Object.values(steps), providers: evidence.providers });
  for (const check of prior?.checks ?? []) emit({ type: "check", check });

  const byoExtractionInput = () => byoExtractionMessages(sources);
  if (live && budget && !deciding) {
    const { system, user } = byo ? byoExtractionInput() : extractionMessages(sources, extractionPrompt(account.id, featureIds!));
    budget.hold("extraction", models.extraction, utf8Bytes(system, user), NEBIUS_MAX_OUTPUT_TOKENS);
  }

  const flagged = new Map<string, string>();
  if (!deciding) {
    for (const source of sources) {
      const phrase = detectInjection(source.text);
      if (!phrase) continue;
      flagged.set(source.id, `addresses an AI system ("${phrase}")`);
      check({ stepId: "triage", ok: true, label: `${source.id} addresses an AI system ("${phrase}"). It stays data, never instructions.` });
    }
  }

  // 1. Triage
  let labels: TriageLabel[] = referenceTriage(sources, featureIds ?? []);
  let routing: Routing = allSourcesRouting(sources);
  if (deciding) {
    if (!live) update("triage", { status: "done", latencyMs: 1, detail: "Routing ran in the extract step. No AI call." });
  } else if (!live) {
    const stepStarted = performance.now();
    routing = byo ? allSourcesRouting(sources) : routeSources(sources, labels);
    update("triage", { status: "done", latencyMs: Math.max(1, Math.round(performance.now() - stepStarted)), detail: byo ? `Reference routing: all ${sources.length} of your sources go to the pattern matcher. No AI call.` : `Reference routing by source type: ${routing.extraction.length} of ${sources.length} sources go to extraction. No AI call.` });
  } else {
    const model = models.triage.model;
    const system = triagePrompt(featureIds);
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
          labels = validateTriage(parseModelJson(result.content), sources, featureIds);
          routing = routeSources(sources, labels, byo !== null);
          const suspected = labels.filter((label) => label.injectionSuspected).map((label) => label.sourceId);
          for (const sourceId of suspected) if (!flagged.has(sourceId)) flagged.set(sourceId, "flagged by triage as addressing an AI system");
          const skipped = byo ? `${routing.directToRules.length} unrelated source${routing.directToRules.length === 1 ? "" : "s"} skipped` : `${routing.directToRules.length} delivery records go straight to the rules`;
          update("triage", { ...common, status: "done", detail: `Routed ${routing.extraction.length} of ${sources.length} sources to extraction; ${skipped}.${routing.guardKept.length ? ` Recall guard kept ${routing.guardKept.join(", ")} (explicit commitment language).` : ""}${suspected.length ? ` Possible prompt injection flagged in ${suspected.join(", ")}.` : ""}` });
          check({ stepId: "triage", ok: true, label: `Every source classified exactly once (${sources.length}/${sources.length})` });
          if (routing.guardKept.length) check({ stepId: "triage", ok: true, label: `Recall guard kept ${routing.guardKept.join(", ")} for extraction` });
        } catch {
          labels = sources.map((source) => ({ sourceId: source.id, role: "commitment", features: [], injectionSuspected: false }));
          routing = allSourcesRouting(sources);
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
  const scanExtraction = createQuoteScanner(routing.extraction, account.id);
  const emitQuotes = (stepId: StepId, scan: ReturnType<typeof createQuoteScanner>) => (content: string) => {
    for (const quote of scan(content)) emit({ type: "quote", stepId, ...quote });
  };
  let commitments: Commitment[];
  let facts: ProductFact[] = evidence.facts;
  let proposed: ByoExtraction | null = null;
  let extractionTrace: InferenceTrace | null = null;
  if (deciding) {
    try { commitments = validateExtraction({ commitments: deciding.commitments }, sources, BYO_ACCOUNT, null); } catch {
      throw new PipelineError("A confirmed commitment no longer matches its source text. Extract again.", 400, "byo_commitments");
    }
    facts = confirmedFacts(deciding, sources);
    const corrected = deciding.facts.filter((fact) => fact.corrected.length > 0).length;
    if (!live) update("extraction", { status: "done", latencyMs: 1, detail: `${commitments.length} commitments and ${facts.length} facts, as you confirmed them. No AI call in this step.` });
    emitQuotes("extraction", createQuoteScanner(sources, account.id))(JSON.stringify({ commitments, facts }));
    check({ stepId: "extraction", ok: true, label: `You confirmed ${facts.length} availability fact${facts.length === 1 ? "" : "s"}${corrected ? `, correcting ${corrected}` : ""}; every quote re-checked against its source` });
    if (deciding.excludedCommitments > 0) check({ stepId: "extraction", ok: true, label: `You excluded ${deciding.excludedCommitments} proposed commitment${deciding.excludedCommitments === 1 ? "" : "s"}` });
  } else if (!live && !byo) {
    update("extraction", { status: "running", detail: "Loading hand-labelled reference commitments…" });
    const stepStarted = performance.now();
    commitments = validateExtraction({ commitments: pack!.referenceCommitments }, routing.extraction, account.id, featureIds);
    emitQuotes("extraction", scanExtraction)(JSON.stringify({ commitments }));
    update("extraction", { status: "done", latencyMs: Math.max(1, Math.round(performance.now() - stepStarted)), detail: `${commitments.length} hand-labelled commitments, every quote checked against its source. No AI call.` });
  } else if (!live) {
    const stepStarted = performance.now();
    proposed = patternExtract(routing.extraction);
    commitments = proposed.commitments;
    emitQuotes("extraction", scanExtraction)(JSON.stringify(proposed));
    update("extraction", { status: "done", latencyMs: Math.max(1, Math.round(performance.now() - stepStarted)), detail: `Pattern matcher proposed ${commitments.length} commitments and ${proposed.facts.length} availability facts. It only finds explicit "will … by YYYY-MM-DD" promises and key=value availability lines. No AI call.` });
  } else {
    const model = models.extraction;
    const { system, user } = byo ? byoExtractionMessages(routing.extraction) : extractionMessages(routing.extraction, extractionPrompt(account.id, featureIds!));
    const bytes = utf8Bytes(system, user);
    if (bytes > STEP_LIMITS.extraction.maxInputBytes) {
      update("extraction", { status: "failed", detail: "The routed sources exceed the extraction input cap." });
      throw new PipelineError("The evidence pack is too large for one extraction call. No results were accepted.", 413, "input_too_large", byo ? undefined : "reference");
    }
    const reservation = budget!.reserve("extraction", model, bytes, NEBIUS_MAX_OUTPUT_TOKENS);
    if (!reservation.ok) {
      update("extraction", { status: "failed", detail: `Not dispatched: ${reservation.reason}.` });
      throw new PipelineError("This run's cost budget cannot cover extraction. No results were accepted.", 503, "run_budget", "reference");
    }
    update("extraction", { status: "running", reservedUsd: reservation.reservedUsd, detail: `Reading ${routing.extraction.length} routed sources…` });
    try {
      if (byo) {
        const result = await chatCompletion({ model, system, user, maxTokens: NEBIUS_MAX_OUTPUT_TOKENS, timeoutMs: Math.min(STEP_LIMITS.extraction.timeoutMs, timeLeft() - 3000), stream, signal: options.signal, onProgress: progress("extraction", emitQuotes("extraction", scanExtraction)), fetcher });
        extractionTrace = result.trace;
        try { proposed = validateByoExtraction(parseModelJson(result.content), routing.extraction); } catch {
          throw new InferenceError("Model output failed source validation. No ungrounded facts were accepted.", 502, "grounding", result.trace);
        }
        commitments = proposed.commitments;
        emitQuotes("extraction", scanExtraction)(JSON.stringify(proposed));
      } else {
        const result = await extractWithNebius(routing.extraction, fetcher, { model, stream, accountId: account.id, featureIds: featureIds!, timeoutMs: Math.min(STEP_LIMITS.extraction.timeoutMs, timeLeft() - 3000), signal: options.signal, onProgress: progress("extraction", emitQuotes("extraction", scanExtraction)) });
        extractionTrace = result.trace;
        commitments = result.commitments;
        emitQuotes("extraction", scanExtraction)(JSON.stringify({ commitments }));
      }
      const cost = budget!.settle("extraction", extractionTrace.usage);
      update("extraction", { status: "done", reportedModel: extractionTrace.model, latencyMs: extractionTrace.elapsedMs, usage: usageOf(extractionTrace), runId: extractionTrace.runId, costUsd: cost, detail: proposed ? `${commitments.length} commitments and ${proposed.facts.length} availability facts proposed, each quoting its source.${proposed.dropped.length ? ` ${proposed.dropped.length} ungrounded item${proposed.dropped.length === 1 ? "" : "s"} dropped.` : ""}` : `${commitments.length} commitments accepted; owners and dates appear in their quotes.` });
    } catch (error) {
      const failed = error instanceof InferenceError ? error.trace : null;
      if (error instanceof InferenceError && (error.code === "http" || error.code === "rate_limit")) budget!.release("extraction");
      const cost = budget!.settle("extraction", failed?.usage ?? null);
      update("extraction", { status: "failed", reportedModel: failed?.model ?? null, latencyMs: failed?.elapsedMs ?? null, usage: usageOf(failed), runId: failed?.runId ?? null, costUsd: cost, detail: error instanceof InferenceError ? error.message : "Extraction failed." });
      if (error instanceof InferenceError) throw new PipelineError(error.message, error.status, error.code, "reference");
      throw new PipelineError("Analysis could not be validated. No results were accepted.", 500, "extraction", "reference");
    }
  }
  const quoteCount = commitments.reduce((total, commitment) => total + commitment.evidence.length, 0) + (proposed?.facts.reduce((total, fact) => total + fact.evidence.length, 0) ?? 0);
  if (!deciding) check({ stepId: "extraction", ok: true, label: `${quoteCount} of ${quoteCount} quotes are exact text from their sources` });

  if (extracting && proposed) {
    for (const reason of proposed.dropped.slice(0, 6)) check({ stepId: "extraction", ok: false, label: `Dropped: ${reason}` });
    update("rules", { detail: "Waiting for you to confirm or correct the extracted facts. Rules decide only after you do." });
    update("narrative", { detail: "Runs after the rules decide." });
    const stepList = Object.values(steps);
    const totals = budget?.totals() ?? null;
    let continuation: ByoProposal["continuation"] = null;
    const secret = continuationSecret(env);
    if (live && totals && secret) {
      const exp = Math.floor(Date.parse(now) / 1000) + BYO_LIMITS.continuationTtlSeconds;
      const payload: ContinuationPayload = { v: 1, runId: extractionTrace?.runId ?? runId, exp, digest: await sourcesDigest(byoInputs!, account.name), model: extractionTrace?.model ?? null, costUsd: totals.costUsd, reservedUsd: totals.reservedUsd, elapsedMs: Math.round(elapsed()), steps: compactSteps([steps.triage, steps.extraction]), checks };
      continuation = { token: await signContinuation(payload, secret), expiresAt: new Date(exp * 1000).toISOString() };
    }
    const proposal: ByoProposal = {
      runId: live ? extractionTrace?.runId ?? runId : runId,
      mode: options.mode,
      extractor: live ? "nemotron" : "pattern",
      model: live ? extractionTrace?.model ?? null : null,
      account,
      asOf,
      sources,
      commitments,
      facts: proposed.facts,
      flagged: [...flagged].map(([sourceId, reason]) => ({ sourceId, reason })),
      dropped: proposed.dropped,
      elapsedMs: Math.round(elapsed()),
      usage: live ? sumUsage(stepList) : null,
      pipeline: { replay: !live, steps: stepList, checks, providers: evidence.providers, budgetUsd, reservedUsd: totals?.reservedUsd ?? null, costUsd: totals?.costUsd ?? null },
      continuation,
    };
    emit({ type: "proposal", proposal });
    return { kind: "proposal", proposal };
  }

  // 3. Deterministic rules
  update("rules", { status: "running", detail: "Applying the ordered delivery policy…" });
  const rulesStarted = performance.now();
  const reconciled: ReconciledCommitment[] = commitments.map((commitment) => reconcile(commitment, facts, account.id, asOf, evidence, account.name));
  for (const commitment of reconciled) emit({ type: "verdict", commitmentId: commitment.id, title: commitment.title, verdict: commitment.verdict });
  const gaps = reconciled.filter((commitment) => ["blocked", "overdue", "verify", "unknown"].includes(commitment.verdict)).length;
  update("rules", { status: "done", latencyMs: Math.max(1, Math.round(performance.now() - rulesStarted)), detail: `${reconciled.length} verdicts from ${deciding ? "the facts you confirmed" : "customer-specific facts"}; ${gaps} need attention. No model can change these.` });

  // 4. Narrative
  const targets = reconciled.filter((commitment) => commitment.intent === "committed");
  const narratives = new Map<string, Narrative>();
  const applyTemplates = (reason: string | null) => { for (const commitment of targets) narratives.set(commitment.id, templateNarrative(commitment, reason, account.name)); };
  if (!live) {
    applyTemplates(null);
    update("narrative", { status: "done", latencyMs: 1, detail: `${targets.length} template drafts built from the verdicts and exact evidence. Reference mode makes no AI call.` });
  } else {
    const model = models.narrative.model;
    const allowed = narrativeSources(targets, sources, labels);
    const user = narrativeInput(targets, allowed, account.name, asOf);
    const bytes = utf8Bytes(NARRATIVE_PROMPT, user);
    const timeoutMs = Math.min(STEP_LIMITS.narrative.timeoutMs, timeLeft() - 2000);
    const reservation = model && targets.length > 0 && bytes <= STEP_LIMITS.narrative.maxInputBytes && timeoutMs >= 8000 ? budget!.reserve("narrative", model, bytes, STEP_LIMITS.narrative.maxOutputTokens) : null;
    const skipReason = !model ? models.narrative.disabledReason : targets.length === 0 ? "No active commitments to explain." : bytes > STEP_LIMITS.narrative.maxInputBytes ? "The evidence is larger than the narrative input cap." : timeoutMs < 8000 ? "Not enough time left in this request." : reservation && !reservation.ok ? `Skipped because ${reservation.reason}.` : null;
    if (skipReason || !model || !reservation?.ok) {
      applyTemplates(`Template draft: ${skipReason ?? "the narrative step is off"}`);
      update("narrative", { status: "skipped", detail: `${skipReason ?? "Narrative step is off."} Template drafts are shown instead, clearly labelled.` });
    } else {
      update("narrative", { status: "running", reservedUsd: reservation.reservedUsd, detail: `Writing ${targets.length} evidence briefs…` });
      const scanNarrative = createQuoteScanner(sources, account.id);
      try {
        const { content, trace } = await chatCompletion({ model, system: NARRATIVE_PROMPT, user, maxTokens: STEP_LIMITS.narrative.maxOutputTokens, reasoningEffort: stepReasoningEffort(env).narrative, timeoutMs, stream, signal: options.signal, onProgress: progress("narrative", emitQuotes("narrative", scanNarrative)), fetcher });
        const cost = budget!.settle("narrative", trace.usage);
        const common = { reportedModel: trace.model, latencyMs: trace.elapsedMs, usage: usageOf(trace), runId: trace.runId, costUsd: cost };
        let decisions;
        try { decisions = validateBriefs(parseModelJson(content), targets, allowed, account.name); } catch { decisions = null; }
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
              narratives.set(commitment.id, briefNarrative(commitment, decision.brief, trace.model, account.name));
              check({ stepId: "narrative", ok: true, commitmentId: commitment.id, label: `${commitment.id} brief accepted: ${decision.citations} exact citations, no new dates or promises, verdict unchanged` });
            } else {
              narratives.set(commitment.id, templateNarrative(commitment, `Template draft: the ${modelName(model)} draft ${decision.reason}`, account.name));
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
  const totals = budget?.totals() ?? null;
  const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
  const analysis: Analysis = {
    mode: options.mode,
    model: live ? prior?.model ?? extractionTrace?.model ?? null : null,
    runId: live ? prior?.runId ?? extractionTrace?.runId ?? runId : runId,
    asOf,
    scenario: options.scenario,
    account,
    ...(deciding ? { byo: { extractor: deciding.extractor, confirmedFacts: facts.length, correctedFacts: deciding.facts.filter((fact) => fact.corrected.length > 0).length, excludedCommitments: deciding.excludedCommitments } } : {}),
    commitments: reconciled.map((commitment) => ({ ...commitment, narrative: narratives.get(commitment.id) ?? null })),
    sources,
    elapsedMs: Math.round(elapsed()) + (prior?.elapsedMs ?? 0),
    usage: live ? sumUsage(stepList) : null,
    pipeline: { replay: !live, steps: stepList, checks, providers: evidence.providers, budgetUsd, reservedUsd: totals ? round(totals.reservedUsd + (prior?.reservedUsd ?? 0)) : null, costUsd: totals ? round(totals.costUsd + (prior?.costUsd ?? 0)) : null },
  };
  emit({ type: "result", analysis });
  return { kind: "analysis", analysis };
}

export async function runPipeline(options: PipelineOptions): Promise<Analysis> {
  const outcome = await executePipeline(options);
  if (outcome.kind !== "analysis") throw new PipelineError("This request proposes facts for confirmation; it does not produce verdicts.", 400, "byo_phase");
  return outcome.analysis;
}

export async function runByoExtraction(options: PipelineOptions & { byo: Extract<ByoRequest, { phase: "extract" }> }): Promise<ByoProposal> {
  const outcome = await executePipeline(options);
  if (outcome.kind !== "proposal") throw new PipelineError("Extraction did not return a proposal.", 500, "byo_phase");
  return outcome.proposal;
}
