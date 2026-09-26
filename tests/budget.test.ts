import assert from "node:assert/strict";
import test from "node:test";
import { RunBudget, worstCaseUsd } from "../lib/pipeline/budget.ts";
import { modelInfo, PIPELINE_MODEL_DEFAULTS, pipelineModels, RUN_BUDGET_DEFAULT_USD, runBudgetUsd, STEP_LIMITS, stepReasoningEffort } from "../lib/pipeline/models.ts";

test("default models are the catalog IDs verified on September 26, 2026, with their rates", () => {
  assert.deepEqual(PIPELINE_MODEL_DEFAULTS, { triage: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B", extraction: "nvidia/nemotron-3-super-120b-a12b", narrative: "nvidia/Nemotron-3-Ultra-550b-a55b" });
  assert.deepEqual([modelInfo(PIPELINE_MODEL_DEFAULTS.triage).inputUsdPerMillion, modelInfo(PIPELINE_MODEL_DEFAULTS.triage).outputUsdPerMillion], [0.06, 0.24]);
  assert.deepEqual([modelInfo(PIPELINE_MODEL_DEFAULTS.extraction).inputUsdPerMillion, modelInfo(PIPELINE_MODEL_DEFAULTS.extraction).outputUsdPerMillion, modelInfo(PIPELINE_MODEL_DEFAULTS.extraction).contextTokens], [0.3, 0.9, 262144]);
  assert.deepEqual([modelInfo(PIPELINE_MODEL_DEFAULTS.narrative).inputUsdPerMillion, modelInfo(PIPELINE_MODEL_DEFAULTS.narrative).outputUsdPerMillion], [1, 3]);
  assert.equal(modelInfo("nvidia/some-future-Nemotron").listed, false);
  assert.equal(modelInfo("nvidia/some-future-Nemotron").outputUsdPerMillion, 3, "unlisted models are budgeted at the highest listed rate");
});

test("model env: blank means default, off disables, non-Nemotron IDs are refused", () => {
  assert.equal(pipelineModels({}).triage.model, PIPELINE_MODEL_DEFAULTS.triage);
  assert.equal(pipelineModels({ NEBIUS_TRIAGE_MODEL: "  " }).triage.model, PIPELINE_MODEL_DEFAULTS.triage);
  assert.equal(pipelineModels({ NEBIUS_NARRATIVE_MODEL: "off" }).narrative.model, null);
  assert.equal(pipelineModels({ NEBIUS_NARRATIVE_MODEL: "nvidia/nemotron-3-super-120b-a12b" }).narrative.model, "nvidia/nemotron-3-super-120b-a12b");
  const refused = pipelineModels({ NEBIUS_TRIAGE_MODEL: "meta-llama/Llama-3.3-70B-Instruct" }).triage;
  assert.equal(refused.model, null);
  assert.match(refused.disabledReason ?? "", /not an NVIDIA Nemotron/);
  assert.deepEqual(stepReasoningEffort({}), { triage: "none", narrative: "none" });
  assert.deepEqual(stepReasoningEffort({ NEBIUS_TRIAGE_REASONING_EFFORT: "default", NEBIUS_NARRATIVE_REASONING_EFFORT: "HIGH" }), { triage: null, narrative: "high" });
  assert.deepEqual(stepReasoningEffort({ NEBIUS_NARRATIVE_REASONING_EFFORT: "turbo" }), { triage: "none", narrative: "none" });
  assert.equal(runBudgetUsd({}), RUN_BUDGET_DEFAULT_USD);
  assert.equal(runBudgetUsd({ LIVE_RUN_BUDGET_USD: "0.02" }), 0.02);
  for (const value of ["-1", "0", "5", "abc"]) assert.equal(runBudgetUsd({ LIVE_RUN_BUDGET_USD: value }), RUN_BUDGET_DEFAULT_USD);
});

test("the default configuration's hard ceiling per run fits the default budget", () => {
  const ceiling = worstCaseUsd(PIPELINE_MODEL_DEFAULTS.triage, STEP_LIMITS.triage.maxInputBytes, STEP_LIMITS.triage.maxOutputTokens)
    + worstCaseUsd(PIPELINE_MODEL_DEFAULTS.extraction, STEP_LIMITS.extraction.maxInputBytes, STEP_LIMITS.extraction.maxOutputTokens)
    + worstCaseUsd(PIPELINE_MODEL_DEFAULTS.narrative, STEP_LIMITS.narrative.maxInputBytes, STEP_LIMITS.narrative.maxOutputTokens);
  assert.ok(Math.abs(ceiling - 0.049577) < 0.000002, String(ceiling));
  assert.ok(ceiling <= RUN_BUDGET_DEFAULT_USD);
});

test("RunBudget reserves worst cases, settles to usage, holds room for extraction, and flags bound violations", () => {
  const budget = new RunBudget(0.02);
  budget.hold("extraction", PIPELINE_MODEL_DEFAULTS.extraction, 10000, 6000);
  const triage = budget.reserve("triage", PIPELINE_MODEL_DEFAULTS.triage, 10000, 3000);
  assert.ok(triage.ok);
  assert.equal(budget.settle("triage", { promptTokens: 1000, completionTokens: 500 }), 0.00018);
  assert.ok(budget.reserve("extraction", PIPELINE_MODEL_DEFAULTS.extraction, 10000, 6000).ok);
  const narrative = budget.reserve("narrative", PIPELINE_MODEL_DEFAULTS.narrative, 10000, 7000);
  assert.equal(narrative.ok, false, "Ultra's worst case does not fit next to extraction's reservation");
  budget.settle("extraction", { promptTokens: 2000, completionTokens: 1000 });
  assert.equal(budget.reserve("narrative", PIPELINE_MODEL_DEFAULTS.narrative, 3000, 4000).ok, true, "after settling, the freed budget is usable");
  budget.settle("narrative", { promptTokens: 99999, completionTokens: 1 });
  assert.match(budget.violation ?? "", /more tokens/);
  assert.equal(budget.reserve("rules", PIPELINE_MODEL_DEFAULTS.triage, 10, 10).ok, false);
});
