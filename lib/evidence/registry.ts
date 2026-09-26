import type { Evidence, EvidenceProviderReport, ProductFact, ProviderSignal, Source } from "../schema";
import { EVIDENCE_PROVIDERS } from "./providers";
import type { EvidenceContext, EvidenceProvider } from "./types";

export const EVIDENCE_LIMITS = { maxSources: 40, maxSourceChars: 8000, maxTitleChars: 140, maxSignals: 40 } as const;
const SOURCE_ID = /^[A-Za-z0-9_-]{1,40}$/;

export class EvidenceError extends Error {
  constructor(message: string, public providerId: string) { super(message); }
}

export type CollectedEvidence = { sources: Source[]; facts: ProductFact[]; signals: ProviderSignal[]; providers: EvidenceProviderReport[] };

function checkSource(source: Source, provider: EvidenceProvider, accountId: string, taken: Set<string>) {
  if (!SOURCE_ID.test(source.id)) throw new EvidenceError(`Source ID "${source.id.slice(0, 40)}" is not allowed.`, provider.id);
  if (taken.has(source.id)) throw new EvidenceError(`Source ID ${source.id} is not unique across providers.`, provider.id);
  if (source.accountId !== accountId) throw new EvidenceError(`Source ${source.id} belongs to another account.`, provider.id);
  if (!provider.kinds.includes(source.kind)) throw new EvidenceError(`Source ${source.id} has a kind this provider does not declare.`, provider.id);
  if (!source.text || source.text.length > EVIDENCE_LIMITS.maxSourceChars) throw new EvidenceError(`Source ${source.id} is empty or too long.`, provider.id);
  if (!source.title || source.title.length > EVIDENCE_LIMITS.maxTitleChars) throw new EvidenceError(`Source ${source.id} needs a short title.`, provider.id);
  if (!Number.isFinite(Date.parse(source.observedAt))) throw new EvidenceError(`Source ${source.id} has an invalid timestamp.`, provider.id);
  if (source.url !== undefined && !/^https:\/\//.test(source.url)) throw new EvidenceError(`Source ${source.id} has a non-HTTPS URL.`, provider.id);
}

function cites(evidence: Evidence, sources: Source[]) {
  const source = sources.find((candidate) => candidate.id === evidence.sourceId);
  return Boolean(source && evidence.quote.length >= 12 && source.text.includes(evidence.quote));
}

function withTimeout<T>(work: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  parent.addEventListener("abort", abort, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("timeout")); }, timeoutMs); });
  return Promise.race([work(controller.signal), deadline]).finally(() => { clearTimeout(timer); parent.removeEventListener("abort", abort); });
}

/**
 * Runs enabled providers in registration order and validates everything they return before any
 * model or rule sees it: unique, account-scoped, bounded sources; facts only from curated
 * providers; every fact and signal citing an exact quote from that provider's own sources.
 */
export async function collectEvidence(context: Omit<EvidenceContext, "signal"> & { signal?: AbortSignal }, providers: readonly EvidenceProvider[] = EVIDENCE_PROVIDERS): Promise<CollectedEvidence> {
  const sources: Source[] = [];
  const facts: ProductFact[] = [];
  const signals: ProviderSignal[] = [];
  const reports: EvidenceProviderReport[] = [];
  const parent = context.signal ?? new AbortController().signal;
  for (const provider of providers) {
    if (!provider.enabled(context.env, context)) continue;
    const started = performance.now();
    const elapsed = () => Math.round(performance.now() - started);
    try {
      const bundle = await withTimeout((signal) => provider.fetch({ ...context, signal }), provider.timeoutMs, parent);
      const own = bundle.sources.map((source) => ({ ...source, providerId: provider.id }));
      const taken = new Set(sources.map((source) => source.id));
      for (const source of own) { checkSource(source, provider, context.accountId, taken); taken.add(source.id); }
      const ownFacts = bundle.facts ?? [];
      const ownSignals = bundle.signals ?? [];
      if (ownFacts.length > 0 && provider.trust !== "curated") throw new EvidenceError("Only curated providers may contribute product facts.", provider.id);
      for (const fact of ownFacts) {
        if (fact.accountId !== context.accountId) throw new EvidenceError(`Fact for ${fact.featureId} belongs to another account.`, provider.id);
        if (!fact.evidence.every((evidence) => cites(evidence, own))) throw new EvidenceError(`Fact for ${fact.featureId} cites evidence its provider did not supply.`, provider.id);
      }
      for (const signal of ownSignals) {
        if (!context.featureIds.includes(signal.featureId)) throw new EvidenceError(`Signal names unknown feature ${signal.featureId.slice(0, 40)}.`, provider.id);
        if (!cites(signal.evidence, own)) throw new EvidenceError("Signal cites evidence its provider did not supply.", provider.id);
      }
      if (sources.length + own.length > EVIDENCE_LIMITS.maxSources) throw new EvidenceError("Too many evidence sources for one run.", provider.id);
      if (signals.length + ownSignals.length > EVIDENCE_LIMITS.maxSignals) throw new EvidenceError("Too many signals for one run.", provider.id);
      const recorded = bundle.provenance?.recorded === true || own.some((source) => source.provenance?.recorded === true);
      if (recorded && context.mode === "live") throw new EvidenceError("Recorded fixtures are not allowed in live runs.", provider.id);
      sources.push(...own);
      facts.push(...ownFacts);
      signals.push(...ownSignals);
      reports.push({ id: provider.id, label: provider.label, trust: provider.trust, status: "ok", recorded, sourceCount: own.length, factCount: ownFacts.length, signalCount: ownSignals.length, elapsedMs: elapsed() });
    } catch (error) {
      const message = error instanceof EvidenceError ? error.message : error instanceof Error && error.message === "timeout" ? "The provider timed out." : "The provider could not supply evidence.";
      if (provider.required) throw new EvidenceError(message, provider.id);
      reports.push({ id: provider.id, label: provider.label, trust: provider.trust, status: "failed", recorded: false, sourceCount: 0, factCount: 0, signalCount: 0, elapsedMs: elapsed(), error: message });
    }
  }
  return { sources, facts, signals, providers: reports };
}
