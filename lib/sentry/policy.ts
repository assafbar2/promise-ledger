import type { ProductFact, ProviderSignal, RuntimeFinding, Source } from "../schema";
import { RUNTIME_FRESH_MS } from "./runtime";

const CLOCK_SKEW_MS = 5 * 60 * 1000;

/**
 * "Enabled, but crashing for this customer." Only a built + enabled feature can be failing at
 * runtime, and only errors seen after the availability/acceptance snapshot and within 72 hours of
 * the cited source's fetch time (the real clock for live fetches, the capture time for
 * recordings) count. No matching signal returns null: the absence of errors never proves delivery.
 */
export function runtimeFailure(fact: ProductFact | null, signals: readonly ProviderSignal[], sources: readonly Source[]): RuntimeFinding | null {
  if (!fact || fact.built !== true || fact.enabled !== true) return null;
  const snapshot = Date.parse(fact.observedAt);
  if (!Number.isFinite(snapshot)) return null;
  const current = signals.flatMap((signal) => {
    if (signal.kind !== "runtimeErrors" || signal.featureId !== fact.featureId || signal.count <= 0) return [];
    const source = sources.find((candidate) => candidate.id === signal.evidence.sourceId);
    if (!source || source.kind !== "Runtime" || source.accountId !== fact.accountId || !source.text.includes(signal.evidence.quote)) return [];
    const clock = Date.parse(source.provenance?.fetchedAt ?? "");
    const lastSeen = Date.parse(signal.lastSeen);
    if (!Number.isFinite(clock) || !Number.isFinite(lastSeen) || lastSeen <= snapshot || lastSeen > clock + CLOCK_SKEW_MS || clock - lastSeen > RUNTIME_FRESH_MS) return [];
    return [signal];
  });
  if (current.length === 0) return null;
  return {
    count: current.reduce((sum, signal) => sum + signal.count, 0),
    // Users can overlap across issues, so only the largest single-issue count is a safe lower bound.
    users: Math.max(...current.map((signal) => signal.users)),
    issues: current.length,
    lastSeen: current.map((signal) => signal.lastSeen).sort().at(-1)!,
    evidence: current.map((signal) => signal.evidence),
  };
}

export function runtimeReason(finding: RuntimeFinding, accountName: string): string {
  const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  const users = finding.issues === 1 ? plural(finding.users, "user") : `at least ${plural(finding.users, "user")} across ${finding.issues} issues`;
  return `Enabled for ${accountName}, but failing at runtime (${plural(finding.count, "event")}, ${users}).`;
}
