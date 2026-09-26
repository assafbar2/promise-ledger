import type { Evidence, ProductFact } from "../schema";
import { CHUNK_SEPARATOR } from "./tavily";

export const PUBLIC_CLAIM_MAX_AGE_MS = 24 * 3600 * 1000;
const MAX_QUOTE_CHARS = 400;

/** Public product names per known feature ID. Anything not listed here can never become a claim. */
export const PUBLIC_FEATURE_NAMES: Record<string, readonly string[]> = {
  "audit-export": ["audit log export", "audit export"],
  "eu-residency": ["eu data residency"],
  saml: ["saml single sign-on", "saml sso"],
  "usage-report": ["weekly usage report", "usage report"],
  scim: ["scim provisioning"],
  dashboard: ["custom dashboard"],
};

const GA_ABBREVIATION = /\bGA\b/;
const HEDGED = /\b(?:not|no longer|beta|preview|planned|coming soon|will be|expected|limited|private|early access|deprecated)\b/i;
const ISO_DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

export type PublicClaim = { featureId: string; sourceId: string; url: string; quote: string; date: string | null };
export type PublicClaimConflict = { featureId: string; quote: string; date: string | null; url: string; customerEnabled: boolean | null; message: string };

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

/** Collapses whitespace within lines but keeps line breaks, which separate headings from claims. */
export function normalizeText(value: string) {
  return value.split("\n").map(normalizeWhitespace).filter(Boolean).join("\n");
}

/** Source text is the normalised chunks joined back with Tavily's separator, so every quote is a substring of one chunk. */
export function sourceText(chunks: readonly string[], maxChars = 8000) {
  const kept: string[] = [];
  let length = 0;
  for (const chunk of chunks.map(normalizeText).filter(Boolean)) {
    const next = length + (kept.length ? CHUNK_SEPARATOR.length : 0) + chunk.length;
    if (next > maxChars) break;
    kept.push(chunk);
    length = next;
  }
  return kept.join(CHUNK_SEPARATOR);
}

function segments(chunk: string) {
  return chunk.split("\n").flatMap((line) => normalizeWhitespace(line).split(/(?<=[.!?])\s+/)).filter(Boolean);
}

function validDate(value: string) {
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/** True only when the single-line quote sits inside one normalised chunk of the source text. */
export function quoteGrounded(quote: string, text: string) {
  const needle = normalizeWhitespace(quote);
  return needle.length >= 12 && needle === quote && text.split(CHUNK_SEPARATOR).some((chunk) => chunk.includes(needle));
}

/**
 * Deterministic GA-claim detection over fetched text: a sentence naming exactly one known feature,
 * saying "generally available" or an uppercase "GA", with no hedge or negation and at most one valid
 * ISO date. At most one claim per feature.
 */
export function findPublicClaims({ text, sourceId, url, featureIds }: { text: string; sourceId: string; url: string; featureIds: readonly string[] }): PublicClaim[] {
  const claims = new Map<string, PublicClaim>();
  for (const chunk of text.split(CHUNK_SEPARATOR)) {
    for (const sentence of segments(chunk)) {
      const saysGA = /\bgenerally available\b/i.test(sentence) || GA_ABBREVIATION.test(sentence);
      if (sentence.length < 12 || sentence.length > MAX_QUOTE_CHARS || !saysGA || HEDGED.test(sentence)) continue;
      const lower = sentence.toLowerCase();
      const named = featureIds.filter((id) => (PUBLIC_FEATURE_NAMES[id] ?? []).some((name) => lower.includes(name)));
      if (named.length !== 1 || claims.has(named[0])) continue;
      const dates = sentence.match(ISO_DATE) ?? [];
      if (dates.length > 1 || (dates[0] && !validDate(dates[0]))) continue;
      if (!quoteGrounded(sentence, text)) continue;
      claims.set(named[0], { featureId: named[0], sourceId, url, quote: sentence, date: dates[0] ?? null });
    }
  }
  return [...claims.values()];
}

export function claimEvidence(claim: PublicClaim): Evidence {
  return { sourceId: claim.sourceId, quote: claim.quote };
}

export function claimFresh(fetchedAt: string, now: string) {
  const age = Date.parse(now) - Date.parse(fetchedAt);
  return Number.isFinite(age) && age >= -60_000 && age <= PUBLIC_CLAIM_MAX_AGE_MS;
}

/**
 * A public GA claim never changes a verdict. It raises a conflict when the customer-specific fact
 * does not show the feature enabled, so the update must not tell the customer it is available.
 */
export function publicClaimConflicts(claims: readonly PublicClaim[], facts: readonly ProductFact[], accountName: string): PublicClaimConflict[] {
  return claims.flatMap((claim) => {
    const fact = facts.find((candidate) => candidate.featureId === claim.featureId);
    const customerEnabled = fact?.enabled ?? null;
    if (customerEnabled === true) return [];
    const publicly = claim.date ? `generally available since ${claim.date}` : "generally available";
    const customer = customerEnabled === false ? `disabled for ${accountName}` : `not confirmed as enabled for ${accountName}`;
    return [{ featureId: claim.featureId, quote: claim.quote, date: claim.date, url: claim.url, customerEnabled, message: `Publicly GA ≠ usable by this customer: the public changelog says ${publicly}, but the feature is ${customer}.` }];
  });
}
