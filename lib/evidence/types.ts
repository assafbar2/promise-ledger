import type { ProductFact, ProviderSignal, Scenario, Source, SourceKind } from "../schema";

export type EvidenceEnv = Record<string, string | undefined>;

/**
 * `curated` providers are server-owned and may contribute ProductFacts, the only input the
 * deterministic verdict policy trusts today. `untrusted` providers (public web, pasted text,
 * error feeds) contribute sources that models may read and cite, plus typed signals derived
 * deterministically from exact quotes. They never contribute facts.
 */
export type EvidenceTrust = "curated" | "untrusted";

export type EvidenceContext = {
  accountId: string;
  featureIds: readonly string[];
  scenario: Scenario;
  /** Reference runs must return recorded fixtures (marked `provenance.recorded`); live runs never fall back to them. */
  mode: "reference" | "live";
  /** Demo snapshot time. Live providers check freshness against `now`, the real clock. */
  asOf: string;
  now: string;
  signal: AbortSignal;
  env: EvidenceEnv;
};

export type ProviderProvenance = { requestId?: string; httpStatus?: number; credits?: number; recorded: boolean };

export type EvidenceBundle = {
  sources: Source[];
  facts?: ProductFact[];
  signals?: ProviderSignal[];
  provenance?: ProviderProvenance;
};

export interface EvidenceProvider {
  readonly id: string;
  readonly label: string;
  readonly trust: EvidenceTrust;
  readonly kinds: readonly SourceKind[];
  /** A required provider's failure fails the run; optional providers are reported and skipped. */
  readonly required: boolean;
  /** Hard per-provider deadline. The registry aborts `context.signal` when it passes. No retries. */
  readonly timeoutMs: number;
  /** Env present and feature flag on. Called on every run; keep it cheap and side-effect free. */
  enabled(env: EvidenceEnv, run: Pick<EvidenceContext, "mode" | "scenario">): boolean;
  fetch(context: EvidenceContext): Promise<EvidenceBundle>;
}
