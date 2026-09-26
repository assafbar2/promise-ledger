import type { ByoProposal, FactConfirmation, ProposedFact } from "../schema";
import type { ByoRequest, ByoSourceInput } from "./schema";

export type FactEdit = Pick<ProposedFact, "featureId" | "built" | "enabled" | "verified" | "observedAt"> & { confirmed: boolean };
export type CommitmentEdit = { included: boolean; intent: "committed" | "tentative" };
export type ByoReview = { facts: Record<string, FactEdit>; commitments: Record<string, CommitmentEdit> };

/** Every proposed fact starts unconfirmed: a person must accept or correct it before rules read it. */
export function initialReview(proposal: ByoProposal): ByoReview {
  return {
    facts: Object.fromEntries(proposal.facts.map((fact) => [fact.id, { featureId: fact.featureId, built: fact.built, enabled: fact.enabled, verified: fact.verified, observedAt: fact.observedAt, confirmed: false }])),
    commitments: Object.fromEntries(proposal.commitments.map((commitment) => [commitment.id, { included: true, intent: commitment.intent }])),
  };
}

export function correctedFields(original: ProposedFact, edit: FactEdit): FactConfirmation["corrected"] {
  const fields: FactConfirmation["corrected"] = [];
  if (edit.featureId !== original.featureId) fields.push("featureId");
  if (edit.built !== original.built) fields.push("built");
  if (edit.enabled !== original.enabled) fields.push("enabled");
  if (edit.verified !== original.verified) fields.push("verified");
  if (Date.parse(edit.observedAt) !== Date.parse(original.observedAt)) fields.push("observedAt");
  return fields;
}

/** Builds the decide request from the proposal and the person's review. Unconfirmed facts are left out. */
export function decideRequest(workspace: string, sources: ByoSourceInput[], proposal: ByoProposal, review: ByoReview): Extract<ByoRequest, { phase: "decide" }> {
  const commitments = proposal.commitments.filter((commitment) => review.commitments[commitment.id]?.included !== false)
    .map((commitment) => {
      const intent = review.commitments[commitment.id]?.intent ?? commitment.intent;
      return intent === commitment.intent ? commitment : { ...commitment, intent, ...(intent === "tentative" ? { owner: null, dueDate: null } : {}) };
    });
  const facts = proposal.facts.flatMap((fact) => {
    const edit = review.facts[fact.id];
    if (!edit?.confirmed) return [];
    return [{ id: fact.id, featureId: edit.featureId, built: edit.built, enabled: edit.enabled, verified: edit.verified, observedAt: new Date(edit.observedAt).toISOString(), evidence: fact.evidence, proposedBy: proposal.extractor, corrected: correctedFields(fact, edit) }];
  });
  return { phase: "decide", workspace, sources, extractor: proposal.extractor, commitments, facts, excludedCommitments: proposal.commitments.length - commitments.length };
}

/** Features a fact can be mapped to: every proposed commitment's feature plus every proposed fact's. */
export function featureOptions(proposal: ByoProposal) {
  return [...new Set([...proposal.commitments.map((commitment) => commitment.featureId), ...proposal.facts.map((fact) => fact.featureId)])];
}

/** Two confirmed facts for one feature would be ambiguous; the decide step rejects it, so the UI blocks it first. */
export function duplicateConfirmedFeatures(review: ByoReview) {
  const counts = new Map<string, number>();
  for (const edit of Object.values(review.facts)) if (edit.confirmed) counts.set(edit.featureId, (counts.get(edit.featureId) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([featureId]) => featureId);
}
