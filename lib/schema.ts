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
  scenario: z.enum(["blocked", "enabled", "stale", "crashing"]),
  /** Sample account ID; defaults to Northstar. User-supplied evidence uses the `byo` request instead. */
  account: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
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
  /** Present when a fact came from untrusted text: proposed by an extractor, then confirmed by a person. */
  confirmation?: FactConfirmation;
};
export type FactConfirmation = { by: "user"; proposedBy: "nemotron" | "pattern"; corrected: ("featureId" | "built" | "enabled" | "verified" | "observedAt")[] };
/** A model- or pattern-proposed availability fact. It reaches the rules only after a person confirms it. */
export type ProposedFact = Omit<ProductFact, "accountId" | "confirmation"> & { id: string };
export type Verdict = "blocked" | "overdue" | "verify" | "on-track" | "verified" | "discussed" | "unknown";
/** Fresh runtime errors for an enabled feature, aggregated from cited Runtime sources. */
export type RuntimeFinding = { count: number; users: number; issues: number; lastSeen: string; evidence: Evidence[] };
export type ReconciledCommitment = Commitment & {
  verdict: Verdict;
  reason: string;
  nextAction: string;
  fact: ProductFact | null;
  runtime?: RuntimeFinding;
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
/** `pattern`: the no-AI extractor for user-supplied text; `confirmed`: facts a person confirmed earlier, reused without a model call. */
export type StepEngine = "nemotron" | "fixture" | "rules" | "template" | "pattern" | "confirmed";
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

export type AnalysisAccount = { id: string; name: string; kind: "sample" | "byo" };
export type ByoSummary = { extractor: "nemotron" | "pattern"; confirmedFacts: number; correctedFacts: number; excludedCommitments: number };

export type Analysis = {
  mode: "reference" | "live";
  model: string | null;
  runId: string;
  asOf: string;
  scenario: Scenario;
  account: AnalysisAccount;
  byo?: ByoSummary;
  commitments: AnalyzedCommitment[];
  sources: Source[];
  elapsedMs: number;
  usage: Usage | null;
  pipeline: PipelineSummary;
};

/**
 * Result of the extract step for user-supplied evidence: proposed commitments and availability
 * facts with exact quotes, awaiting human confirmation. No verdict exists yet.
 */
export type ByoProposal = {
  runId: string;
  mode: "reference" | "live";
  extractor: "nemotron" | "pattern";
  model: string | null;
  account: AnalysisAccount;
  asOf: string;
  sources: Source[];
  commitments: Commitment[];
  facts: ProposedFact[];
  flagged: { sourceId: string; reason: string }[];
  dropped: string[];
  elapsedMs: number;
  usage: Usage | null;
  pipeline: PipelineSummary;
  continuation: { token: string; expiresAt: string } | null;
};
