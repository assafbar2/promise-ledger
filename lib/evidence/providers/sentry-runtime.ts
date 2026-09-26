import recording from "../../sentry/recorded-runtime.json" with { type: "json" };
import { createRuntimeCache, fetchRuntimeIssues, replayRuntimeIssues, runtimeEvidence, SENTRY_TIMEOUT_MS, sentryConfig, SentryError, type RuntimeRecording } from "../../sentry/runtime";
import { EvidenceError } from "../registry";
import type { EvidenceProvider } from "../types";

const cache = createRuntimeCache();

export const RECORDED_RUNTIME = recording as RuntimeRecording;

/**
 * Runtime errors from Sentry, scoped by exact `customer` and `feature` tags. Only the "crashing"
 * scenario uses it: live runs read the API, reference runs replay the recorded response. Every
 * other scenario makes no Sentry call, because the seeded demo errors are always fresh and would
 * otherwise mask the "evidence changed, now verified" story. In live "crashing" without Sentry
 * env the provider still runs and fails visibly instead of silently showing a clean result.
 */
export const sentryRuntimeProvider: EvidenceProvider = {
  id: "sentry-runtime",
  label: "Sentry runtime errors",
  trust: "untrusted",
  kinds: ["Runtime"],
  required: false,
  timeoutMs: SENTRY_TIMEOUT_MS,
  enabled: (_env, { scenario }) => scenario === "crashing",
  async fetch({ accountId, featureIds, mode, now, signal, env }) {
    const recorded = mode === "reference";
    try {
      const result = recorded
        ? await replayRuntimeIssues(RECORDED_RUNTIME, { accountId, featureIds, signal })
        : await (() => {
          const config = sentryConfig(env);
          const key = [config.base, config.org, config.projectId, config.token, accountId, ...featureIds].join("|");
          return cache.get(key, Date.parse(now), () => fetchRuntimeIssues(config, { accountId, featureIds, now, signal }));
        })();
      const { sources, signals } = runtimeEvidence(result, recorded);
      return { sources, signals, provenance: { httpStatus: result.httpStatus, recorded } };
    } catch (error) {
      throw new EvidenceError(error instanceof SentryError ? `Sentry unavailable: ${error.message}` : "Sentry unavailable.", "sentry-runtime");
    }
  },
};
