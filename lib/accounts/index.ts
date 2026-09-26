import { ACCOUNT, AS_OF, createScenario, FEATURE_IDS, referenceCommitments } from "../fixtures";
import { harborHealth } from "./harbor-health";
import { lumenCreditUnion } from "./lumen-credit-union";
import { ridgewayFreight } from "./ridgeway-freight";
import type { AccountPack } from "./types";

export const northstar: AccountPack = {
  id: ACCOUNT.id,
  name: ACCOUNT.name,
  initials: ACCOUNT.initials,
  industry: "Enterprise SaaS workspace",
  situation: "Engineering closed the audit-export ticket, but Northstar's feature flag is still off. Done is not delivered.",
  headlineFeatureId: "audit-export",
  defaultScenario: "blocked",
  asOf: AS_OF,
  featureIds: FEATURE_IDS,
  referenceCommitments,
  createScenario,
};

export const SAMPLE_ACCOUNTS: readonly AccountPack[] = [northstar, harborHealth, ridgewayFreight, lumenCreditUnion];
export const BYO_ACCOUNT_ID = "byo";

export function accountPack(id: string | undefined): AccountPack | null {
  if (id === undefined) return northstar;
  return SAMPLE_ACCOUNTS.find((pack) => pack.id === id) ?? null;
}

export type { AccountPack, AccountRef } from "./types";
