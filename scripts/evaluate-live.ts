import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { ACCOUNT, AS_OF } from "../lib/fixtures.ts";
import { configuration, extractWithNebius } from "../lib/nebius.ts";
import { EXTRACTION_PROMPT, EXTRACTION_PROMPT_VERSION } from "../lib/extraction-prompt.ts";
import { runEvaluation, summarizeEvaluation, unrunResults, type EvaluationResult } from "../lib/evaluation.ts";
import { createEvaluationBudget } from "../lib/evaluation-budget.ts";
import { extractionCases } from "../evals/extraction-cases.ts";
import { heldOutCases } from "../evals/held-out-cases.ts";
import type { ExtractionCase } from "../evals/types.ts";

const selection = process.argv.find((argument) => argument.startsWith("--suite="))?.split("=")[1] ?? "all";
if (!["all", "development", "held-out"].includes(selection)) throw new Error("Choose --suite=all, --suite=development, or --suite=held-out.");
const developmentCases: ExtractionCase[] = extractionCases.map((sample) => ({ id: `dev-${sample.id}`, category: sample.id, expected: sample.expected ? [{ featureId: "audit-export", ...sample.expected, intent: sample.expected.intent as "committed" | "tentative" }] : [], sources: [{ id: "EVAL-01", accountId: ACCOUNT.id, kind: "Meeting", title: sample.id, author: "Synthetic development evaluation", observedAt: AS_OF, text: sample.text }] }));
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const manifest = JSON.parse(await readFile(new URL("../evals/held-out-manifest.json", import.meta.url), "utf8"));
if (manifest.sha256 !== hash(heldOutCases)) throw new Error("Held-out dataset changed after freezing. Version and review it before running inference.");
const { apiKey, model, accessToken } = configuration();
const budgetConfiguration = createEvaluationBudget(process.env, model);
const budget = budgetConfiguration.budget;
const startedAt = new Date().toISOString();
const runDirectory = `docs/evaluation/runs/${startedAt.replace(/[:.]/g, "-")}`;
await mkdir(runDirectory, { recursive: true });
const suites = [{ name: "development", cases: developmentCases }, { name: "held-out", cases: heldOutCases }].filter((suite) => selection === "all" || selection === suite.name);
let blockedReason = !apiKey ? "NEBIUS_API_KEY is missing. No provider inference request was made." : !/^nvidia\/.*nemotron/i.test(model) ? "A valid NVIDIA Nemotron model ID is required. No provider inference request was made." : budgetConfiguration.reason ?? "";
for (const suite of suites) {
  const save = async (results: EvaluationResult[]) => {
    const metrics = summarizeEvaluation(results);
    const report = { schemaVersion: 2, evaluation: `nebius-${suite.name}`, status: metrics.executedCases === 0 ? "blocked" : metrics.notRun > 0 ? "partial" : "complete", liveInferenceAttempted: results.some((result) => result.trace !== null), startedAt, updatedAt: new Date().toISOString(), requestedModel: model || null, promptVersion: EXTRACTION_PROMPT_VERSION, promptSha256: hash(EXTRACTION_PROMPT), datasetSha256: hash(suite.cases), limitation: suite.name === "held-out" ? "Frozen before the first live run; assistant-authored synthetic cases, not an independent external benchmark. Do not tune against this set." : "Development examples, not held-out evidence. Accepted-output feature metrics exclude provider/validation errors; overall exact match includes errors.", budget: budget?.snapshot() ?? { policy: "verified-free-credit-only", blockedReason: budgetConfiguration.reason }, metrics, cases: results };
    let serialized = `${JSON.stringify(report, null, 2)}\n`;
    for (const secret of [apiKey, accessToken].filter((value) => value.length > 0)) serialized = serialized.split(secret).join("[REDACTED]");
    const reportPath = `${runDirectory}/${suite.name}.json`;
    await writeFile(`${reportPath}.tmp`, serialized);
    await rename(`${reportPath}.tmp`, reportPath);
    await writeFile(`docs/evaluation/${suite.name}-latest.json`, serialized);
  };
  const results = blockedReason || !budget ? unrunResults(suite.cases, blockedReason || "Credit-only evaluation guard is unavailable.") : await runEvaluation(suite.cases, budget.wrap(extractWithNebius), save, () => budget.blockReason());
  await save(results);
  const metrics = summarizeEvaluation(results);
  console.log(`${suite.name}: ${metrics.executedCases}/${metrics.plannedCases} executed; ${metrics.passed} passed, ${metrics.failed} failed, ${metrics.errors} errors, ${metrics.notRun} not run. Reports: ${runDirectory}/${suite.name}.json`);
  if (metrics.executedCases === 0) console.log("No live model score is available.");
  if (metrics.notRun || metrics.errors || metrics.failed) process.exitCode = metrics.executedCases === 0 ? 2 : 1;
  const fatal = results.find((result) => result.status === "error" && ["configuration", "transport", "http", "rate_limit", "unexpected"].includes(result.error?.code ?? ""));
  if (fatal) blockedReason = "Not started because an earlier suite hit a provider/configuration failure. No automatic retry.";
}
