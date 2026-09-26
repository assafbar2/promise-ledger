import recording from "../../public-claims/recorded-changelog.json" with { type: "json" };
import { checkPublicClaims, replayPublicClaims, type PublicClaimRecording } from "../../public-claims/check";
import { EvidenceError } from "../errors";
import type { EvidenceProvider } from "../types";

const ID = "tavily-public-claim";

/** A genuine Tavily Extract response for the hosted changelog, captured September 26, 2026. */
export const RECORDED_PUBLIC_CLAIMS = recording as PublicClaimRecording;

export const tavilyPublicClaimProvider: EvidenceProvider = {
  id: ID,
  label: "Public claim check · Tavily Extract",
  trust: "untrusted",
  kinds: ["PublicClaim"],
  required: false,
  timeoutMs: 10000,
  // Always on, so a live run without a key visibly reports "public claim not checked".
  enabled: () => true,
  async fetch(context) {
    if (context.mode === "reference") {
      const { sources, signals } = await replayPublicClaims(RECORDED_PUBLIC_CLAIMS, context);
      return { sources, signals, provenance: { requestId: sources[0]?.provenance.requestId, httpStatus: sources[0]?.provenance.httpStatus, recorded: true } };
    }
    const result = await checkPublicClaims({ accountId: context.accountId, featureIds: context.featureIds, now: context.now, env: context.env, signal: context.signal });
    if (result.status !== "checked") throw new EvidenceError(result.message, ID);
    const first = result.sources[0]?.provenance;
    return { sources: result.sources, signals: result.signals, provenance: { requestId: first?.requestId, httpStatus: first?.httpStatus, credits: result.usage.credits, recorded: false } };
  },
};
