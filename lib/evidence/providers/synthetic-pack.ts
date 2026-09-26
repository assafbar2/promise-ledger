import { createScenario } from "../../fixtures";
import type { EvidenceProvider } from "../types";

export const syntheticPackProvider: EvidenceProvider = {
  id: "synthetic-pack",
  label: "Synthetic Northstar evidence pack",
  trust: "curated",
  kinds: ["Meeting", "Support", "Engineering", "Availability"],
  required: true,
  timeoutMs: 1000,
  enabled: () => true,
  async fetch({ scenario }) {
    const { sources, facts } = createScenario(scenario);
    return { sources, facts, provenance: { recorded: false } };
  },
};
