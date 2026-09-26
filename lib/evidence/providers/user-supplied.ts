import { checkByoSources, normalizeByoSource, toSource } from "../../byo/sources";
import type { EvidenceProvider } from "../types";

/**
 * Text the user pasted or dropped in the browser (.txt, .md, .csv, .eml). Untrusted: its sources
 * can be read and cited by models, but it never contributes facts. Availability facts proposed
 * from this text reach the rules only after the user confirms them. Nothing is fetched: links in
 * the text stay text.
 */
export const userSuppliedProvider: EvidenceProvider = {
  id: "user-supplied",
  label: "Evidence you supplied",
  trust: "untrusted",
  kinds: ["UserSupplied"],
  required: true,
  timeoutMs: 1000,
  enabled: () => true,
  async fetch({ userEvidence, now }) {
    const inputs = (userEvidence ?? []).map(normalizeByoSource);
    checkByoSources(inputs);
    return { sources: inputs.map((input) => toSource(input, now)), provenance: { recorded: false } };
  },
};
