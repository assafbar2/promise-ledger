import type { Source } from "../lib/schema";

export type ExpectedCommitment = {
  featureId: string;
  intent: "committed" | "tentative";
  owner: string | null;
  dueDate: string | null;
};

export type ExtractionCase = {
  id: string;
  category: string;
  sources: Source[];
  expected: ExpectedCommitment[];
};
