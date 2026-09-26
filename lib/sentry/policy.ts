import type { ProductFact } from "../schema";
import { RUNTIME_FRESH_MS, type RuntimeSignal } from "./runtime";

const CLOCK_SKEW_MS = 5 * 60 * 1000;

export type RuntimeFailure = { featureId: string; count: number; users: number; issues: number; lastSeen: string; sourceIds: string[] };

/**
 * "Enabled, but crashing for this customer." Only a built + enabled feature can be failing at
 * runtime, and only errors seen after the availability/acceptance snapshot and within 72 hours of
 * `observedAt` (the real clock for live fetches, the capture time for recordings) count. No
 * matching signal returns null: the absence of errors is never evidence of delivery.
 */
export function runtimeFailure(fact: ProductFact | null, signals: readonly RuntimeSignal[], observedAt: string): RuntimeFailure | null {
  if (!fact || fact.built !== true || fact.enabled !== true) return null;
  const clock = Date.parse(observedAt);
  const snapshot = Date.parse(fact.observedAt);
  if (!Number.isFinite(clock) || !Number.isFinite(snapshot)) return null;
  const current = signals.filter((signal) => {
    const lastSeen = Date.parse(signal.lastSeen);
    return signal.kind === "runtimeErrors" && signal.featureId === fact.featureId && signal.count > 0 && Number.isFinite(lastSeen)
      && lastSeen > snapshot && lastSeen <= clock + CLOCK_SKEW_MS && clock - lastSeen <= RUNTIME_FRESH_MS;
  });
  if (current.length === 0) return null;
  return {
    featureId: fact.featureId,
    count: current.reduce((sum, signal) => sum + signal.count, 0),
    // Users can overlap across issues, so only the largest single-issue count is a safe lower bound.
    users: Math.max(...current.map((signal) => signal.users)),
    issues: current.length,
    lastSeen: current.map((signal) => signal.lastSeen).sort().at(-1)!,
    sourceIds: current.map((signal) => signal.evidence.sourceId),
  };
}

export function runtimeReason(failure: RuntimeFailure, accountName: string): string {
  const events = `${failure.count} ${failure.count === 1 ? "event" : "events"}`;
  const users = failure.issues === 1 ? `${failure.users} ${failure.users === 1 ? "user" : "users"}` : `at least ${failure.users} ${failure.users === 1 ? "user" : "users"} across ${failure.issues} issues`;
  return `Enabled for ${accountName}, but failing at runtime (${events}, ${users}).`;
}
