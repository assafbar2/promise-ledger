import { accountPack } from "../../accounts";
import type { EvidenceProvider } from "../types";

export const syntheticPackProvider: EvidenceProvider = {
  id: "synthetic-pack",
  label: "Synthetic sample-account evidence pack",
  trust: "curated",
  kinds: ["Meeting", "Support", "Engineering", "Availability"],
  required: true,
  timeoutMs: 1000,
  enabled: () => true,
  async fetch({ accountId, scenario }) {
    const pack = accountPack(accountId);
    if (!pack) throw new Error("Unknown sample account.");
    const { sources, facts } = pack.createScenario(scenario);
    return { sources, facts, provenance: { recorded: false } };
  },
};
