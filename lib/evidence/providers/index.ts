import type { EvidenceProvider } from "../types";
import { sentryRuntimeProvider } from "./sentry-runtime";
import { syntheticPackProvider } from "./synthetic-pack";

// Register new providers here, one line each, in the order their sources should appear.
export const EVIDENCE_PROVIDERS: readonly EvidenceProvider[] = [
  syntheticPackProvider,
  sentryRuntimeProvider,
];
