export type Env = Record<string, string | undefined>;

export const NEMOTRON_ID = /^nvidia\/.*nemotron/i;

/**
 * Public Nebius Token Factory catalog (https://tokenfactory.nebius.com/api/public/models_info),
 * read September 26, 2026. Prices are USD per million tokens; contexts are `max_model_len`.
 */
export const MODEL_CATALOG_CHECKED_AT = "2026-09-26";
export const MODEL_CATALOG: Record<string, { name: string; inputUsdPerMillion: number; outputUsdPerMillion: number; contextTokens: number }> = {
  "nvidia/nvidia-nemotron-3-nano-30b-a3b": { name: "Nemotron 3 Nano 30B-A3B", inputUsdPerMillion: 0.06, outputUsdPerMillion: 0.24, contextTokens: 262144 },
  "nvidia/nemotron-3-super-120b-a12b": { name: "Nemotron 3 Super 120B-A12B", inputUsdPerMillion: 0.3, outputUsdPerMillion: 0.9, contextTokens: 262144 },
  "nvidia/nemotron-3-ultra-550b-a55b": { name: "Nemotron 3 Ultra 550B-A55B", inputUsdPerMillion: 1, outputUsdPerMillion: 3, contextTokens: 1048576 },
  "nvidia/nemotron-3_5-lightning": { name: "Nemotron 3.5 Lightning", inputUsdPerMillion: 0.06, outputUsdPerMillion: 0.24, contextTokens: 1048576 },
};
// Unlisted model IDs are budgeted at the most expensive listed Nemotron rates.
const UNLISTED = { name: "Unlisted Nemotron model", inputUsdPerMillion: 1, outputUsdPerMillion: 3, contextTokens: 0 };

export function modelInfo(model: string) {
  const listed = MODEL_CATALOG[model.toLowerCase()];
  return listed ? { ...listed, listed: true } : { ...UNLISTED, listed: false };
}

export const PIPELINE_MODEL_DEFAULTS = {
  triage: "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B",
  extraction: "nvidia/nemotron-3-super-120b-a12b",
  narrative: "nvidia/Nemotron-3-Ultra-550b-a55b",
} as const;

export type OptionalModel = { model: string | null; disabledReason: string | null };

function optionalModel(value: string | undefined, fallback: string, name: string): OptionalModel {
  const trimmed = (value ?? "").trim();
  if (!trimmed) return { model: fallback, disabledReason: null };
  if (/^(off|none|disabled|false|0)$/i.test(trimmed)) return { model: null, disabledReason: `${name} is turned off on this server.` };
  if (!NEMOTRON_ID.test(trimmed)) return { model: null, disabledReason: `${name} is not an NVIDIA Nemotron model ID, so the step is off.` };
  return { model: trimmed, disabledReason: null };
}

export function pipelineModels(env: Env = process.env) {
  return {
    triage: optionalModel(env.NEBIUS_TRIAGE_MODEL, PIPELINE_MODEL_DEFAULTS.triage, "NEBIUS_TRIAGE_MODEL"),
    extraction: (env.NEBIUS_MODEL ?? "").trim(),
    narrative: optionalModel(env.NEBIUS_NARRATIVE_MODEL, PIPELINE_MODEL_DEFAULTS.narrative, "NEBIUS_NARRATIVE_MODEL"),
  };
}

/** Per-call ceilings. Input is capped in UTF-8 bytes; every token encodes at least one byte. */
export const STEP_LIMITS = {
  triage: { maxInputBytes: 16000, maxOutputTokens: 3000, timeoutMs: 15000 },
  extraction: { maxInputBytes: 16000, maxOutputTokens: 6000, timeoutMs: 45000 },
  narrative: { maxInputBytes: 16000, maxOutputTokens: 7000, timeoutMs: 30000 },
} as const;
export const CHAT_TEMPLATE_OVERHEAD_TOKENS = 512;
export const RUN_DEADLINE_MS = 70000;
export const RUN_BUDGET_DEFAULT_USD = 0.05;
export const RUN_BUDGET_MAX_USD = 0.5;

export function runBudgetUsd(env: Env = process.env) {
  const raw = (env.LIVE_RUN_BUDGET_USD ?? "").trim();
  if (!raw) return RUN_BUDGET_DEFAULT_USD;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 && value <= RUN_BUDGET_MAX_USD ? value : RUN_BUDGET_DEFAULT_USD;
}
