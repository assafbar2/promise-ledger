import assert from "node:assert/strict";
import test from "node:test";
import { createEvaluationBudget } from "../lib/evaluation-budget.ts";
import { runEvaluation, summarizeEvaluation } from "../lib/evaluation.ts";
import { InferenceError, NEBIUS_MAX_OUTPUT_TOKENS, type InferenceTrace } from "../lib/nebius.ts";
import { heldOutCases } from "../evals/held-out-cases.ts";

const timestamp = Date.parse("2026-09-19T20:00:00.000Z");
const model = "nvidia/test-Nemotron";
const environment = {
  NEBIUS_EVAL_NO_PAID_ROLLOVER: "true",
  NEBIUS_EVAL_PRICE_MODEL: model,
  NEBIUS_EVAL_BUDGET_USD: "0.50",
  NEBIUS_EVAL_FREE_CREDIT_USD: "1",
  NEBIUS_EVAL_INPUT_USD_PER_MILLION: "10",
  NEBIUS_EVAL_OUTPUT_USD_PER_MILLION: "10",
  NEBIUS_EVAL_CONTEXT_TOKENS: "10000",
  NEBIUS_EVAL_VERIFIED_AT: new Date(timestamp).toISOString(),
};
const trace: InferenceTrace = { requestedModel: model, model, runId: "mock-budget-run", requestId: null, httpStatus: 200, elapsedMs: 1, usage: { promptTokens: 100, completionTokens: 100 } };

function makeBudget(overrides: Record<string, string> = {}, now = () => timestamp) {
  const result = createEvaluationBudget({ ...environment, ...overrides }, model, now);
  assert.equal(result.reason, null);
  assert.ok(result.budget);
  return result.budget;
}

test("credit-only evaluation refuses absent, mismatched, stale or unsafe spending configuration", () => {
  const invalid = [
    { NEBIUS_EVAL_NO_PAID_ROLLOVER: "" },
    { NEBIUS_EVAL_PRICE_MODEL: "nvidia/another-Nemotron" },
    { NEBIUS_EVAL_VERIFIED_AT: "2026-09-19T19:00:00.000Z" },
    { NEBIUS_EVAL_VERIFIED_AT: "2026-09-20T20:00:00.000Z" },
    { NEBIUS_EVAL_BUDGET_USD: "0.51" },
    { NEBIUS_EVAL_FREE_CREDIT_USD: "0.50" },
    { NEBIUS_EVAL_INPUT_USD_PER_MILLION: "0" },
    { NEBIUS_EVAL_OUTPUT_USD_PER_MILLION: "Infinity" },
    { NEBIUS_EVAL_CONTEXT_TOKENS: "1" },
    { NEBIUS_EVAL_CONTEXT_TOKENS: "1.5" },
    { NEBIUS_EVAL_INPUT_USD_PER_MILLION: "1e300" },
  ];
  for (const override of invalid) assert.ok(createEvaluationBudget({ ...environment, ...override }, model, () => timestamp).reason);
});

test("reserves full verified context plus capped output, then reconciles reported usage", async () => {
  const budget = makeBudget();
  assert.equal(budget.snapshot().maximumNextRequestUsd, (10000 * 10 + NEBIUS_MAX_OUTPUT_TOKENS * 10) / 1_000_000);
  await budget.wrap(async () => {
    assert.equal(budget.snapshot().accountedUsd, 0.16);
    return { commitments: [], trace };
  })([]);
  assert.equal(budget.snapshot().accountedUsd, 0.002);
  assert.equal(budget.snapshot().calls, 1);
});

test("one shared budget stops both suites before an unaffordable request without fabricating execution", async () => {
  const budget = makeBudget({ NEBIUS_EVAL_BUDGET_USD: "0.20" });
  let calls = 0;
  const runner = budget.wrap(async () => { calls++; return { commitments: [], trace: { ...trace, usage: { promptTokens: 5000, completionTokens: 1000 } } }; });
  const first = await runEvaluation([heldOutCases[0], heldOutCases[1]], runner, async () => {}, () => budget.blockReason());
  const second = await runEvaluation([heldOutCases[2]], runner, async () => {}, () => budget.blockReason());
  assert.equal(calls, 1);
  assert.equal(first[1].status, "not_run");
  assert.equal(second[0].status, "not_run");
  assert.equal(summarizeEvaluation(first).executedCases, 1);
  assert.equal(summarizeEvaluation(second).exactMatchRate, null);
  assert.equal(budget.snapshot().accountedUsd, 0.06);
});

test("unaffordable first request makes no provider call and records no model score", async () => {
  const result = createEvaluationBudget({ ...environment, NEBIUS_EVAL_BUDGET_USD: "0.10" }, model, () => timestamp);
  assert.ok(result.reason);
  assert.ok(result.budget);
  let calls = 0;
  const budget = result.budget;
  const results = await runEvaluation([heldOutCases[0]], budget.wrap(async () => { calls++; return { commitments: [], trace }; }), async () => {}, () => budget.blockReason());
  assert.equal(calls, 0);
  assert.equal(results[0].trace, null);
  assert.equal(summarizeEvaluation(results).executedCases, 0);
});

test("missing usage retains the entire reservation and blocks all further requests", async () => {
  const budget = makeBudget();
  await budget.wrap(async () => ({ commitments: [], trace: { ...trace, usage: null } }))([]);
  assert.equal(budget.snapshot().accountedUsd, 0.16);
  assert.equal(budget.snapshot().uncertainCalls, 1);
  assert.ok(budget.blockReason());
  await assert.rejects(budget.wrap(async () => { throw new Error("Must not run."); })([]), /reconciled/);
  assert.equal(budget.snapshot().calls, 1);
});

test("grounding-rejected outputs still count their recorded usage", async () => {
  const budget = makeBudget();
  await assert.rejects(budget.wrap(async () => { throw new InferenceError("Rejected grounding.", 502, "grounding", trace); })([]), /Rejected grounding/);
  assert.equal(budget.snapshot().accountedUsd, 0.002);
  assert.equal(budget.blockReason(), null);
});

test("transport failures retain their reservation rather than assuming the request was free", async () => {
  const budget = makeBudget();
  await assert.rejects(budget.wrap(async () => { throw new InferenceError("Timed out.", 504, "transport"); })([]), /Timed out/);
  assert.equal(budget.snapshot().accountedUsd, 0.16);
  assert.ok(budget.blockReason());
});

test("unexpected models, invalid usage and exceeded token bounds stop further spending", async () => {
  const traces: InferenceTrace[] = [
    { ...trace, model: "nvidia/another-Nemotron" },
    { ...trace, usage: { promptTokens: -1, completionTokens: 100 } },
    { ...trace, usage: { promptTokens: 100, completionTokens: 0.5 } },
    { ...trace, usage: { promptTokens: 10001, completionTokens: 100 } },
    { ...trace, usage: { promptTokens: 100, completionTokens: NEBIUS_MAX_OUTPUT_TOKENS + 1 } },
  ];
  for (const reported of traces) {
    const budget = makeBudget();
    await budget.wrap(async () => ({ commitments: [], trace: reported }))([]);
    assert.ok(budget.blockReason());
  }
});

test("verification expires during a run and blocks the next request", async () => {
  let current = timestamp;
  const budget = makeBudget({}, () => current);
  await budget.wrap(async () => ({ commitments: [], trace }))([]);
  current += 16 * 60 * 1000;
  assert.match(budget.blockReason() ?? "", /stale/);
});

test("concurrent provider calls cannot share the same available reservation", async () => {
  const budget = makeBudget();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const pending = budget.wrap(async () => { await gate; return { commitments: [], trace }; })([]);
  await assert.rejects(budget.wrap(async () => ({ commitments: [], trace }))([]), /concurrent spending/);
  release();
  await pending;
  assert.equal(budget.snapshot().calls, 1);
  assert.equal(budget.snapshot().accountedUsd, 0.002);
});
