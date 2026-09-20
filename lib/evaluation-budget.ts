import type { ExtractionRunner } from "./evaluation";
import { InferenceError, NEBIUS_MAX_OUTPUT_TOKENS, type InferenceTrace } from "./nebius";

const MAX_VERIFICATION_AGE_MS = 15 * 60 * 1000;
const MICRODOLLARS_PER_DOLLAR = 1_000_000;

type BudgetConfiguration = {
  model: string;
  budgetMicrodollars: number;
  freeCreditUsd: number;
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
  contextTokens: number;
  verifiedAt: number;
};

class EvaluationBudget {
  private accountedMicrodollars = 0;
  private calls = 0;
  private uncertainCalls = 0;
  private stoppedReason: string | null = null;
  private inFlight = false;
  private readonly maximumRequestMicrodollars: number;

  constructor(private readonly config: BudgetConfiguration, private readonly now: () => number) {
    this.maximumRequestMicrodollars = this.cost(config.contextTokens, NEBIUS_MAX_OUTPUT_TOKENS);
  }

  private cost(promptTokens: number, completionTokens: number) {
    return Math.ceil(promptTokens * this.config.inputUsdPerMillion + completionTokens * this.config.outputUsdPerMillion);
  }

  blockReason(): string | null {
    if (this.stoppedReason) return this.stoppedReason;
    if (this.inFlight) return "Another evaluation request is in flight; concurrent spending is blocked.";
    const age = this.now() - this.config.verifiedAt;
    if (age < 0 || age > MAX_VERIFICATION_AGE_MS) return "Credit, pricing and no-charge verification is stale. Reverify before further requests.";
    if (this.accountedMicrodollars + this.maximumRequestMicrodollars > this.config.budgetMicrodollars) return "The remaining evaluation budget cannot cover the next request's conservative maximum cost.";
    return null;
  }

  private settle(trace: InferenceTrace | null) {
    const usage = trace?.usage;
    if (!trace || trace.requestedModel !== this.config.model || trace.model !== this.config.model || !usage || ![usage.promptTokens, usage.completionTokens].every((tokens) => Number.isSafeInteger(tokens) && tokens >= 0)) {
      this.uncertainCalls++;
      this.stoppedReason = "Provider model or usage could not be reconciled. The full request reservation is retained; no further requests are allowed.";
      return;
    }
    const measuredCost = this.cost(usage.promptTokens, usage.completionTokens);
    if (!Number.isSafeInteger(measuredCost)) {
      this.uncertainCalls++;
      this.stoppedReason = "Provider usage exceeded safe cost-accounting limits; no further requests are allowed.";
      return;
    }
    this.accountedMicrodollars += measuredCost - this.maximumRequestMicrodollars;
    if (usage.promptTokens > this.config.contextTokens || usage.completionTokens > NEBIUS_MAX_OUTPUT_TOKENS) this.stoppedReason = "Provider usage exceeded the verified token bounds. Stop and investigate before further requests.";
  }

  wrap(runner: ExtractionRunner): ExtractionRunner {
    return async (sources) => {
      const reason = this.blockReason();
      if (reason) throw new InferenceError(reason, 503, "budget_preflight");
      this.inFlight = true;
      this.calls++;
      this.accountedMicrodollars += this.maximumRequestMicrodollars;
      try {
        const result = await runner(sources);
        this.settle(result.trace);
        return result;
      } catch (error) {
        this.settle(error instanceof InferenceError ? error.trace : null);
        throw error;
      } finally {
        this.inFlight = false;
      }
    };
  }

  snapshot() {
    return {
      policy: "verified-free-credit-only",
      scope: "This invocation, shared across development and held-out suites; not an account-wide spending limit.",
      verifiedAt: new Date(this.config.verifiedAt).toISOString(),
      verifiedFreeCreditUsd: this.config.freeCreditUsd,
      budgetUsd: this.config.budgetMicrodollars / MICRODOLLARS_PER_DOLLAR,
      accountedUsd: this.accountedMicrodollars / MICRODOLLARS_PER_DOLLAR,
      maximumNextRequestUsd: this.maximumRequestMicrodollars / MICRODOLLARS_PER_DOLLAR,
      costBasis: "Provider token usage at verified rates, rounded up; retain the full reservation when usage is uncertain. Not a provider invoice.",
      inputUsdPerMillion: this.config.inputUsdPerMillion,
      outputUsdPerMillion: this.config.outputUsdPerMillion,
      contextTokens: this.config.contextTokens,
      maxOutputTokens: NEBIUS_MAX_OUTPUT_TOKENS,
      calls: this.calls,
      uncertainCalls: this.uncertainCalls,
      blockedReason: this.blockReason(),
    };
  }
}

export function createEvaluationBudget(environment: Record<string, string | undefined>, model: string, now: () => number = Date.now) {
  const blocked = (reason: string) => ({ budget: null, reason });
  if (environment.NEBIUS_EVAL_NO_PAID_ROLLOVER !== "true") return blocked("Verify the provider's saved stop-usage preference before enabling a credit-only evaluation.");
  if (!model || environment.NEBIUS_EVAL_PRICE_MODEL !== model) return blocked("Verified pricing must match the exact requested model.");
  const budgetUsd = Number(environment.NEBIUS_EVAL_BUDGET_USD);
  const freeCreditUsd = Number(environment.NEBIUS_EVAL_FREE_CREDIT_USD);
  const inputUsdPerMillion = Number(environment.NEBIUS_EVAL_INPUT_USD_PER_MILLION);
  const outputUsdPerMillion = Number(environment.NEBIUS_EVAL_OUTPUT_USD_PER_MILLION);
  const contextTokens = Number(environment.NEBIUS_EVAL_CONTEXT_TOKENS);
  const verifiedAt = Date.parse(environment.NEBIUS_EVAL_VERIFIED_AT ?? "");
  if (![budgetUsd, freeCreditUsd, inputUsdPerMillion, outputUsdPerMillion].every((value) => Number.isFinite(value) && value > 0)) return blocked("A positive verified free-credit balance, evaluation budget and current token prices are required.");
  if (budgetUsd > 0.5 || budgetUsd > freeCreditUsd * 0.9) return blocked("Evaluation budget must be at most $0.50 and leave at least 10% of verified free credit unused.");
  if (!Number.isSafeInteger(contextTokens) || contextTokens < NEBIUS_MAX_OUTPUT_TOKENS) return blocked("Verify the model's full context-token limit before calculating the request reservation.");
  if (!Number.isFinite(verifiedAt) || verifiedAt > now() || now() - verifiedAt > MAX_VERIFICATION_AGE_MS) return blocked("Verify credits, pricing and the saved no-charge preference within the last 15 minutes.");
  const budgetMicrodollars = Math.floor(budgetUsd * MICRODOLLARS_PER_DOLLAR);
  const maximumRequestMicrodollars = Math.ceil(contextTokens * inputUsdPerMillion + NEBIUS_MAX_OUTPUT_TOKENS * outputUsdPerMillion);
  if (budgetMicrodollars < 1 || !Number.isSafeInteger(maximumRequestMicrodollars)) return blocked("The cost configuration exceeds safe accounting limits.");
  const budget = new EvaluationBudget({ model, budgetMicrodollars, freeCreditUsd, inputUsdPerMillion, outputUsdPerMillion, contextTokens, verifiedAt }, now);
  return { budget, reason: budget.blockReason() };
}
