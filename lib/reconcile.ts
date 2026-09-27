import { extractionSchema, type Commitment, type ProductFact, type ProviderSignal, type ReconciledCommitment, type Source } from "./schema";
import { runtimeFailure, runtimeReason } from "./sentry/policy";

export const FEATURE_SLUG = /^[a-z0-9][a-z0-9-]{1,39}$/;

/** `featureIds: null` accepts any kebab-case feature slug (user-supplied evidence has no fixed list). */
export function validateExtraction(input: unknown, sources: Source[], accountId: string, featureIds: string[] | null): Commitment[] {
  const { commitments } = extractionSchema.parse(input);
  const identifiers = new Set<string>();
  const features = new Set<string>();
  for (const commitment of commitments) {
    if (identifiers.has(commitment.id) || features.has(commitment.featureId)) throw new Error("Duplicate commitment or feature.");
    identifiers.add(commitment.id);
    features.add(commitment.featureId);
    if (featureIds ? !featureIds.includes(commitment.featureId) : !FEATURE_SLUG.test(commitment.featureId)) throw new Error("Unknown feature in model output.");
    const excerpts: string[] = [];
    for (const evidence of commitment.evidence) {
      const source = sources.find((candidate) => candidate.id === evidence.sourceId && candidate.accountId === accountId);
      if (!source || !source.text.includes(evidence.quote)) throw new Error("Evidence is missing, cross-account, or not an exact source quote.");
      excerpts.push(evidence.quote);
    }
    const grounding = excerpts.join("\n");
    if (commitment.owner && !grounding.includes(commitment.owner)) throw new Error("Owner is not present in cited evidence.");
    if (commitment.dueDate && !grounding.includes(commitment.dueDate)) throw new Error("Deadline is not present in cited evidence.");
  }
  return commitments;
}

/**
 * When a quote omits its speaker label, cite the label too: "Maya Chen: I will …" instead of
 * "I will …", if and only if the source has exactly `${owner}: ` right before the quote. The
 * quote stays exact source text and the owner-in-quote rule still applies unchanged.
 */
export function withSpeakerLabel(commitment: Commitment, sources: Source[]): Commitment {
  const owner = commitment.owner;
  if (!owner || commitment.evidence.some((evidence) => evidence.quote.includes(owner))) return commitment;
  const index = commitment.evidence.findIndex((evidence) => sources.some((source) => source.id === evidence.sourceId && source.text.includes(`${owner}: ${evidence.quote}`)));
  if (index < 0) return commitment;
  const evidence = commitment.evidence.map((item, position) => position === index ? { ...item, quote: `${owner}: ${item.quote}` } : item);
  return { ...commitment, evidence };
}

/**
 * When a quote is exact text of a different source than the one named, cite that source instead,
 * but only if exactly one in-account source contains it. Anything else stays as returned.
 */
export function withQuotedSource(commitment: Commitment, sources: Source[], accountId: string): Commitment {
  const evidence = commitment.evidence.map((item) => {
    if (sources.some((source) => source.id === item.sourceId && source.accountId === accountId && source.text.includes(item.quote))) return item;
    const holders = sources.filter((source) => source.accountId === accountId && source.text.includes(item.quote));
    return holders.length === 1 ? { ...item, sourceId: holders[0].id } : item;
  });
  return evidence.every((item, index) => item === commitment.evidence[index]) ? commitment : { ...commitment, evidence };
}

/**
 * Model extraction, judged commitment by commitment. The envelope must be exact. A commitment that
 * repeats a feature or ID, names an unknown feature, cites text that is not exactly in an
 * in-account source, or whose owner or date is not in its quotes is dropped and reported; the
 * rest are kept. Nothing ungrounded is accepted.
 */
export function groundCommitments(input: unknown, sources: Source[], accountId: string, featureIds: string[] | null): { commitments: Commitment[]; dropped: string[] } {
  const { commitments: proposed } = extractionSchema.parse(input);
  const commitments: Commitment[] = [];
  const dropped: string[] = [];
  for (const raw of proposed) {
    if (commitments.some((kept) => kept.id === raw.id || kept.featureId === raw.featureId)) { dropped.push(`${raw.featureId.slice(0, 40)} appeared more than once`); continue; }
    const commitment = withSpeakerLabel(withQuotedSource(raw, sources, accountId), sources);
    try { validateExtraction({ commitments: [commitment] }, sources, accountId, featureIds); commitments.push(commitment); } catch (error) {
      dropped.push(`${commitment.featureId.slice(0, 40)}: ${error instanceof Error ? error.message.replace(/\.$/, "").toLowerCase() : "failed validation"}`);
    }
  }
  return { commitments, dropped };
}

export function reconcile(commitment: Commitment, facts: ProductFact[], accountId: string, asOf: string, runtime?: { signals: readonly ProviderSignal[]; sources: readonly Source[] }, accountName = "Northstar"): ReconciledCommitment {
  const fact = facts.find((candidate) => candidate.featureId === commitment.featureId && candidate.accountId === accountId) ?? null;
  const base = { ...commitment, fact };
  if (commitment.intent === "tentative") return { ...base, verdict: "discussed", reason: "An idea was discussed, but no delivery commitment was made.", nextAction: "Clarify scope before creating a promise. Do not invent an owner or deadline." };
  if (!fact) return { ...base, verdict: "unknown", reason: "No account-specific product evidence is available.", nextAction: "Obtain an availability snapshot for this customer before making a delivery claim." };
  const age = Date.parse(asOf) - Date.parse(fact.observedAt);
  if (!Number.isFinite(age) || age < 0 || age > 72 * 60 * 60 * 1000) return { ...base, verdict: "unknown", reason: "The availability evidence is stale or has an invalid timestamp.", nextAction: "Refresh the customer-specific evidence. Old or future-dated telemetry cannot prove delivery." };
  if (fact.built === true && fact.enabled === false) return { ...base, verdict: "blocked", reason: "Engineering is done. The customer-specific feature flag is still off.", nextAction: `Ask the owner to enable the ${accountName} entitlement, then confirm a successful customer test.` };
  const failing = runtime ? runtimeFailure(fact, runtime.signals, runtime.sources) : null;
  if (failing) return { ...base, runtime: failing, verdict: "verify", reason: runtimeReason(failing, accountName), nextAction: `Review the linked runtime issue with the owner and confirm a successful ${accountName} run before claiming delivery. Enabled is not the same as working.` };
  if (fact.built === true && fact.enabled === true && fact.verified === true) return { ...base, verdict: "verified", reason: "Built, enabled for this customer, and confirmed by an acceptance test.", nextAction: "Review the evidence before sharing the delivery update." };
  if (fact.built === null || fact.enabled === null || (fact.verified === true && (fact.built !== true || fact.enabled !== true))) return { ...base, verdict: "unknown", reason: "The product signals are incomplete or inconsistent.", nextAction: "Resolve the conflicting evidence rather than inferring delivery." };
  if (commitment.dueDate && commitment.dueDate < asOf.slice(0, 10)) return { ...base, verdict: "overdue", reason: "The promised date has passed without verified customer delivery.", nextAction: "Confirm the blocker and agree a new date with the owner before updating the customer." };
  if (fact.built && fact.enabled) return { ...base, verdict: "verify", reason: "The feature is enabled, but a successful customer test is not recorded.", nextAction: `Run an acceptance test with ${accountName}. Availability is not the same as usable delivery.` };
  return { ...base, verdict: "on-track", reason: "The deadline is ahead; delivery has not yet been verified.", nextAction: "Confirm progress with the owner. A future deadline is not evidence of delivery." };
}

export function draftSummary(commitment: ReconciledCommitment): string {
  return commitment.verdict === "verified"
    ? `We have verified that ${commitment.title.toLowerCase()} is enabled for your workspace and has passed the customer acceptance test.`
    : commitment.verdict === "blocked"
      ? `The ${commitment.title.toLowerCase()} implementation is complete, but it is not yet available in your workspace. We are checking customer access before confirming delivery.`
      : `${commitment.title} is not yet verified as delivered. ${commitment.reason}`;
}

export function draftUpdate(commitment: ReconciledCommitment, accountName = "Northstar"): string {
  const context = `${commitment.title} — ${accountName}`;
  return `${context}\n\n${draftSummary(commitment)}\n\nNext step: ${commitment.nextAction}\n${commitment.owner ? `Owner: ${commitment.owner}.` : "Owner: not agreed."} We will confirm timing after that check; this update does not create a new delivery date.\n\nPrepared for human review. Nothing has been sent.`;
}
