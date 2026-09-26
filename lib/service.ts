import { ACCOUNT, AS_OF, FEATURE_IDS, createScenario, referenceCommitments } from "./fixtures";
import { liveLimitSettings, limitStoreConfig, ownerTokenMatches, reserveLiveRun, type LimitDecision, type LiveTier } from "./live-limits";
import { configuration, extractWithNebius, InferenceError } from "./nebius";
import { reconcile, validateExtraction } from "./reconcile";
import { requestSchema, type Analysis } from "./schema";

export function capabilities() {
  const { apiKey, model, accessToken } = configuration();
  const liveConfigured = Boolean(apiKey && /^nvidia\/.*nemotron/i.test(model));
  const limits = liveLimitSettings();
  return {
    liveConfigured,
    model: model || null,
    syntheticOnly: true,
    liveAccess: liveConfigured ? { open: limits.perDay > 0 && limits.perIpPerHour > 0, perIpPerHour: limits.perIpPerHour, perDay: limits.perDay, durableLimits: limitStoreConfig() !== null, ownerToken: accessToken.length >= 24 } : null,
  };
}

function waitText(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `about ${Math.round(minutes / 60)} hours`;
}

function limitMessage(decision: Extract<LimitDecision, { allowed: false }>, tier: LiveTier) {
  const limits = liveLimitSettings();
  const wait = waitText(decision.retryAfterSeconds);
  if (decision.reason === "ip") return `You've used this hour's ${limits.perIpPerHour} live Nemotron runs from your connection. Try again in ${wait}, or run reference mode now: it applies the same evidence checks without an AI call.`;
  if (decision.reason === "daily" && tier === "token") return `The owner token's ${limits.tokenPerDay} live runs for today are used up. They reset at 00:00 UTC, in ${wait}.`;
  if (decision.reason === "daily") return `Today's ${limits.perDay} shared live Nemotron runs are used up, to protect the project's free credits. They reset at 00:00 UTC, in ${wait}. Reference mode is still available.`;
  if (decision.reason === "closed") return "Open live runs are paused by the project owner. Reference mode is still available.";
  return "Live mode is paused because its usage limits can't be verified right now. Reference mode is still available.";
}

export async function analyzeRequest(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
  const fail = (error: string, status: number, extra: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) => Response.json({ error, ...extra }, { status, headers: { ...headers, ...extraHeaders } });
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return fail("Cross-origin requests are not allowed.", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return fail("Send a JSON request.", 415);
  const text = await request.text();
  if (text.length > 2048) return fail("Request is too large.", 413);
  let body;
  try { body = requestSchema.parse(JSON.parse(text)); } catch { return fail("Choose a valid mode and demo scenario.", 400); }
  if (body.mode === "live") {
    if (!capabilities().liveConfigured) return fail("Live inference is not configured. The reference demo remains available.", 503, { code: "live_not_configured", fallback: "reference" });
    const authorization = request.headers.get("authorization");
    let tier: LiveTier = "public";
    if (authorization) {
      if (!(await ownerTokenMatches(authorization, configuration().accessToken))) return fail("That owner access token isn't valid. Clear the token field to use open live mode.", 401, { code: "invalid_owner_token" });
      tier = "token";
    }
    const decision = await reserveLiveRun({ request, tier });
    if (!decision.allowed) {
      const status = decision.reason === "ip" || decision.reason === "daily" ? 429 : 503;
      return fail(limitMessage(decision, tier), status, { code: `live_limit_${decision.reason}`, retryAfterSeconds: decision.retryAfterSeconds, fallback: "reference" }, { "Retry-After": String(decision.retryAfterSeconds) });
    }
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
    const extra = body.mode === "live" ? { fallback: "reference" } : {};
    return fail(error instanceof InferenceError ? error.message : "Analysis could not be validated. No results were accepted.", error instanceof InferenceError ? error.status : 500, extra);
  }
}
