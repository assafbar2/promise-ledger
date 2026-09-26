import type { Commitment, ProductFact, Scenario, Source } from "../schema";

/**
 * A fictional sample account with its own synthetic evidence pack. The three scenarios are the
 * same what-ifs for every account and act on its headline feature's availability snapshot:
 * built but switched off, enabled and customer-verified, or stale evidence.
 */
export type AccountPack = {
  id: string;
  name: string;
  initials: string;
  industry: string;
  /** One-line description of what makes this account's evidence interesting. */
  situation: string;
  headlineFeatureId: string;
  /** Scenarios this pack can build; only Northstar has the recorded Sentry data behind "crashing". */
  scenarios: readonly Scenario[];
  defaultScenario: Scenario;
  asOf: string;
  featureIds: string[];
  referenceCommitments: Commitment[];
  createScenario(scenario: Scenario): { sources: Source[]; facts: ProductFact[] };
};

export type AccountRef = { id: string; name: string; kind: "sample" | "byo" };
