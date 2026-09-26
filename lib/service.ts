import { accountPack } from "./accounts";
import { continuationSecret, verifyContinuation, type ContinuationPayload } from "./byo/continuation";
import { byoExtractionMessages } from "./byo/extraction";
import { BYO_LIMITS } from "./byo/limits";
import { pipelineRequestSchema, type PipelineRequest } from "./byo/schema";
import { ByoInputError, checkByoSources, normalizeByoSource, sourcesDigest, toSource, workspaceName } from "./byo/sources";
import { claimOnce, liveLimitSettings, limitStoreConfig, ownerTokenMatches, reserveLiveRun, type LimitDecision, type LiveTier } from "./live-limits";
import { configuration } from "./nebius";
import { RunBudget, utf8Bytes } from "./pipeline/budget";
import type { PipelineEvent } from "./pipeline/events";
import { modelInfo, pipelineModels, runBudgetUsd, STEP_LIMITS } from "./pipeline/models";
import { executePipeline, liveRunLimitUsd, PipelineError } from "./pipeline/run";
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
const MAX_REQUEST_CHARS = 2048;
const MAX_BYO_REQUEST_CHARS = 96_000;

function fail(error: string, status: number, extra: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) {
  return Response.json({ error, ...extra }, { status, headers: { ...HEADERS, ...extraHeaders } });
}

type Admission = { ok: true; body: PipelineRequest; continuation: ContinuationPayload | null; spend?: SpendReservation } | { ok: false; response: Response };

/** Checks user-supplied evidence before any run is reserved, so an oversized paste never costs a live run. */
async function checkByo(body: PipelineRequest): Promise<Response | null> {
  if (!body.byo) return null;
  const inputs = body.byo.sources.map(normalizeByoSource);
  try { checkByoSources(inputs); } catch (error) {
    if (error instanceof ByoInputError) return fail(error.message, 413, { code: "byo_too_large" });
    throw error;
  }
  const sources = inputs.map((input) => toSource(input, new Date().toISOString()));
  const { system, user } = byoExtractionMessages(sources);
  if (utf8Bytes(system, user) > STEP_LIMITS.extraction.maxInputBytes) return fail("Your sources are too large for one extraction once encoded. Remove or shorten a source.", 413, { code: "byo_too_large" });
  return null;
}

async function checkContinuation(body: PipelineRequest): Promise<{ payload: ContinuationPayload } | { response: Response }> {
  const expired = (error: string, code: string) => ({ response: fail(error, 409, { code, fallback: "reference" }) });
  const secret = continuationSecret(process.env);
  const payload = secret && body.continuation ? await verifyContinuation(body.continuation, secret) : null;
  if (!payload) return expired("This confirmation has expired or is not valid. Re-run the rules without AI, or extract again.", "continuation_invalid");
  const inputs = body.byo!.sources.map(normalizeByoSource);
  if (await sourcesDigest(inputs, workspaceName(body.byo!.workspace)) !== payload.digest) return expired("Your sources changed after extraction, so the confirmation no longer applies. Extract again, or re-run the rules without AI.", "continuation_mismatch");
  const claim = await claimOnce({ id: `${payload.runId}:${payload.exp}`, ttlSeconds: BYO_LIMITS.continuationTtlSeconds + 120 });
  if (claim === "used") return expired("This extraction's live explain step was already used. Re-run the rules without AI, or extract again.", "continuation_used");
  if (claim === "unavailable") return { response: fail("Live mode is paused because its usage limits can't be verified right now. Reference mode is still available.", 503, { code: "live_limit_unavailable", fallback: "reference" }) };
  return { payload };
}

/**
 * Validates the request and, for live mode, applies the owner token and reserves exactly one
 * live run. A whole pipeline (triage, extraction, narrative) counts as that one run; for
 * bring-your-own evidence the decide step presents the extraction's signed continuation instead.
 * Every live request also reserves its worst case against the lifetime spend cap: a full run, or
 * for a decide step only the per-run budget its extraction left, so the two phases never exceed
 * one run's reservation together.
 */
async function admit(request: Request): Promise<Admission> {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return { ok: false, response: fail("Cross-origin requests are not allowed.", 403) };
  if (!request.headers.get("content-type")?.startsWith("application/json")) return { ok: false, response: fail("Send a JSON request.", 415) };
  const text = await request.text();
  if (text.length > MAX_BYO_REQUEST_CHARS) return { ok: false, response: fail("Request is too large.", 413) };
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return { ok: false, response: fail("Choose a valid mode and demo scenario.", 400) }; }
  const hasByo = typeof raw === "object" && raw !== null && !Array.isArray(raw) && "byo" in raw;
  if (!hasByo && text.length > MAX_REQUEST_CHARS) return { ok: false, response: fail("Request is too large.", 413) };
  const parsed = pipelineRequestSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, response: fail(hasByo ? "That evidence request is not valid. Check each source's type, title, date and text." : "Choose a valid mode and demo scenario.", 400) };
  const body = parsed.data;
  const pack = body.byo ? null : accountPack(body.account);
  if (!body.byo && !pack) return { ok: false, response: fail("Choose one of the sample accounts.", 400) };
  if (pack && !pack.scenarios.includes(body.scenario)) return { ok: false, response: fail(`${pack.name} does not have that demo scenario.`, 400) };
  const tooLarge = await checkByo(body);
  if (tooLarge) return { ok: false, response: tooLarge };
  let continuation: ContinuationPayload | null = null;
  if (body.mode === "live") {
    if (!capabilities().liveConfigured) return { ok: false, response: fail("Live inference is not configured. The reference demo remains available.", 503, { code: "live_not_configured", fallback: "reference" }) };
    if (body.byo?.phase === "decide") {
      const checked = await checkContinuation(body);
      if ("response" in checked) return { ok: false, response: checked.response };
      continuation = checked.payload;
      const spend = await reserveLiveSpend({ nebiusUsd: liveRunLimitUsd(process.env, continuation), providers: false });
      if (!spend.allowed) return { ok: false, response: spendFailure(spend.reason) };
      return { ok: true, body, continuation, spend: spend.reservation };
    }
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
    if (!spend.allowed) return { ok: false, response: spendFailure(spend.reason) };
    return { ok: true, body, continuation, spend: spend.reservation };
  }
  return { ok: true, body, continuation };
}

function spendFailure(reason: "cap" | "unavailable") {
  return fail(SPEND_MESSAGES[reason], 503, { code: `live_spend_${reason}`, fallback: "reference" });
}

function failure(error: unknown, mode: "reference" | "live") {
  const fallback = mode === "live" ? { fallback: "reference" as const } : {};
  if (error instanceof PipelineError) return { error: error.message, code: error.code, status: error.status, ...fallback };
  return { error: "Analysis could not be validated. No results were accepted.", code: "internal", status: 500, ...fallback };
}

/** Runs the pipeline, then settles any spend reservation to the request's estimated cost, even on failure. */
async function execute(admission: Extract<Admission, { ok: true }>, request: Request, emit?: (event: PipelineEvent) => void) {
  const { body, continuation, spend } = admission;
  const budget = spend ? new RunBudget(liveRunLimitUsd(process.env, continuation)) : undefined;
  try {
    return await executePipeline({ mode: body.mode, scenario: body.scenario, account: body.account, byo: body.byo, continuation, signal: request.signal, emit, budget });
  } finally {
    if (spend && budget) await settleLiveSpend(spend, budget.totals().costUsd);
  }
}

/** JSON endpoint: runs the full pipeline and returns the final analysis (or, for an extract step, the proposal). */
export async function analyzeRequest(request: Request): Promise<Response> {
  const admission = await admit(request);
  if (!admission.ok) return admission.response;
  try {
    const outcome = await execute(admission, request);
    return Response.json(outcome.kind === "analysis" ? outcome.analysis : outcome.proposal, { headers: HEADERS });
  } catch (error) {
    const { status, code, ...body } = failure(error, admission.body.mode);
    return fail(body.error, status, admission.body.mode === "live" ? { fallback: "reference", code } : { code });
  }
}

/** Streaming endpoint: newline-delimited PipelineEvents, ending with `result`, `proposal` or `error`. */
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
        send({ type: "error", ...failure(error, admission.body.mode) });
      } finally {
        open = false;
        try { controller.close(); } catch { /* client already gone */ }
      }
    },
  });
  return new Response(body, { headers: { ...HEADERS, "Content-Type": "application/x-ndjson; charset=utf-8", "X-Accel-Buffering": "no" } });
}
