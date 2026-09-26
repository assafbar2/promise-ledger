import { limitStoreConfig } from "../live-limits";

type Env = Record<string, string | undefined>;
type StoreConfig = { url: string; token: string };

export const PUBLIC_CLAIM_CACHE_SECONDS = 6 * 3600;
const KEY_PREFIX = "promise-ledger:tavily:v1";
const STORE_TIMEOUT_MS = 2500;
const MAX_MEMORY_ENTRIES = 200;

export type CallDecision = { allowed: true; store: "upstash" | "memory" } | { allowed: false; reason: "closed" | "daily" | "unavailable"; store: "upstash" | "memory" };

const memory = { cache: new Map<string, { value: string; expiresAt: number }>(), days: new Map<string, number>() };

export function resetPublicClaimMemory() {
  memory.cache.clear();
  memory.days.clear();
}

async function pipeline(config: StoreConfig, commands: string[][], fetcher: typeof fetch) {
  const response = await fetcher(`${config.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Store unavailable");
  const body: unknown = await response.json();
  if (!Array.isArray(body) || body.length !== commands.length) throw new Error("Store returned an unexpected response");
  return body.map((item) => (typeof item === "object" && item !== null && "result" in item ? (item as { result: unknown }).result : undefined));
}

async function digest(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function cacheKey(url: string) {
  return `${KEY_PREFIX}:extract:${await digest(url)}`;
}

/** Cache misses and store errors both return null; the daily cap still guards the fallback call. */
export async function readCache(key: string, { now = Date.now(), fetcher = fetch, env = process.env }: { now?: number; fetcher?: typeof fetch; env?: Env } = {}): Promise<string | null> {
  const config = limitStoreConfig(env);
  if (!config) {
    const entry = memory.cache.get(key);
    if (entry && entry.expiresAt > now) return entry.value;
    memory.cache.delete(key);
    return null;
  }
  try {
    const [value] = await pipeline(config, [["GET", key]], fetcher);
    return typeof value === "string" ? value : null;
  } catch { return null; }
}

export async function writeCache(key: string, value: string, { now = Date.now(), fetcher = fetch, env = process.env }: { now?: number; fetcher?: typeof fetch; env?: Env } = {}) {
  const config = limitStoreConfig(env);
  if (!config) {
    if (memory.cache.size >= MAX_MEMORY_ENTRIES) memory.cache.delete(memory.cache.keys().next().value as string);
    memory.cache.set(key, { value, expiresAt: now + PUBLIC_CLAIM_CACHE_SECONDS * 1000 });
    return;
  }
  try { await pipeline(config, [["SET", key, value, "EX", String(PUBLIC_CLAIM_CACHE_SECONDS)]], fetcher); } catch { /* an unwritten cache entry only costs a later call */ }
}

/** Counts one outbound Extract call against the global UTC-day cap. Fails closed when a configured store errors. */
export async function reserveTavilyCall({ limit, now = Date.now(), fetcher = fetch, env = process.env }: { limit: number; now?: number; fetcher?: typeof fetch; env?: Env }): Promise<CallDecision> {
  const config = limitStoreConfig(env);
  const store = config ? "upstash" : "memory";
  if (limit === 0) return { allowed: false, reason: "closed", store };
  const day = new Date(now).toISOString().slice(0, 10);
  const key = `${KEY_PREFIX}:day:${day}`;
  const local = (memory.days.get(key) ?? 0) + 1;
  memory.days.set(key, local);
  if (local > limit) return { allowed: false, reason: "daily", store };
  if (!config) return { allowed: true, store };
  let value: unknown;
  try { [, value] = await pipeline(config, [["SET", key, "0", "EX", "172800", "NX"], ["INCR", key]], fetcher); } catch { return { allowed: false, reason: "unavailable", store }; }
  if (typeof value !== "number" || !Number.isInteger(value)) return { allowed: false, reason: "unavailable", store };
  return value > limit ? { allowed: false, reason: "daily", store } : { allowed: true, store };
}
