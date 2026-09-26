import { limitStoreConfig } from "./live-limits";
import { runBudgetUsd } from "./pipeline/models";

type Env = Record<string, string | undefined>;
type StoreConfig = { url: string; token: string };

export const SPEND_CAP_DEFAULT_USD = 30;
export const SPEND_LEDGER_DEFAULT = "1";
const MICRO = 1_000_000;
const STORE_TIMEOUT_MS = 2500;
const KEY_PREFIX = "promise-ledger:spend:v1";

/**
 * Per-run cost of non-Nebius evidence providers, reserved and settled with every live run.
 * Tavily and Sentry are used on free tiers, so both count $0; set a value if either becomes paid.
 */
export const EVIDENCE_PROVIDER_USD_PER_RUN: Record<string, number> = { "tavily-public-claim": 0, "sentry-runtime": 0 };

/** Unset means the default cap; any other unparsable or negative value closes live mode. */
export function spendCapSettings(env: Env = process.env) {
  const raw = (env.LIVE_SPEND_CAP_USD ?? "").trim();
  const parsed = raw === "" ? SPEND_CAP_DEFAULT_USD : Number(raw);
  const capUsd = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  const ledgerRaw = (env.LIVE_SPEND_LEDGER ?? "").trim();
  const ledger = /^[A-Za-z0-9._-]{1,40}$/.test(ledgerRaw) ? ledgerRaw : SPEND_LEDGER_DEFAULT;
  const providersUsd = Object.values(EVIDENCE_PROVIDER_USD_PER_RUN).reduce((total, value) => total + value, 0);
  return { capUsd, ledger, key: `${KEY_PREFIX}:${ledger}`, runReserveUsd: runBudgetUsd(env) + providersUsd, providersUsd };
}

async function command(config: StoreConfig, args: string[], fetcher: typeof fetch) {
  const response = await fetcher(`${config.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify([args]),
    signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Spend ledger unavailable");
  const body: unknown = await response.json();
  const result = Array.isArray(body) && typeof body[0] === "object" && body[0] !== null && "result" in body[0] ? (body[0] as { result: unknown }).result : undefined;
  const value = typeof result === "string" ? Number(result) : result === null && args[0] === "GET" ? 0 : result;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("Spend ledger returned an unexpected response");
  return value;
}

export type SpendReservation = { key: string; micro: number; providersMicro: number; config: StoreConfig };
export type SpendDecision = { allowed: true; reservation: SpendReservation } | { allowed: false; reason: "cap" | "unavailable" };

/**
 * Reserves a live request's worst case against the lifetime cap before any paid call: by default
 * one full run plus evidence providers. A bring-your-own decide step passes only the Nebius budget
 * its extraction left, and no providers, since the extraction already reserved and settled those.
 * Without a reachable durable store nothing can be proven about earlier spend, so live mode stays closed.
 */
export async function reserveLiveSpend({ fetcher = fetch, env = process.env, nebiusUsd, providers = true }: { fetcher?: typeof fetch; env?: Env; nebiusUsd?: number; providers?: boolean } = {}): Promise<SpendDecision> {
  const settings = spendCapSettings(env);
  const config = limitStoreConfig(env);
  if (!config) return { allowed: false, reason: "unavailable" };
  const providersMicro = providers ? Math.ceil(settings.providersUsd * MICRO) : 0;
  const micro = Math.ceil((nebiusUsd ?? runBudgetUsd(env)) * MICRO) + providersMicro;
  const capMicro = Math.floor(settings.capUsd * MICRO);
  if (micro > capMicro) return { allowed: false, reason: "cap" };
  let total: number;
  try { total = await command(config, ["INCRBY", settings.key, String(micro)], fetcher); } catch { return { allowed: false, reason: "unavailable" }; }
  if (total > capMicro) {
    try { await command(config, ["DECRBY", settings.key, String(micro)], fetcher); } catch { /* an unreleased reservation only lowers the remaining cap */ }
    return { allowed: false, reason: "cap" };
  }
  return { allowed: true, reservation: { key: settings.key, micro, providersMicro, config } };
}

/**
 * Replaces the reservation with the run's estimated Nebius cost. `null` (unknown) keeps the full
 * reservation. A failed write also keeps it, which can only overstate spend.
 */
export async function settleLiveSpend(reservation: SpendReservation, nebiusCostUsd: number | null, fetcher: typeof fetch = fetch) {
  if (nebiusCostUsd === null) return;
  const delta = Math.ceil(nebiusCostUsd * MICRO) + reservation.providersMicro - reservation.micro;
  if (delta === 0) return;
  try { await command(reservation.config, ["INCRBY", reservation.key, String(delta)], fetcher); } catch { /* see above */ }
}

export async function liveSpendStatus({ fetcher = fetch, env = process.env }: { fetcher?: typeof fetch; env?: Env } = {}) {
  const settings = spendCapSettings(env);
  const config = limitStoreConfig(env);
  let spentMicro: number | null = null;
  if (config) try { spentMicro = await command(config, ["GET", settings.key], fetcher); } catch { spentMicro = null; }
  const capMicro = Math.floor(settings.capUsd * MICRO);
  const remainingMicro = spentMicro === null ? null : Math.max(0, capMicro - spentMicro);
  return {
    capUsd: settings.capUsd,
    spentUsd: spentMicro === null ? null : spentMicro / MICRO,
    remainingUsd: remainingMicro === null ? null : remainingMicro / MICRO,
    runReserveUsd: settings.runReserveUsd,
    ledger: settings.ledger,
    durable: spentMicro !== null,
    available: remainingMicro !== null && remainingMicro >= Math.ceil(settings.runReserveUsd * MICRO),
  };
}
