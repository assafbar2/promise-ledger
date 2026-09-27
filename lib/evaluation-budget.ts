import type { ExtractionRunner } from "./evaluation";
import { InferenceError, NEBIUS_MAX_OUTPUT_TOKENS, type InferenceTrace } from "./nebius";
import { CHAT_TEMPLATE_OVERHEAD_TOKENS } from "./pipeline/models";

const MAX_VERIFICATION_AGE_MS = 15 * 60 * 1000;
const MICRODOLLARS_PER_DOLLAR = 1_000_000;

export type VerifiedPrice = { inputUsdPerMillion: number; outputUsdPerMillion: number; contextTokens: number };

/**
 * One unit of work (a case) that must be affordable before it starts. `inputTokens` defaults to the
 * model's full verified context.
 */
export type PlannedRequest = { model: string; inputTokens?: number; maxOutputTokens: number };

type BudgetConfiguration = {
  models: string[];
  prices: Map<string, VerifiedPrice>;
  plan: PlannedRequest[];
  budgetMicrodollars: number;
  freeCreditUsd: number;
  verifiedAt: number;
};

type Settlement = { requestedModel: string; reservation: number; inputTokens: number; outputTokens: number; trace: Pick<InferenceTrace, "model" | "usage"> | null };

function cost(price: VerifiedPrice, promptTokens: number, completionTokens: number) {
  return Math.ceil(promptTokens * price.inputUsdPerMillion + completionTokens * price.outputUsdPerMillion);
}

const sameModel = (left: string | null | undefined, right: string) => typeof left === "string" && left.toLowerCase() === right.toLowerCase();

class EvaluationBudget {
  private accountedMicrodollars = 0;
  private calls = 0;
  private uncertainCalls = 0;
  private readonly byModel = new Map<string, { calls: number; promptTokens: number; completionTokens: number; accountedMicrodollars: number }>();
  private stoppedReason: string | null = null;
  private inFlight = false;
  private readonly planMicrodollars: number;

  constructor(private readonly config: BudgetConfiguration, private readonly now: () => number) {
    this.planMicrodollars = config.plan.reduce((total, request) => total + this.planned(request), 0);
  }

  private price(model: string) {
    return this.config.prices.get(model) ?? null;
  }

  private planned(request: PlannedRequest) {
    const price = this.price(request.model)!;
    return cost(price, Math.min(price.contextTokens, request.inputTokens ?? price.contextTokens), request.maxOutputTokens);
  }

  /** `nextMicrodollars` defaults to the configured plan: one case's conservative maximum. */
  blockReason(nextMicrodollars = this.planMicrodollars): string | null {
    if (this.stoppedReason) return this.stoppedReason;
    if (this.inFlight) return "Another evaluation request is in flight; concurrent spending is blocked.";
    const age = this.now() - this.config.verifiedAt;
    if (age < 0 || age > MAX_VERIFICATION_AGE_MS) return "Credit, pricing and no-charge verification is stale. Reverify before further requests.";
    if (this.accountedMicrodollars + nextMicrodollars > this.config.budgetMicrodollars) return "The remaining evaluation budget cannot cover the next request's conservative maximum cost.";
    return null;
  }

  private begin(reservation: number) {
    this.inFlight = true;
    this.calls++;
    this.accountedMicrodollars += reservation;
  }

  private settle({ requestedModel, reservation, inputTokens, outputTokens, trace }: Settlement) {
    const usage = trace?.usage;
    const price = this.price(requestedModel)!;
    const entry = this.byModel.get(requestedModel) ?? { calls: 0, promptTokens: 0, completionTokens: 0, accountedMicrodollars: 0 };
    this.byModel.set(requestedModel, entry);
    entry.calls++;
    if (!trace || !sameModel(trace.model, requestedModel) || !usage || ![usage.promptTokens, usage.completionTokens].every((tokens) => Number.isSafeInteger(tokens) && tokens >= 0)) {
      this.uncertainCalls++;
      entry.accountedMicrodollars += reservation;
      this.stoppedReason = "Provider model or usage could not be reconciled. The full request reservation is retained; no further requests are allowed.";
      return;
    }
    const measuredCost = cost(price, usage.promptTokens, usage.completionTokens);
    if (!Number.isSafeInteger(measuredCost)) {
      this.uncertainCalls++;
      entry.accountedMicrodollars += reservation;
      this.stoppedReason = "Provider usage exceeded safe cost-accounting limits; no further requests are allowed.";
      return;
    }
    this.accountedMicrodollars += measuredCost - reservation;
    entry.promptTokens += usage.promptTokens;
    entry.completionTokens += usage.completionTokens;
    entry.accountedMicrodollars += measuredCost;
    if (usage.promptTokens > inputTokens || usage.completionTokens > outputTokens) this.stoppedReason = "Provider usage exceeded the verified token bounds. Stop and investigate before further requests.";
  }

  /** Extraction-only runner: reserves the model's full verified context plus the adapter's output cap. */
  wrap(runner: ExtractionRunner): ExtractionRunner {
    const requestedModel = this.config.models[0];
    const price = this.price(requestedModel)!;
    const reservation = cost(price, price.contextTokens, NEBIUS_MAX_OUTPUT_TOKENS);
    return async (sources) => {
      const reason = this.blockReason(reservation);
      if (reason) throw new InferenceError(reason, 503, "budget_preflight");
      this.begin(reservation);
      const settlement = { requestedModel, reservation, inputTokens: price.contextTokens, outputTokens: NEBIUS_MAX_OUTPUT_TOKENS };
      try {
        const result = await runner(sources);
        this.settle({ ...settlement, trace: result.trace });
        return result;
      } catch (error) {
        this.settle({ ...settlement, trace: error instanceof InferenceError ? error.trace : null });
        throw error;
      } finally {
        this.inFlight = false;
      }
    };
  }

  /**
   * Guards every chat completion that goes through this fetch, whichever code path makes it. Each
   * request reserves its UTF-8 input bound (capped at the verified context) plus its own
   * `max_tokens`, then settles from the reported model and usage: the JSON body, or for streams the
   * final usage chunk (read in full before the caller sees the response). Streams must request
   * `stream_options.include_usage`.
   */
  fetcher(base: typeof fetch = fetch): typeof fetch {
    return async (input, init) => {
      let body: { model?: unknown; max_tokens?: unknown; stream?: unknown; stream_options?: { include_usage?: unknown }; messages?: { content?: unknown }[] };
      try { body = JSON.parse(String(init?.body ?? "")); } catch { throw new InferenceError("The evaluation guard could not read the request.", 503, "budget_preflight"); }
      const requestedModel = typeof body.model === "string" ? body.model : "";
      const price = this.price(requestedModel);
      const outputTokens = Number(body.max_tokens);
      if (!price) throw new InferenceError("No verified price for the requested model.", 503, "budget_preflight");
      if (!Number.isSafeInteger(outputTokens) || outputTokens <= 0) throw new InferenceError("Every guarded request needs a positive max_tokens.", 503, "budget_preflight");
      const stream = body.stream === true;
      if (stream && body.stream_options?.include_usage !== true) throw new InferenceError("Streaming requests must include usage so the evaluation guard can reconcile them.", 503, "budget_preflight");
      const encoder = new TextEncoder();
      const inputBytes = (body.messages ?? []).reduce((total, message) => total + encoder.encode(String(message.content ?? "")).length, 0);
      const inputTokens = Math.min(price.contextTokens, inputBytes + CHAT_TEMPLATE_OVERHEAD_TOKENS);
      const reservation = cost(price, inputTokens, outputTokens);
      const reason = this.blockReason(reservation);
      if (reason) throw new InferenceError(reason, 503, "budget_preflight");
      this.begin(reservation);
      const settlement = { requestedModel, reservation, inputTokens, outputTokens };
      try {
        const response = await base(input, init);
        let trace: Settlement["trace"] = null;
        if (response.ok) {
          try { trace = stream ? streamedUsage(await response.clone().text()) : responseUsage(await response.clone().json()); } catch { trace = null; }
        }
        this.settle({ ...settlement, trace });
        return response;
      } catch (error) {
        this.settle({ ...settlement, trace: null });
        throw error;
      } finally {
        this.inFlight = false;
      }
    };
  }

  snapshot() {
    const single = this.config.models.length === 1 ? this.price(this.config.models[0])! : null;
    return {
      policy: "verified-free-credit-only",
      scope: "This invocation, shared across every suite it runs; not an account-wide spending limit.",
      verifiedAt: new Date(this.config.verifiedAt).toISOString(),
      verifiedFreeCreditUsd: this.config.freeCreditUsd,
      budgetUsd: this.config.budgetMicrodollars / MICRODOLLARS_PER_DOLLAR,
      accountedUsd: this.accountedMicrodollars / MICRODOLLARS_PER_DOLLAR,
      maximumNextRequestUsd: this.planMicrodollars / MICRODOLLARS_PER_DOLLAR,
      costBasis: "Provider token usage at verified rates, rounded up; retain the full reservation when usage is uncertain. Not a provider invoice.",
      ...(single ? { inputUsdPerMillion: single.inputUsdPerMillion, outputUsdPerMillion: single.outputUsdPerMillion, contextTokens: single.contextTokens, maxOutputTokens: NEBIUS_MAX_OUTPUT_TOKENS } : {}),
      prices: Object.fromEntries(this.config.models.map((model) => [model, this.price(model)])),
      reservationPlan: this.config.plan.map((request) => ({ ...request, maximumUsd: this.planned(request) / MICRODOLLARS_PER_DOLLAR })),
      byModel: Object.fromEntries([...this.byModel].map(([model, entry]) => [model, { calls: entry.calls, promptTokens: entry.promptTokens, completionTokens: entry.completionTokens, accountedUsd: entry.accountedMicrodollars / MICRODOLLARS_PER_DOLLAR }])),
      calls: this.calls,
      uncertainCalls: this.uncertainCalls,
      blockedReason: this.blockReason(),
    };
  }
}

export type { EvaluationBudget };

type ReportedChunk = { model?: unknown; usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } | null };

function responseUsage(parsed: ReportedChunk): Pick<InferenceTrace, "model" | "usage"> {
  return { model: typeof parsed.model === "string" ? parsed.model : null, usage: parsed.usage ? { promptTokens: Number(parsed.usage.prompt_tokens), completionTokens: Number(parsed.usage.completion_tokens) } : null };
}

/** The first reported model and the last usage object in a server-sent event stream. */
function streamedUsage(text: string): Pick<InferenceTrace, "model" | "usage"> {
  let model: string | null = null;
  let usage: InferenceTrace["usage"] = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") continue;
    const chunk = responseUsage(JSON.parse(data));
    model ??= chunk.model;
    if (chunk.usage) usage = chunk.usage;
  }
  return { model, usage };
}

function verifiedPrices(environment: Record<string, string | undefined>): Map<string, VerifiedPrice> | string {
  const raw = environment.NEBIUS_EVAL_PRICES?.trim();
  if (!raw) {
    const model = environment.NEBIUS_EVAL_PRICE_MODEL ?? "";
    return new Map([[model, { inputUsdPerMillion: Number(environment.NEBIUS_EVAL_INPUT_USD_PER_MILLION), outputUsdPerMillion: Number(environment.NEBIUS_EVAL_OUTPUT_USD_PER_MILLION), contextTokens: Number(environment.NEBIUS_EVAL_CONTEXT_TOKENS) }]]);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return "NEBIUS_EVAL_PRICES must be a JSON object of verified per-model prices."; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "NEBIUS_EVAL_PRICES must be a JSON object of verified per-model prices.";
  const prices = new Map<string, VerifiedPrice>();
  for (const [model, value] of Object.entries(parsed as Record<string, Partial<VerifiedPrice> | null>)) prices.set(model, { inputUsdPerMillion: Number(value?.inputUsdPerMillion), outputUsdPerMillion: Number(value?.outputUsdPerMillion), contextTokens: Number(value?.contextTokens) });
  return prices;
}

/**
 * `models` are the exact model IDs the invocation may call; each needs a verified price. `plan`
 * is the conservative maximum of one case, checked before every case; it defaults to one
 * extraction request reserving each model's full context.
 */
export function createEvaluationBudget(environment: Record<string, string | undefined>, models: string | readonly string[], now: () => number = Date.now, plan?: readonly PlannedRequest[]) {
  const blocked = (reason: string) => ({ budget: null, reason });
  const requested = typeof models === "string" ? [models] : [...models];
  if (environment.NEBIUS_EVAL_NO_PAID_ROLLOVER !== "true") return blocked("Verify the provider's saved stop-usage preference before enabling a credit-only evaluation.");
  const prices = verifiedPrices(environment);
  if (typeof prices === "string") return blocked(prices);
  if (requested.length === 0 || requested.some((model) => !model || !prices.has(model))) return blocked("Verified pricing must match the exact requested model.");
  const steps: PlannedRequest[] = [...(plan ?? requested.map((model) => ({ model, maxOutputTokens: NEBIUS_MAX_OUTPUT_TOKENS })))];
  if (steps.some((request) => !requested.includes(request.model))) return blocked("The reservation plan names a model without verified pricing.");
  const budgetUsd = Number(environment.NEBIUS_EVAL_BUDGET_USD);
  const freeCreditUsd = Number(environment.NEBIUS_EVAL_FREE_CREDIT_USD);
  const used = new Map(requested.map((model) => [model, prices.get(model)!]));
  const verifiedAt = Date.parse(environment.NEBIUS_EVAL_VERIFIED_AT ?? "");
  if (![budgetUsd, freeCreditUsd, ...[...used.values()].flatMap((price) => [price.inputUsdPerMillion, price.outputUsdPerMillion])].every((value) => Number.isFinite(value) && value > 0)) return blocked("A positive verified free-credit balance, evaluation budget and current token prices are required.");
  if (budgetUsd > 0.5 || budgetUsd > freeCreditUsd * 0.9) return blocked("Evaluation budget must be at most $0.50 and leave at least 10% of verified free credit unused.");
  for (const [model, price] of used) {
    const outputCap = Math.max(NEBIUS_MAX_OUTPUT_TOKENS, ...steps.filter((request) => request.model === model).map((request) => request.maxOutputTokens));
    if (!Number.isSafeInteger(price.contextTokens) || price.contextTokens < outputCap) return blocked("Verify the model's full context-token limit before calculating the request reservation.");
  }
  if (steps.some((request) => !Number.isSafeInteger(request.maxOutputTokens) || request.maxOutputTokens <= 0 || (request.inputTokens !== undefined && (!Number.isSafeInteger(request.inputTokens) || request.inputTokens <= 0)))) return blocked("The reservation plan needs positive integer token bounds.");
  if (!Number.isFinite(verifiedAt) || verifiedAt > now() || now() - verifiedAt > MAX_VERIFICATION_AGE_MS) return blocked("Verify credits, pricing and the saved no-charge preference within the last 15 minutes.");
  const budgetMicrodollars = Math.floor(budgetUsd * MICRODOLLARS_PER_DOLLAR);
  const worstCases = [...used.values()].map((price) => cost(price, price.contextTokens, NEBIUS_MAX_OUTPUT_TOKENS)).concat(steps.map((request) => { const price = used.get(request.model)!; return cost(price, Math.min(price.contextTokens, request.inputTokens ?? price.contextTokens), request.maxOutputTokens); }));
  if (budgetMicrodollars < 1 || !worstCases.every(Number.isSafeInteger)) return blocked("The cost configuration exceeds safe accounting limits.");
  const budget = new EvaluationBudget({ models: requested, prices: used, plan: steps, budgetMicrodollars, freeCreditUsd, verifiedAt }, now);
  return { budget, reason: budget.blockReason() };
}
