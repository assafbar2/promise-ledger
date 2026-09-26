import { z } from "zod";
import { commitmentSchema, evidenceSchema, requestSchema } from "../schema";
import { BYO_LIMITS, BYO_SOURCE_TYPES } from "./limits";

const featureSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/);

export const byoSourceSchema = z.object({
  id: z.string().regex(/^U-\d{2}$/),
  type: z.enum(BYO_SOURCE_TYPES),
  title: z.string().min(1).max(BYO_LIMITS.maxTitleChars),
  observedAt: z.iso.datetime({ offset: true }),
  text: z.string().min(1).max(BYO_LIMITS.maxSourceBytes),
}).strict();

export const confirmedFactSchema = z.object({
  id: z.string().regex(/^F-\d{1,2}$/),
  featureId: featureSlug,
  built: z.boolean().nullable(),
  enabled: z.boolean().nullable(),
  verified: z.boolean().nullable(),
  observedAt: z.iso.datetime({ offset: true }),
  evidence: z.array(evidenceSchema).min(1).max(4),
  proposedBy: z.enum(["nemotron", "pattern"]),
  corrected: z.array(z.enum(["featureId", "built", "enabled", "verified", "observedAt"])).max(5),
}).strict();

const workspace = z.string().max(BYO_LIMITS.maxWorkspaceNameChars);
const sources = z.array(byoSourceSchema).min(1).max(BYO_LIMITS.maxSources);

export const byoRequestSchema = z.discriminatedUnion("phase", [
  z.object({ phase: z.literal("extract"), workspace, sources }).strict(),
  z.object({
    phase: z.literal("decide"),
    workspace,
    sources,
    extractor: z.enum(["nemotron", "pattern"]),
    commitments: z.array(commitmentSchema.extend({ featureId: featureSlug })).max(BYO_LIMITS.maxCommitments),
    facts: z.array(confirmedFactSchema).max(BYO_LIMITS.maxFacts),
    excludedCommitments: z.number().int().min(0).max(BYO_LIMITS.maxCommitments),
  }).strict(),
]);

/** Everything POST /api/pipeline and /api/analyze accept. The scenario only applies to sample accounts. */
export const pipelineRequestSchema = requestSchema.extend({
  scenario: requestSchema.shape.scenario.default("blocked"),
  byo: byoRequestSchema.optional(),
  continuation: z.string().min(20).max(6000).optional(),
}).strict().refine((body) => !(body.byo && body.account), { message: "Choose a sample account or your own evidence, not both." })
  .refine((body) => !body.continuation || body.byo?.phase === "decide", { message: "A continuation only applies to the decide step." });

export type ByoSourceInput = z.infer<typeof byoSourceSchema>;
export type ConfirmedFactInput = z.infer<typeof confirmedFactSchema>;
export type ByoRequest = z.infer<typeof byoRequestSchema>;
export type PipelineRequest = z.infer<typeof pipelineRequestSchema>;
