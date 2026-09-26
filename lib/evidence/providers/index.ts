import { BYO_ACCOUNT } from "../../byo/sources";
import type { EvidenceProvider } from "../types";
import { sentryRuntimeProvider } from "./sentry-runtime";
import { syntheticPackProvider } from "./synthetic-pack";
import { userSuppliedProvider } from "./user-supplied";

// Register new providers here, one line each, in the order their sources should appear.
export const EVIDENCE_PROVIDERS: readonly EvidenceProvider[] = [
  syntheticPackProvider,
  sentryRuntimeProvider,
  userSuppliedProvider,
];

/** User-supplied evidence runs alone; sample accounts get every other registered provider. */
export function providersFor(accountId: string, providers: readonly EvidenceProvider[] = EVIDENCE_PROVIDERS) {
  const own = accountId === BYO_ACCOUNT;
  return providers.filter((provider) => provider.kinds.includes("UserSupplied") === own);
}
