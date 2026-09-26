import type { StepId, Usage } from "../schema";
import { CHAT_TEMPLATE_OVERHEAD_TOKENS, modelInfo } from "./models";

const MICRO = 1_000_000;

export function utf8Bytes(...parts: string[]) {
  const encoder = new TextEncoder();
  return parts.reduce((total, part) => total + encoder.encode(part).length, 0);
}

export function inputTokenBound(inputBytes: number) {
  return inputBytes + CHAT_TEMPLATE_OVERHEAD_TOKENS;
}

function microdollars(model: string, promptTokens: number, completionTokens: number) {
  const price = modelInfo(model);
  return Math.ceil(promptTokens * price.inputUsdPerMillion + completionTokens * price.outputUsdPerMillion);
}

export function worstCaseUsd(model: string, inputBytes: number, maxOutputTokens: number) {
  return microdollars(model, inputTokenBound(inputBytes), maxOutputTokens) / MICRO;
}

type Reservation = { model: string; inputTokens: number; outputTokens: number; micro: number; settledMicro: number | null };

/**
 * Per-run spending guard. Each call reserves its worst case (input bound at the input rate plus
 * the output cap at the output rate) before dispatch, then settles to reported usage. Missing usage
 * keeps the full reservation; usage beyond the bound also stops further paid steps.
 */
export class RunBudget {
  private reservations = new Map<StepId, Reservation>();
  private pending = new Map<StepId, number>();
  violation: string | null = null;

  constructor(readonly limitUsd: number) {}

  private committedMicro() {
    let total = 0;
    for (const reservation of this.reservations.values()) total += reservation.settledMicro ?? reservation.micro;
    for (const micro of this.pending.values()) total += micro;
    return total;
  }

  /** Hold room for a later required step so optional steps cannot starve it. */
  hold(stepId: StepId, model: string, inputBytes: number, maxOutputTokens: number) {
    this.pending.set(stepId, microdollars(model, inputTokenBound(inputBytes), maxOutputTokens));
  }

  reserve(stepId: StepId, model: string, inputBytes: number, maxOutputTokens: number): { ok: true; reservedUsd: number } | { ok: false; reservedUsd: number; reason: string } {
    const inputTokens = inputTokenBound(inputBytes);
    const micro = microdollars(model, inputTokens, maxOutputTokens);
    const held = this.pending.get(stepId) ?? 0;
    if (this.violation) return { ok: false, reservedUsd: micro / MICRO, reason: this.violation };
    if (this.committedMicro() - held + micro > Math.round(this.limitUsd * MICRO)) return { ok: false, reservedUsd: micro / MICRO, reason: `its worst case would exceed this run's $${this.limitUsd.toFixed(2)} budget` };
    this.pending.delete(stepId);
    this.reservations.set(stepId, { model, inputTokens, outputTokens: maxOutputTokens, micro, settledMicro: null });
    return { ok: true, reservedUsd: micro / MICRO };
  }

  settle(stepId: StepId, usage: Usage | null): number | null {
    const reservation = this.reservations.get(stepId);
    if (!reservation) return null;
    if (!usage) {
      reservation.settledMicro = reservation.micro;
      return reservation.micro / MICRO;
    }
    if (usage.promptTokens > reservation.inputTokens || usage.completionTokens > reservation.outputTokens) {
      this.violation = "an earlier step used more tokens than its budgeted bound";
      reservation.settledMicro = Math.max(reservation.micro, microdollars(reservation.model, usage.promptTokens, usage.completionTokens));
      return reservation.settledMicro / MICRO;
    }
    reservation.settledMicro = microdollars(reservation.model, usage.promptTokens, usage.completionTokens);
    return reservation.settledMicro / MICRO;
  }

  /** For requests the provider rejected with an HTTP error before generating anything. */
  release(stepId: StepId) {
    this.reservations.delete(stepId);
  }

  totals() {
    let reserved = 0;
    let cost = 0;
    for (const reservation of this.reservations.values()) {
      reserved += reservation.micro;
      cost += reservation.settledMicro ?? reservation.micro;
    }
    return { reservedUsd: reserved / MICRO, costUsd: cost / MICRO };
  }
}
