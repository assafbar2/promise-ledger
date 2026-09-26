import recording from "../../sentry/recorded-runtime.json" with { type: "json" };
import { createRuntimeCache, fetchRuntimeIssues, replayRuntimeIssues, runtimeEvidence, SENTRY_TIMEOUT_MS, sentryConfig, sentryConfigured, SentryError, type RuntimeRecording } from "../../sentry/runtime";
import { EvidenceError } from "../registry";
import type { EvidenceProvider } from "../types";

const cache = createRuntimeCache();

export const RECORDED_RUNTIME = recording as RuntimeRecording;

/**
 * Runtime errors from Sentry, scoped by exact `customer` and `feature` tags. Live runs read the
 * API when it is configured. Reference runs replay the recorded response only in the separate
 * "crashing" scenario, so the other reference scenarios are unchanged.
 */
export const sentryRuntimeProvider: EvidenceProvider = {
  id: "sentry-runtime",
  label: "Runtime errors · error-monitoring provider",
  trust: "untrusted",
  kinds: ["Runtime"],
  required: false,
  timeoutMs: SENTRY_TIMEOUT_MS,
  enabled: (env, { mode, scenario }) => mode === "live" ? sentryConfigured(env) : scenario === "crashing",
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
