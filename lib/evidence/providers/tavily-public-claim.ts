import { changelogText, PUBLIC_CHANGELOG_PATH, PUBLIC_VENDOR } from "../../public-claims/changelog";
import { checkPublicClaims } from "../../public-claims/check";
import { claimEvidence, findPublicClaims, sourceText } from "../../public-claims/claims";
import { DEFAULT_PUBLIC_HOST } from "../../public-claims/tavily";
import type { Source } from "../../schema";
import { EvidenceError } from "../errors";
import type { EvidenceBundle, EvidenceContext, EvidenceProvider } from "../types";

const ID = "tavily-public-claim";

/** Reference runs show the hosted page's own text, labelled as a fixture. No Tavily call is made. */
function referenceBundle({ accountId, featureIds, asOf }: EvidenceContext): EvidenceBundle {
  const url = `https://${DEFAULT_PUBLIC_HOST}${PUBLIC_CHANGELOG_PATH}`;
  const source: Source = {
    id: "PUB-01",
    accountId,
    kind: "PublicClaim",
    title: `${PUBLIC_VENDOR} public page · ${PUBLIC_CHANGELOG_PATH}`,
    author: "Reference fixture · no Tavily call",
    observedAt: asOf,
    text: sourceText([changelogText()]),
    url,
    provenance: { fetchedAt: asOf, recorded: true },
  };
  const claims = findPublicClaims({ text: source.text, sourceId: source.id, url, featureIds });
  return { sources: [source], signals: claims.map((claim) => ({ kind: "publicClaimGA", featureId: claim.featureId, evidence: claimEvidence(claim) })), provenance: { recorded: true } };
}

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
    if (context.mode === "reference") return referenceBundle(context);
    const result = await checkPublicClaims({ accountId: context.accountId, featureIds: context.featureIds, now: context.now, env: context.env, signal: context.signal });
    if (result.status !== "checked") throw new EvidenceError(result.message, ID);
    const first = result.sources[0]?.provenance;
    return { sources: result.sources, signals: result.signals, provenance: { requestId: first?.requestId, httpStatus: first?.httpStatus, credits: result.usage.credits, recorded: false } };
  },
};
