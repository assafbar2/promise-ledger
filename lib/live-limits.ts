export type LiveTier = "public" | "token";
export type LimitReason = "ip" | "daily" | "closed" | "unavailable";
export type LimitStore = "upstash" | "memory";
export type LimitDecision =
  | { allowed: true; store: LimitStore }
  | { allowed: false; reason: LimitReason; retryAfterSeconds: number; store: LimitStore };

type Env = Record<string, string | undefined>;
type Check = { key: string; ttlSeconds: number; limit: number; reason: "ip" | "daily"; retryAfterSeconds: number; bounded: boolean };

export const LIVE_LIMIT_DEFAULTS = { perIpPerHour: 5, perDay: 30, tokenPerDay: 40 } as const;
const MAX_TRACKED_CLIENTS = 5000;
const STORE_TIMEOUT_MS = 2500;
const KEY_PREFIX = "promise-ledger:live:v1";

function count(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 10000 ? parsed : fallback;
}

export function liveLimitSettings(env: Env = process.env) {
  return {
    perIpPerHour: count(env.LIVE_RUNS_PER_IP_PER_HOUR, LIVE_LIMIT_DEFAULTS.perIpPerHour),
    perDay: count(env.LIVE_RUNS_PER_DAY, LIVE_LIMIT_DEFAULTS.perDay),
    tokenPerDay: count(env.LIVE_TOKEN_RUNS_PER_DAY, LIVE_LIMIT_DEFAULTS.tokenPerDay),
  };
}

export function limitStoreConfig(env: Env = process.env) {
  const url = (env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL || "").trim().replace(/\/+$/, "");
  const token = (env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN || "").trim();
  return /^https:\/\/[^\s/]+$/.test(url) && token ? { url, token } : null;
}

// Rotating IPv6 addresses inside one /64 is trivial, so they share a bucket.
export function networkKey(address: string) {
  const value = address.trim().toLowerCase().replace(/%.*$/, "");
  if (!value) return "unknown";
  if (!value.includes(":")) return value;
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  const [head, tail] = value.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = value.includes("::") ? [...left, ...Array<string>(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "") || "0").join(":")}::/64`;
}

export function clientAddress(request: Request) {
  return request.headers.get("x-real-ip")?.trim() || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

async function sha256(value: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function clientKey(request: Request, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(`promise-ledger-rate-limit:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(networkKey(clientAddress(request)))));
  return Array.from(digest.slice(0, 12), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function ownerTokenMatches(authorization: string | null, token: string) {
  if (!authorization || token.length < 24) return false;
  const [supplied, expected] = await Promise.all([sha256(authorization), sha256(`Bearer ${token}`)]);
  let difference = 0;
  for (let index = 0; index < expected.length; index++) difference |= supplied[index] ^ expected[index];
  return difference === 0;
}

const memory = { clients: new Map<string, { count: number; expiresAt: number }>(), totals: new Map<string, { count: number; expiresAt: number }>() };

export function resetLiveLimitMemory() {
  memory.clients.clear();
  memory.totals.clear();
  claimed.clear();
}

function memoryIncrement(check: Check, now: number) {
  const map = check.bounded ? memory.clients : memory.totals;
  const entry = map.get(check.key);
  if (entry && entry.expiresAt > now) return ++entry.count;
  map.delete(check.key);
  if (map.size >= MAX_TRACKED_CLIENTS) {
    for (const [key, value] of map) if (value.expiresAt <= now) map.delete(key);
    while (map.size >= MAX_TRACKED_CLIENTS) map.delete(map.keys().next().value as string);
  }
  map.set(check.key, { count: 1, expiresAt: now + check.ttlSeconds * 1000 });
  return 1;
}

async function storeIncrement(config: { url: string; token: string }, check: Check, fetcher: typeof fetch) {
  const response = await fetcher(`${config.url}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify([["SET", check.key, "0", "EX", String(check.ttlSeconds), "NX"], ["INCR", check.key]]),
    signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("Limit store unavailable");
  const body: unknown = await response.json();
  const value = Array.isArray(body) && typeof body[1] === "object" && body[1] !== null && "result" in body[1] ? body[1].result : undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) throw new Error("Limit store returned an unexpected response");
  return value;
}

const claimed = new Map<string, number>();

/**
 * Marks a one-time token as used. Durable (Upstash `SET NX EX`) when the store is configured;
 * otherwise per-instance memory. An unreachable store fails closed.
 */
export async function claimOnce({ id, ttlSeconds, now = Date.now(), fetcher = fetch, env = process.env }: { id: string; ttlSeconds: number; now?: number; fetcher?: typeof fetch; env?: Env }): Promise<"claimed" | "used" | "unavailable"> {
  const key = `${KEY_PREFIX}:once:${id}`;
  for (const [entry, expiresAt] of claimed) if (expiresAt <= now) claimed.delete(entry);
  if (claimed.has(key)) return "used";
  const config = limitStoreConfig(env);
  if (config) {
    try {
      const response = await fetcher(`${config.url}/pipeline`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify([["SET", key, "1", "EX", String(ttlSeconds), "NX"]]),
        signal: AbortSignal.timeout(STORE_TIMEOUT_MS),
      });
      if (!response.ok) return "unavailable";
      const body: unknown = await response.json();
      const result = Array.isArray(body) && typeof body[0] === "object" && body[0] !== null && "result" in body[0] ? body[0].result : undefined;
      if (result !== "OK") return result === null ? "used" : "unavailable";
    } catch { return "unavailable"; }
  }
  if (claimed.size >= MAX_TRACKED_CLIENTS) claimed.delete(claimed.keys().next().value as string);
  claimed.set(key, now + ttlSeconds * 1000);
  return "claimed";
}

export async function reserveLiveRun({ request, tier, now = Date.now(), fetcher = fetch, env = process.env }: { request: Request; tier: LiveTier; now?: number; fetcher?: typeof fetch; env?: Env }): Promise<LimitDecision> {
  const settings = liveLimitSettings(env);
  const config = limitStoreConfig(env);
  const store: LimitStore = config ? "upstash" : "memory";
  const seconds = Math.floor(now / 1000);
  const day = new Date(now).toISOString().slice(0, 10);
  const untilMidnight = 86400 - (seconds % 86400);
  const checks: Check[] = tier === "token"
    ? [{ key: `${KEY_PREFIX}:token:${day}`, ttlSeconds: 172800, limit: settings.tokenPerDay, reason: "daily", retryAfterSeconds: untilMidnight, bounded: false }]
    : [
      { key: `${KEY_PREFIX}:ip:${await clientKey(request, env.NEBIUS_API_KEY ?? "")}:${Math.floor(seconds / 3600)}`, ttlSeconds: 3660, limit: settings.perIpPerHour, reason: "ip", retryAfterSeconds: 3600 - (seconds % 3600), bounded: true },
      { key: `${KEY_PREFIX}:day:${day}`, ttlSeconds: 172800, limit: settings.perDay, reason: "daily", retryAfterSeconds: untilMidnight, bounded: false },
    ];
  for (const check of checks) {
    if (check.limit === 0) return { allowed: false, reason: tier === "public" ? "closed" : "daily", retryAfterSeconds: check.retryAfterSeconds, store };
    if (memoryIncrement(check, now) > check.limit) return { allowed: false, reason: check.reason, retryAfterSeconds: check.retryAfterSeconds, store };
    if (!config) continue;
    let value: number;
    try { value = await storeIncrement(config, check, fetcher); } catch { return { allowed: false, reason: "unavailable", retryAfterSeconds: 60, store }; }
    if (value > check.limit) return { allowed: false, reason: check.reason, retryAfterSeconds: check.retryAfterSeconds, store };
  }
  return { allowed: true, store };
}
