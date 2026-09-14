import { z } from "zod";

export const evidenceSchema = z.object({
  sourceId: z.string().min(1).max(80),
  quote: z.string().min(12).max(2500),
}).strict();

export const commitmentSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
  featureId: z.string().min(1).max(80),
  title: z.string().min(3).max(140),
  owner: z.string().min(1).max(80).nullable(),
  dueDate: z.iso.date().nullable(),
  intent: z.enum(["committed", "tentative"]),
  evidence: z.array(evidenceSchema).min(1).max(6),
}).strict();

export const extractionSchema = z.object({
  commitments: z.array(commitmentSchema).max(20),
}).strict();

export const requestSchema = z.object({
  mode: z.enum(["reference", "live"]),
  scenario: z.enum(["blocked", "enabled", "stale"]),
}).strict();

export type Evidence = z.infer<typeof evidenceSchema>;
export type Commitment = z.infer<typeof commitmentSchema>;
export type Scenario = z.infer<typeof requestSchema>["scenario"];
export type SourceKind = "Meeting" | "Support" | "Engineering" | "Availability";
export type Source = {
  id: string;
  accountId: string;
  kind: SourceKind;
  title: string;
  author: string;
  observedAt: string;
  text: string;
};
export type ProductFact = {
  featureId: string;
  accountId: string;
  built: boolean | null;
  enabled: boolean | null;
  verified: boolean | null;
  observedAt: string;
  evidence: Evidence[];
};
export type Verdict = "blocked" | "overdue" | "verify" | "on-track" | "verified" | "discussed" | "unknown";
export type ReconciledCommitment = Commitment & {
  verdict: Verdict;
  reason: string;
  nextAction: string;
  fact: ProductFact | null;
};
export type Analysis = {
  mode: "reference" | "live";
  model: string | null;
  runId: string;
  asOf: string;
  scenario: Scenario;
  commitments: ReconciledCommitment[];
  sources: Source[];
  elapsedMs: number;
  usage: { promptTokens: number; completionTokens: number } | null;
};
