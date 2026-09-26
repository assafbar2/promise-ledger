import { liveLimitSettings, limitStoreConfig, ownerTokenMatches, reserveLiveRun, type LimitDecision, type LiveTier } from "./live-limits";
import { configuration } from "./nebius";
import type { PipelineEvent } from "./pipeline/events";
import { modelInfo, pipelineModels, runBudgetUsd } from "./pipeline/models";
import { RunBudget } from "./pipeline/budget";
import { PipelineError, runPipeline } from "./pipeline/run";
import { requestSchema, type Scenario } from "./schema";
import { liveSpendStatus, reserveLiveSpend, settleLiveSpend, type SpendReservation } from "./spend-cap";

export function capabilities() {
  const { apiKey, model, accessToken } = configuration();
  const liveConfigured = Boolean(apiKey && /^nvidia\/.*nemotron/i.test(model));
  const limits = liveLimitSettings();
  const models = pipelineModels();
  const describe = (id: string | null) => id ? { id, name: modelInfo(id).name } : null;
  return {
    liveConfigured,
    model: model || null,
    syntheticOnly: true,
    liveAccess: liveConfigured ? { open: limits.perDay > 0 && limits.perIpPerHour > 0, perIpPerHour: limits.perIpPerHour, perDay: limits.perDay, durableLimits: limitStoreConfig() !== null, ownerToken: accessToken.length >= 24 } : null,
    pipeline: liveConfigured ? { triage: describe(models.triage.model), extraction: describe(model), narrative: describe(models.narrative.model), runBudgetUsd: runBudgetUsd() } : null,
  };
}

/** `/api/status`: capabilities plus the non-secret lifetime spend ledger. */
export async function status() {
  const base = capabilities();
  return { ...base, spend: base.liveConfigured ? await liveSpendStatus() : null };
}

const SPEND_MESSAGES = {
  cap: "Live runs have used this demo's free-credit allowance, so live mode is now off for good. The reference replay runs the same evidence checks and rules with no AI call.",
  unavailable: "Live mode is off because this server can't verify its total AI spend right now. The reference replay runs the same evidence checks and rules with no AI call.",
};

function waitText(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `about ${Math.round(minutes / 60)} hours`;
}

function runs(count: number) {
  return `${count} live Nemotron run${count === 1 ? "" : "s"}`;
}

function limitMessage(decision: Extract<LimitDecision, { allowed: false }>, tier: LiveTier) {
  const limits = liveLimitSettings();
  const wait = waitText(decision.retryAfterSeconds);
  if (decision.reason === "ip") return `You've reached this hour's limit of ${runs(limits.perIpPerHour)} for your connection. Try again in ${wait}, or run reference mode now: it applies the same evidence checks without an AI call.`;
  if (decision.reason === "daily" && tier === "token") return `The owner token's daily limit of ${runs(limits.tokenPerDay)} is used up. It resets at 00:00 UTC, in ${wait}.`;
  if (decision.reason === "daily") return `Today's shared limit of ${runs(limits.perDay)} is used up, to protect the project's free credits. It resets at 00:00 UTC, in ${wait}. Reference mode is still available.`;
  if (decision.reason === "closed") return "Open live runs are paused by the project owner. Reference mode is still available.";
  return "Live mode is paused because its usage limits can't be verified right now. Reference mode is still available.";
}

const HEADERS = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

function fail(error: string, status: number, extra: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) {
  return Response.json({ error, ...extra }, { status, headers: { ...HEADERS, ...extraHeaders } });
}

/**
 * Validates the request and, for live mode, applies the owner token and reserves exactly one
 * live run. A whole pipeline (triage, extraction, narrative) counts as that one run, and reserves
 * its worst-case cost against the lifetime spend cap.
 */
async function admit(request: Request): Promise<{ ok: true; mode: "reference" | "live"; scenario: Scenario; spend?: SpendReservation } | { ok: false; response: Response }> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return { ok: false, response: fail("Cross-origin requests are not allowed.", 403) };
  if (!request.headers.get("content-type")?.startsWith("application/json")) return { ok: false, response: fail("Send a JSON request.", 415) };
  const text = await request.text();
  if (text.length > 2048) return { ok: false, response: fail("Request is too large.", 413) };
  let body;
  try { body = requestSchema.parse(JSON.parse(text)); } catch { return { ok: false, response: fail("Choose a valid mode and demo scenario.", 400) }; }
  if (body.mode === "live") {
    if (!capabilities().liveConfigured) return { ok: false, response: fail("Live inference is not configured. The reference demo remains available.", 503, { code: "live_not_configured", fallback: "reference" }) };
    const authorization = request.headers.get("authorization");
    let tier: LiveTier = "public";
    if (authorization) {
      if (!(await ownerTokenMatches(authorization, configuration().accessToken))) return { ok: false, response: fail("That owner access token isn't valid. Clear the token field to use open live mode.", 401, { code: "invalid_owner_token" }) };
      tier = "token";
    }
    const decision = await reserveLiveRun({ request, tier });
    if (!decision.allowed) {
      const status = decision.reason === "ip" || decision.reason === "daily" ? 429 : 503;
      return { ok: false, response: fail(limitMessage(decision, tier), status, { code: `live_limit_${decision.reason}`, retryAfterSeconds: decision.retryAfterSeconds, fallback: "reference" }, { "Retry-After": String(decision.retryAfterSeconds) }) };
    }
    const spend = await reserveLiveSpend();
    if (!spend.allowed) return { ok: false, response: fail(SPEND_MESSAGES[spend.reason], 503, { code: `live_spend_${spend.reason}`, fallback: "reference" }) };
    return { ok: true, mode: body.mode, scenario: body.scenario, spend: spend.reservation };
  }
  return { ok: true, mode: body.mode, scenario: body.scenario };
}

type Admitted = Extract<Awaited<ReturnType<typeof admit>>, { ok: true }>;

/** Runs the pipeline, then settles any spend reservation to the run's estimated cost, even on failure. */
async function execute(admission: Admitted, request: Request, emit?: (event: PipelineEvent) => void) {
  const budget = admission.spend ? new RunBudget(runBudgetUsd()) : undefined;
  try {
    return await runPipeline({ mode: admission.mode, scenario: admission.scenario, signal: request.signal, emit, budget });
  } finally {
    if (admission.spend && budget) await settleLiveSpend(admission.spend, budget.totals().costUsd);
  }
}

function failure(error: unknown, mode: "reference" | "live") {
  const fallback = mode === "live" ? { fallback: "reference" as const } : {};
  if (error instanceof PipelineError) return { error: error.message, code: error.code, status: error.status, ...fallback };
  return { error: "Analysis could not be validated. No results were accepted.", code: "internal", status: 500, ...fallback };
}

/** JSON endpoint: runs the full pipeline and returns the final analysis, including its trace. */
export async function analyzeRequest(request: Request): Promise<Response> {
  const admission = await admit(request);
  if (!admission.ok) return admission.response;
  try {
    const analysis = await execute(admission, request);
    return Response.json(analysis, { headers: HEADERS });
  } catch (error) {
    const { status, code, ...body } = failure(error, admission.mode);
    return fail(body.error, status, admission.mode === "live" ? { fallback: "reference", code } : { code });
  }
}

/** Streaming endpoint: newline-delimited PipelineEvents, ending with `result` or `error`. */
export async function pipelineRequest(request: Request): Promise<Response> {
  const admission = await admit(request);
  if (!admission.ok) return admission.response;
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: PipelineEvent) => {
        if (!open) return;
        try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { open = false; }
      };
      try {
        await execute(admission, request, send);
      } catch (error) {
        send({ type: "error", ...failure(error, admission.mode) });
      } finally {
        open = false;
        try { controller.close(); } catch { /* client already gone */ }
      }
    },
  });
  return new Response(body, { headers: { ...HEADERS, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" } });
}
