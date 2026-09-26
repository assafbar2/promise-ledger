import type { Commitment, ProductFact, Scenario, Source } from "../schema";
import type { AccountPack } from "./types";

type Snapshot = { text: string; observedAt: string; built: boolean; enabled: boolean; verified: boolean };
type FactSpec = { featureId: string; sourceId: string; quote: string; built: boolean | null; enabled: boolean | null; verified: boolean | null };

export type PackDefinition = Omit<AccountPack, "createScenario" | "featureIds"> & {
  sources: Omit<Source, "accountId">[];
  headline: { sourceId: string; supportingSourceId?: string; scenarios: Record<Scenario, Snapshot> };
  facts: FactSpec[];
};

/**
 * Builds a sample pack whose curated facts cite exact text from its own sources. Scenarios only
 * rewrite the headline availability snapshot, so every account supports the same three what-ifs.
 */
export function buildPack(definition: PackDefinition): AccountPack {
  const { sources: baseSources, headline, facts: specs, ...pack } = definition;
  const featureIds = [...new Set(pack.referenceCommitments.map((commitment: Commitment) => commitment.featureId))];
  return {
    ...pack,
    featureIds,
    createScenario(scenario) {
      const snapshot = headline.scenarios[scenario];
      const sources: Source[] = baseSources.map((source) => ({ ...source, accountId: pack.id, ...(source.id === headline.sourceId ? { text: snapshot.text, observedAt: snapshot.observedAt } : {}) }));
      const text = (id: string) => sources.find((source) => source.id === id)!;
      const supporting = headline.supportingSourceId ? [{ sourceId: headline.supportingSourceId, quote: text(headline.supportingSourceId).text }] : [];
      const facts: ProductFact[] = [
        { featureId: pack.headlineFeatureId, accountId: pack.id, built: snapshot.built, enabled: snapshot.enabled, verified: snapshot.verified, observedAt: snapshot.observedAt, evidence: [...supporting, { sourceId: headline.sourceId, quote: snapshot.text }] },
        ...specs.map((spec): ProductFact => ({ featureId: spec.featureId, accountId: pack.id, built: spec.built, enabled: spec.enabled, verified: spec.verified, observedAt: text(spec.sourceId).observedAt, evidence: [{ sourceId: spec.sourceId, quote: spec.quote }] })),
      ];
      return { sources, facts };
    },
  };
}
