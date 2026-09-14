import { ACCOUNT, AS_OF, FEATURE_IDS, createScenario, referenceCommitments } from "./fixtures";
import { configuration, extractWithNebius, InferenceError } from "./nebius";
import { reconcile, validateExtraction } from "./reconcile";
import { requestSchema, type Analysis } from "./schema";

export function capabilities() {
  const { apiKey, model, accessToken } = configuration();
  return { liveConfigured: Boolean(apiKey && /^nvidia\/.*nemotron/i.test(model) && accessToken.length >= 24), model: model || null, syntheticOnly: true };
}

export async function analyzeRequest(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const fail = (error: string, status: number) => Response.json({ error }, { status, headers });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Cross-origin requests are not allowed.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return fail("Send a JSON request.", 415);
  const text = await request.text();
  if (text.length > 2048) return fail("Request is too large.", 413);
  let body;
  try { body = requestSchema.parse(JSON.parse(text)); } catch { return fail("Choose a valid mode and demo scenario.", 400); }
  if (body.mode === "live") {
    if (!capabilities().liveConfigured) return fail("Live inference is not configured. The reference demo remains available.", 503);
    if (request.headers.get("authorization") !== `Bearer ${configuration().accessToken}`) return fail("A valid private-demo access token is required for live inference.", 401);
  }
  const started = performance.now();
  const { sources, facts } = createScenario(body.scenario);
  try {
    const result = body.mode === "live"
      ? await extractWithNebius(sources)
      : { commitments: validateExtraction({ commitments: referenceCommitments }, sources, ACCOUNT.id, FEATURE_IDS), model: null, runId: crypto.randomUUID(), usage: null };
    const analysis: Analysis = { ...result, commitments: result.commitments.map((commitment) => reconcile(commitment, facts, ACCOUNT.id, AS_OF)), mode: body.mode, scenario: body.scenario, asOf: AS_OF, sources, elapsedMs: Math.round(performance.now() - started) };
    return Response.json(analysis, { headers });
  } catch (error) {
    return fail(error instanceof InferenceError ? error.message : "Analysis could not be validated. No results were accepted.", error instanceof InferenceError ? error.status : 500);
  }
}
