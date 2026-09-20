import assert from "node:assert/strict";
import test from "node:test";
import { createScenario, referenceCommitments } from "../lib/fixtures.ts";
import { extractWithNebius, InferenceError } from "../lib/nebius.ts";

const sources = createScenario("blocked").sources;
const validResponse = { id: "stub-run-1", model: "nvidia/test-Nemotron", choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ commitments: referenceCommitments }) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } };

test("Nebius adapter contracts are tested with mocked HTTP, not a real model run", async (context) => {
  const previousKey = process.env.NEBIUS_API_KEY;
  const previousModel = process.env.NEBIUS_MODEL;
  process.env.NEBIUS_API_KEY = "unit-test-key";
  process.env.NEBIUS_MODEL = "nvidia/test-Nemotron";
  context.after(() => {
    if (previousKey === undefined) delete process.env.NEBIUS_API_KEY; else process.env.NEBIUS_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.NEBIUS_MODEL; else process.env.NEBIUS_MODEL = previousModel;
  });

  await context.test("uses only Nebius, keeps secrets out of prompts, and validates citations", async () => {
    const fetcher: typeof fetch = async (url, options) => {
      assert.equal(url, "https://api.tokenfactory.nebius.com/v1/chat/completions");
      assert.equal(new Headers(options?.headers).get("Authorization"), "Bearer unit-test-key");
      const body = JSON.parse(String(options?.body));
      assert.equal(body.model, "nvidia/test-Nemotron");
      assert.match(body.messages[0].content, /untrusted data/);
      assert.doesNotMatch(body.messages[0].content, /unit-test-key/);
      assert.equal(body.stream, false);
      assert.deepEqual(body.response_format, { type: "json_object" });
      assert.ok(options?.signal);
      return Response.json(validResponse);
    };
    const result = await extractWithNebius(sources, fetcher);
    assert.equal(result.commitments.length, 6);
    assert.deepEqual(result.usage, { promptTokens: 100, completionTokens: 50 });
    assert.equal(result.trace.httpStatus, 200);
    assert.equal(result.trace.runId, "stub-run-1");
    assert.ok(result.trace.elapsedMs >= 0);
  });

  await context.test("retains provider trace and usage when a response fails grounding", async () => {
    const invalid = { ...validResponse, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ commitments: [{ ...referenceCommitments[0], owner: "Invented Person" }] }) } }] };
    await assert.rejects(() => extractWithNebius(sources, async () => Response.json(invalid, { headers: { "x-request-id": "provider-request-123" } })), (error: unknown) => {
      assert.ok(error instanceof InferenceError);
      assert.equal(error.code, "grounding");
      assert.equal(error.trace?.requestId, "provider-request-123");
      assert.equal(error.trace?.runId, "stub-run-1");
      assert.deepEqual(error.trace?.usage, { promptTokens: 100, completionTokens: 50 });
      return true;
    });
  });

  await context.test("provider error body and secrets are never surfaced", async () => {
    await assert.rejects(() => extractWithNebius(sources, async () => new Response("secret-provider-body", { status: 500 })), (error: Error) => { assert.match(error.message, /HTTP 500/); assert.doesNotMatch(error.message, /secret-provider-body/); return true; });
  });

  await context.test("handles provider throttling without retrying paid inference", async () => {
    let calls = 0;
    await assert.rejects(() => extractWithNebius(sources, async () => { calls++; return new Response("", { status: 429 }); }), /rate limit/);
    assert.equal(calls, 1);
  });

  await context.test("handles transport failures without substituting fixtures", async () => {
    await assert.rejects(() => extractWithNebius(sources, async () => { throw new Error("network-details"); }), /No results were substituted/);
  });

  await context.test("rejects incomplete, refused, invalid JSON and ungrounded responses", async () => {
    const variants = [
      { ...validResponse, choices: [{ finish_reason: "length", message: { content: "{}" } }] },
      { ...validResponse, choices: [{ finish_reason: "stop", message: { content: null, refusal: "No" } }] },
      { ...validResponse, choices: [{ finish_reason: "stop", message: { content: "not json" } }] },
      { ...validResponse, choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ commitments: [{ ...referenceCommitments[0], owner: "Invented" }] }) } }] },
      { ...validResponse, model: "unapproved-provider/model" },
      { message: "Wrong response structure" },
    ];
    for (const variant of variants) await assert.rejects(() => extractWithNebius(sources, async () => Response.json(variant)));
  });
});
