import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { heldOutCases } from "../evals/held-out-cases.ts";
import { extractionCases } from "../evals/extraction-cases.ts";
import { runEvaluation, summarizeEvaluation, unrunResults } from "../lib/evaluation.ts";
import { InferenceError, type InferenceTrace } from "../lib/nebius.ts";
import { referenceCommitments } from "../lib/fixtures.ts";

const trace: InferenceTrace = { requestedModel: "nvidia/test-Nemotron", model: "nvidia/test-Nemotron", runId: "test-run", requestId: "test-request", httpStatus: 200, elapsedMs: 12, usage: { promptTokens: 100, completionTokens: 50 } };
const example = heldOutCases[0];
const correct = { ...referenceCommitments[0], ...example.expected[0] };

test("held-out set is frozen, separate, and contains at least thirty unique cases", async () => {
  const manifest = JSON.parse(await readFile(new URL("../evals/held-out-manifest.json", import.meta.url), "utf8"));
  assert.equal(manifest.sha256, createHash("sha256").update(JSON.stringify(heldOutCases)).digest("hex"));
  assert.equal(heldOutCases.length, 32);
  assert.equal(new Set(heldOutCases.map((sample) => sample.id)).size, 32);
  const developmentText = new Set(extractionCases.map((sample) => sample.text));
  assert.ok(heldOutCases.every((sample) => sample.sources.every((source) => !developmentText.has(source.text))));
});

test("scores the entire output, rejecting extra otherwise-valid commitments", async () => {
  const results = await runEvaluation([example], async () => ({ commitments: [correct, referenceCommitments[1]], trace }));
  assert.equal(results[0].status, "failed");
  const metrics = summarizeEvaluation(results);
  assert.equal(metrics.exactMatchRate, 0);
  assert.equal(metrics.acceptedOutputMetrics.extraFeatures, 1);
});

test("correct extraction keeps actual latency, usage, and both provider identifiers", async () => {
  const results = await runEvaluation([example], async () => ({ commitments: [correct], trace }));
  assert.equal(results[0].status, "passed");
  assert.deepEqual(results[0].trace, trace);
  const metrics = summarizeEvaluation(results);
  assert.equal(metrics.latencyMs.p50, 12);
  assert.equal(metrics.recordedUsage.promptTokens, 100);
});

test("grounding failures are retained and do not erase later cases", async () => {
  let calls = 0;
  let saves = 0;
  const results = await runEvaluation([example, example], async () => {
    calls++;
    if (calls === 1) throw new InferenceError("Source validation failed.", 502, "grounding", trace);
    return { commitments: [correct], trace };
  }, async () => { saves++; });
  assert.equal(calls, 2);
  assert.equal(saves, 2);
  assert.equal(results[0].status, "error");
  assert.equal(results[0].trace?.runId, "test-run");
  assert.equal(results[1].status, "passed");
  assert.equal(summarizeEvaluation(results).exactMatchRate, 0.5);
});

test("authentication or transport failures stop spending without automatic retries", async () => {
  let calls = 0;
  const results = await runEvaluation([example, example], async () => { calls++; throw new InferenceError("Provider returned HTTP 401.", 502, "http", { ...trace, httpStatus: 401, runId: null, usage: null }); });
  assert.equal(calls, 1);
  assert.equal(results[1].status, "not_run");
  assert.equal(summarizeEvaluation(results).notRun, 1);
});

test("blocked runs never fabricate accuracy, latency, request IDs or tokens", () => {
  const results = unrunResults(heldOutCases, "No credential.");
  const metrics = summarizeEvaluation(results);
  assert.equal(metrics.executedCases, 0);
  assert.equal(metrics.exactMatchRate, null);
  assert.equal(metrics.latencyMs.p50, null);
  assert.equal(metrics.recordedUsage.callsWithUsage, 0);
  assert.ok(results.every((result) => result.trace === null));
});
