import { configuration, extractWithNebius } from "../lib/nebius.ts";
import { EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION } from "../lib/extraction-prompt.ts";
import { runEvaluation, summarizeEvaluation, unrunResults, type EvaluationResult } from "../lib/evaluation.ts";
import { createEvaluationBudget } from "../lib/evaluation-budget.ts";
import { liveReportWriter, redact, reportStatus } from "../lib/evaluation-reports.ts";
import { datasetHash as hash, developmentCases, frozenHeldOutCases } from "../evals/suites.ts";

const selection = process.argv.find((argument) => argument.startsWith("--suite="))?.split("=")[1] ?? "all";
if (!["all", "development", "held-out"].includes(selection)) throw new Error("Choose --suite=all, --suite=development, or --suite=held-out.");
const heldOutCases = await frozenHeldOutCases();
const { apiKey, model, accessToken } = configuration();
const budgetConfiguration = createEvaluationBudget(process.env, model);
const budget = budgetConfiguration.budget;
const startedAt = new Date().toISOString();
const reports = liveReportWriter({ startedAt, scratch: process.argv.includes("--scratch") });
const suites = [{ name: "development", cases: developmentCases }, { name: "held-out", cases: heldOutCases }].filter((suite) => selection === "all" || selection === suite.name);
let blockedReason = !apiKey ? "NEBIUS_API_KEY is missing. No provider inference request was made." : !/^nvidia\/.*nemotron/i.test(model) ? "A valid NVIDIA Nemotron model ID is required. No provider inference request was made." : budgetConfiguration.reason ?? "";
for (const suite of suites) {
  const serialize = (results: EvaluationResult[]) => {
    const metrics = summarizeEvaluation(results);
    const status = reportStatus(metrics);
    const report = { schemaVersion: 2, evaluation: `nebius-${suite.name}`, status, liveInferenceAttempted: results.some((result) => result.trace !== null), startedAt, updatedAt: new Date().toISOString(), requestedModel: model || null, promptVersion: EXTRACTION_PROMPT_VERSION, promptSha256: hash(EXTRACTION_PROMPT), datasetSha256: hash(suite.cases), limitation: suite.name === "held-out" ? "Frozen before the first live run; assistant-authored synthetic cases, not an independent external benchmark. Do not tune against this set." : "Development examples, not held-out evidence. Accepted-output feature metrics exclude provider/validation errors; overall exact match includes errors.", budget: budget?.snapshot() ?? { policy: "verified-free-credit-only", blockedReason: budgetConfiguration.reason }, metrics, cases: results };
    return { status, serialized: redact(`${JSON.stringify(report, null, 2)}\n`, [apiKey, accessToken]) };
  };
  const results = blockedReason || !budget ? unrunResults(suite.cases, blockedReason || "Credit-only evaluation guard is unavailable.") : await runEvaluation(suite.cases, budget.wrap(extractWithNebius), (partial) => reports.checkpoint(suite.name, serialize(partial).serialized), () => budget.blockReason());
  const { status, serialized } = serialize(results);
  const saved = await reports.finish(suite.name, serialized, status);
  const metrics = summarizeEvaluation(results);
  console.log(`${suite.name}: ${metrics.executedCases}/${metrics.plannedCases} executed; ${metrics.passed} passed, ${metrics.failed} failed, ${metrics.errors} errors, ${metrics.notRun} not run. Report: ${saved.path}`);
  console.log(saved.promoted ? `Complete run: updated ${saved.latestPath}.` : `Status ${status}: the committed ${suite.name}-latest.json was left unchanged.`);
  if (metrics.executedCases === 0) console.log("No live model score is available.");
  if (metrics.notRun || metrics.errors || metrics.failed) process.exitCode = metrics.executedCases === 0 ? 2 : 1;
  const fatal = results.find((result) => result.status === "error" && ["configuration", "transport", "http", "rate_limit", "unexpected"].includes(result.error?.code ?? ""));
  if (fatal) blockedReason = "Not started because an earlier suite hit a provider/configuration failure. No automatic retry.";
}
