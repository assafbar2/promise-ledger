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
export type SourceKind = "Meeting" | "Support" | "Engineering" | "Availability" | "PublicClaim" | "Runtime" | "UserSupplied";
export type SourceProvenance = {
  /** Provider request identifier, e.g. a Tavily request_id or Sentry issue ID. */
  requestId?: string;
  fetchedAt?: string;
  httpStatus?: number;
  credits?: number;
  /** True when the text comes from a recorded response fixture rather than a live fetch. */
  recorded?: boolean;
};
export type Source = {
  id: string;
  accountId: string;
  kind: SourceKind;
  title: string;
  author: string;
  observedAt: string;
  text: string;
  providerId?: string;
  url?: string;
  provenance?: SourceProvenance;
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

export type Claim = { text: string; citations: Evidence[] };
export type Narrative = {
  origin: "model" | "template";
  model: string | null;
  explanation: Claim[];
  customerUpdate: Claim[];
  ownerNudge: Claim[];
  draftText: string;
  fallbackReason: string | null;
};
export type AnalyzedCommitment = ReconciledCommitment & { narrative: Narrative | null };

export type Usage = { promptTokens: number; completionTokens: number };
export type StepId = "triage" | "extraction" | "rules" | "narrative";
export type StepStatus = "queued" | "running" | "done" | "fallback" | "skipped" | "failed";
export type StepEngine = "nemotron" | "fixture" | "rules" | "template";
export type StepSummary = {
  id: StepId;
  label: string;
  role: string;
  engine: StepEngine;
  model: string | null;
  reportedModel: string | null;
  status: StepStatus;
  latencyMs: number | null;
  usage: (Usage & { reasoningTokens: number | null }) | null;
  runId: string | null;
  reservedUsd: number | null;
  costUsd: number | null;
  detail: string;
};
export type PipelineCheck = { stepId: StepId; ok: boolean; label: string; commitmentId?: string };
/**
 * Typed, deterministic observations derived by a provider from its own sources. Each cites an
 * exact quote. Models never create signals. The verdict policy does not read them yet; adding a
 * signal kind and its rule is the extension point for public-claim and runtime-error evidence.
 */
export type ProviderSignal =
  | { kind: "publicClaimGA"; featureId: string; evidence: Evidence }
  | { kind: "runtimeErrors"; featureId: string; count: number; users: number; lastSeen: string; evidence: Evidence };
export type EvidenceProviderReport = { id: string; label: string; trust: "curated" | "untrusted"; status: "ok" | "failed"; recorded: boolean; sourceCount: number; factCount: number; signalCount: number; elapsedMs: number; error?: string };
export type PipelineSummary = {
  replay: boolean;
  steps: StepSummary[];
  checks: PipelineCheck[];
  providers: EvidenceProviderReport[];
  budgetUsd: number | null;
  reservedUsd: number | null;
  costUsd: number | null;
};

export type Analysis = {
  mode: "reference" | "live";
  model: string | null;
  runId: string;
  asOf: string;
  scenario: Scenario;
  commitments: AnalyzedCommitment[];
  sources: Source[];
  elapsedMs: number;
  usage: Usage | null;
  pipeline: PipelineSummary;
};
