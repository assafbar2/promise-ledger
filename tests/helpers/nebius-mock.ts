import { createScenario, referenceCommitments } from "../../lib/fixtures.ts";
import { PIPELINE_MODEL_DEFAULTS } from "../../lib/pipeline/models.ts";

export const MODELS = { triage: PIPELINE_MODEL_DEFAULTS.triage, extraction: "nvidia/test-Nemotron", narrative: PIPELINE_MODEL_DEFAULTS.narrative };
export type Step = keyof typeof MODELS;

export function triageContent(scenario: "blocked" | "enabled" | "stale" = "blocked") {
  const roles: Record<string, string> = { "SRC-01": "commitment", "SRC-02": "delivery-evidence", "SRC-03": "delivery-evidence", "SRC-04": "customer-signal", "SRC-05": "delivery-evidence", "SRC-06": "customer-signal" };
  return JSON.stringify({ sources: createScenario(scenario).sources.map((source) => ({ sourceId: source.id, role: roles[source.id], features: source.id === "SRC-04" ? ["audit-export"] : [], injectionSuspected: false })) });
}

export function extractionContent() {
  return JSON.stringify({ commitments: referenceCommitments });
}

type Brief = { commitmentId: string; explanation: unknown[]; customerUpdate: unknown[]; ownerNudge: unknown[] };

export function briefsFor(overrides: Record<string, Partial<Brief>> = {}) {
  const briefs = referenceCommitments.filter((commitment) => commitment.intent === "committed").map((commitment): Brief => {
    const cite = [commitment.evidence[0]];
    return {
      commitmentId: commitment.id,
      explanation: [{ text: "The promise and the customer-specific evidence are recorded in different places, and only the customer evidence decides status.", citations: cite }],
      customerUpdate: [{ text: "We are checking the customer-specific evidence before we confirm anything about this item.", citations: cite }],
      ownerNudge: [{ text: "Please confirm the customer-specific status so the update stays accurate.", citations: cite }],
      ...overrides[commitment.id],
    };
  });
  return briefs;
}

export const AUDIT_EXPORT_BRIEF: Partial<Brief> = {
  explanation: [
    { text: "Engineering marked the audit export complete and it passed internal CI.", citations: [{ sourceId: "SRC-02", quote: "implementation complete; built=true. Build 2.14 passed internal CI." }] },
    { text: "Northstar's own entitlement is still off, and their admin reports the export button is missing.", citations: [{ sourceId: "SRC-03", quote: "The customer-specific audit_export entitlement is disabled." }, { sourceId: "SRC-04", quote: "The audit export button is still missing in our Northstar workspace." }] },
  ],
  customerUpdate: [
    { text: "The audit log export work is finished on our side, but it is not yet switched on for your workspace.", citations: [{ sourceId: "SRC-03", quote: "The customer-specific audit_export entitlement is disabled." }] },
    { text: "We are enabling access and will confirm with you once an export succeeds in your workspace.", citations: [{ sourceId: "SRC-04", quote: "We cannot export logs for the security review." }] },
  ],
  ownerNudge: [{ text: "Maya, please enable the Northstar audit_export entitlement and ask Alex to retry an export.", citations: [{ sourceId: "SRC-03", quote: "The customer-specific audit_export entitlement is disabled." }] }],
};

export function narrativeContent(overrides: Record<string, Partial<Brief>> = { "PL-101": AUDIT_EXPORT_BRIEF }) {
  return JSON.stringify({ briefs: briefsFor(overrides) });
}

export type Reply = { content?: string; status?: number; finishReason?: string; model?: string; usage?: { prompt_tokens: number; completion_tokens: number } | null; throws?: boolean };

function sse(content: string, id: string, model: string, finishReason: string, usage: Reply["usage"]) {
  const chunks: string[] = [];
  for (let index = 0; index < content.length; index += 24) chunks.push(`data: ${JSON.stringify({ id, model, choices: [{ index: 0, delta: { content: content.slice(index, index + 24) }, finish_reason: null }] })}\n\n`);
  chunks.push(`data: ${JSON.stringify({ id, model, choices: [{ index: 0, delta: {}, finish_reason: finishReason }] })}\n\n`);
  if (usage) chunks.push(`data: ${JSON.stringify({ id, model, choices: [], usage })}\n\n`);
  chunks.push("data: [DONE]\n\n");
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(encoder.encode(chunk)); controller.close(); } }), { headers: { "Content-Type": "text/event-stream" } });
}

export type Call = { step: Step | "unknown"; body: Record<string, unknown>; url: string };

/** Fetch double for Token Factory. Routes by requested model; any other URL throws. */
export function nebiusMock(replies: Partial<Record<Step, Reply>> = {}, scenario: "blocked" | "enabled" | "stale" = "blocked") {
  const calls: Call[] = [];
  const defaults: Record<Step, string> = { triage: triageContent(scenario), extraction: extractionContent(), narrative: narrativeContent() };
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://api.tokenfactory.nebius.com/")) throw new Error(`Unexpected network call to ${url}`);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const step = (Object.keys(MODELS) as Step[]).find((key) => MODELS[key] === body.model) ?? "unknown";
    calls.push({ step, body, url });
    const reply: Reply = step === "unknown" ? { status: 404 } : replies[step] ?? {};
    if (reply.throws) throw new Error("socket hang up with secret-transport-detail");
    if (reply.status && reply.status !== 200) return new Response("provider-secret-body", { status: reply.status });
    const content = reply.content ?? (step === "unknown" ? "" : defaults[step]);
    const model = reply.model ?? String(body.model);
    const usage = reply.usage === undefined ? { prompt_tokens: 900, completion_tokens: 400 } : reply.usage;
    const id = `stub-${step}-run`;
    const finishReason = reply.finishReason ?? "stop";
    if (body.stream === true) return sse(content, id, model, finishReason, usage);
    return Response.json({ id, model, choices: [{ finish_reason: finishReason, message: { content } }], ...(usage ? { usage } : {}) });
  };
  return { fetcher, calls };
}
