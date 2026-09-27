import { configuration, NEBIUS_MAX_OUTPUT_TOKENS } from "../lib/nebius.ts";
import { EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION } from "../lib/extraction-prompt.ts";
import { createEvaluationBudget, type PlannedRequest } from "../lib/evaluation-budget.ts";
import { deliveryContext, HELD_OUT_AS_OF, northstarCrashingCase, northstarPackCase, PIPELINE_EVALUATION_VERSION, pipelineCase, recordingFetcher, runPipelineEvaluation, summarizePipelineEvaluation, unrunPipelineResults, type ModelCall, type PipelineCase, type PipelineCaseResult } from "../lib/evaluation-pipeline.ts";
import { liveReportWriter, redact, reportStatus } from "../lib/evaluation-reports.ts";
import { AS_OF, FEATURE_IDS } from "../lib/fixtures.ts";
import { CHAT_TEMPLATE_OVERHEAD_TOKENS, NEMOTRON_ID, pipelineModels, STEP_LIMITS, stepReasoningEffort } from "../lib/pipeline/models.ts";
import { NARRATIVE_PROMPT, NARRATIVE_PROMPT_VERSION } from "../lib/pipeline/narrative.ts";
import type { Emit } from "../lib/pipeline/events.ts";
import { runPipeline } from "../lib/pipeline/run.ts";
import { TRIAGE_PROMPT_VERSION, triagePrompt } from "../lib/pipeline/triage.ts";
import { datasetHash as hash, developmentCases, frozenHeldOutCases } from "../evals/suites.ts";

// Full live pipeline per case: Nano triage, Super extraction, deterministic rules, Ultra briefs.
// Sequential, streaming, no retries; every call goes through the credit-only evaluation guard.
const selection = process.argv.find((argument) => argument.startsWith("--suite="))?.split("=")[1] ?? "all";
if (!["all", "development", "held-out"].includes(selection)) throw new Error("Choose --suite=all, --suite=development, or --suite=held-out.");
const heldOutCases = await frozenHeldOutCases();
const { apiKey, model: extractionModel, accessToken } = configuration();
// Streams like the app: non-streaming Nano (reasoning "none") returns its answer in `reasoning` with null content.
const env = { ...process.env, NEBIUS_STREAM: "true" };
const models = pipelineModels(env);
const step = (model: string | null, limit: { maxInputBytes: number }, maxOutputTokens: number): PlannedRequest[] => model ? [{ model, inputTokens: limit.maxInputBytes + CHAT_TEMPLATE_OVERHEAD_TOKENS, maxOutputTokens }] : [];
const plan = [...step(models.triage.model, STEP_LIMITS.triage, STEP_LIMITS.triage.maxOutputTokens), ...step(extractionModel || null, STEP_LIMITS.extraction, NEBIUS_MAX_OUTPUT_TOKENS), ...step(models.narrative.model, STEP_LIMITS.narrative, STEP_LIMITS.narrative.maxOutputTokens)];
const budgetConfiguration = createEvaluationBudget(process.env, [...new Set(plan.map((request) => request.model))], Date.now, plan);
const budget = budgetConfiguration.budget;
const startedAt = new Date().toISOString();
const scratch = process.argv.includes("--scratch");
const reports = liveReportWriter({ startedAt, prefix: "pipeline-", scratch });
// Diagnosis only: select cases and repeat them. Never promoted, so committed reports stay one pass per case.
const only = process.argv.find((argument) => argument.startsWith("--only="))?.slice(7).split(",").filter(Boolean) ?? null;
const repeat = Number(process.argv.find((argument) => argument.startsWith("--repeat="))?.slice(9) ?? 1);
if ((only || repeat !== 1) && !scratch) throw new Error("--only and --repeat are for diagnosis and require --scratch.");
if (!Number.isSafeInteger(repeat) || repeat < 1 || repeat > 10) throw new Error("--repeat must be 1–10.");
const select = (cases: PipelineCase[]) => Array.from({ length: repeat }, (_, round) => cases.filter((sample) => !only || only.includes(sample.id)).map((sample) => repeat === 1 ? sample : { ...sample, id: `${sample.id}#${round + 1}` })).flat();
const suites: { name: string; cases: PipelineCase[]; datasetSha256: string; asOf: string }[] = [
  { name: "development", cases: select([...developmentCases.map((sample) => pipelineCase(sample, AS_OF)), northstarPackCase(), await northstarCrashingCase()]), datasetSha256: hash(developmentCases), asOf: AS_OF },
  { name: "held-out", cases: select(heldOutCases.map((sample) => pipelineCase(sample, HELD_OUT_AS_OF))), datasetSha256: hash(heldOutCases), asOf: HELD_OUT_AS_OF },
].filter((suite) => (selection === "all" || selection === suite.name) && suite.cases.length > 0);
let blockedReason = !apiKey ? "NEBIUS_API_KEY is missing. No provider inference request was made." : !NEMOTRON_ID.test(extractionModel) ? "A valid NVIDIA Nemotron model ID is required in NEBIUS_MODEL. No provider inference request was made." : budgetConfiguration.reason ?? "";

const runCase = async (sample: PipelineCase, observe: Emit, calls: ModelCall[]) => {
  const analysis = await runPipeline({ mode: "live", scenario: "blocked", account: "northstar", env, emit: observe, fetcher: recordingFetcher(budget!.fetcher(fetch), calls), evaluationEvidence: sample.evidence, now: sample.evidence.asOf });
  return { analysis, calls };
};

for (const suite of suites) {
  const serialize = (results: PipelineCaseResult[]) => {
    const metrics = summarizePipelineEvaluation(results);
    const status = reportStatus(metrics.extraction);
    const report = {
      schemaVersion: 1,
      evaluation: `nebius-pipeline-${suite.name}`,
      version: PIPELINE_EVALUATION_VERSION,
      status,
      liveInferenceAttempted: results.some((result) => result.steps !== null),
      startedAt,
      updatedAt: new Date().toISOString(),
      models: { triage: models.triage.model, extraction: extractionModel || null, narrative: models.narrative.model },
      reasoningEffort: { ...stepReasoningEffort(env), extraction: "provider default" },
      streaming: true,
      prompts: {
        triage: { version: TRIAGE_PROMPT_VERSION, sha256: hash(triagePrompt(FEATURE_IDS)) },
        extraction: { version: EXTRACTION_PROMPT_VERSION, sha256: hash(EXTRACTION_PROMPT) },
        narrative: { version: NARRATIVE_PROMPT_VERSION, sha256: hash(NARRATIVE_PROMPT) },
      },
      datasetSha256: suite.datasetSha256,
      pipelineCasesSha256: hash(suite.cases),
      deliveryContext: deliveryContext(suite.asOf).source,
      limitation: suite.name === "held-out"
        ? "Frozen held-out cases (assistant-authored, synthetic) plus one fixed availability snapshot per case. Not an independent benchmark. Do not tune against this set."
        : "Development cases (the eight extraction examples plus the app's Northstar demo pack in its blocked and crashing scenarios), not held-out evidence. Brief acceptance means Ultra's draft passed the deterministic guardrails, not a human quality review.",
      budget: budget?.snapshot() ?? { policy: "verified-free-credit-only", blockedReason: budgetConfiguration.reason },
      metrics,
      cases: results,
    };
    return { status, serialized: redact(`${JSON.stringify(report, null, 2)}\n`, [apiKey, accessToken]) };
  };
  const results = blockedReason || !budget ? unrunPipelineResults(suite.cases, blockedReason || "Credit-only evaluation guard is unavailable.") : await runPipelineEvaluation(suite.cases, runCase, (partial) => reports.checkpoint(suite.name, serialize(partial).serialized), () => budget.blockReason());
  const { status, serialized } = serialize(results);
  const saved = await reports.finish(suite.name, serialized, status);
  const metrics = summarizePipelineEvaluation(results);
  const { extraction, briefs } = metrics;
  console.log(`${suite.name}: ${extraction.executedCases}/${extraction.plannedCases} executed; ${extraction.passed} exact matches, ${extraction.failed} mismatches, ${extraction.errors} errors, ${extraction.notRun} not run. Ultra briefs accepted: ${briefs.accepted}/${briefs.targets}. Report: ${saved.path}`);
  console.log(saved.promoted ? `Complete run: updated ${saved.latestPath}.` : `Status ${status}: no committed report was changed.`);
  if (budget) console.log(`Guard: ${budget.snapshot().calls} calls, $${budget.snapshot().accountedUsd} accounted of $${budget.snapshot().budgetUsd}.`);
  if (extraction.executedCases === 0) console.log("No live model score is available.");
  if (extraction.notRun || extraction.errors || extraction.failed) process.exitCode = extraction.executedCases === 0 ? 2 : 1;
  const fatal = results.find((result) => result.status === "error" && ["configuration", "transport", "http", "rate_limit", "run_budget", "budget_preflight", "unexpected"].includes(result.error?.code ?? ""));
  if (fatal) blockedReason = "Not started because an earlier suite hit a provider/configuration failure. No automatic retry.";
}
