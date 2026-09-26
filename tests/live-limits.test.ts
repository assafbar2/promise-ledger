import assert from "node:assert/strict";
import test from "node:test";
import { LIVE_LIMIT_DEFAULTS, limitStoreConfig, liveLimitSettings, networkKey, ownerTokenMatches, reserveLiveRun, resetLiveLimitMemory } from "../lib/live-limits.ts";

const NOON = Date.parse("2026-10-20T12:00:00Z");
const memoryEnv = { NEBIUS_API_KEY: "unit-test-key", LIVE_RUNS_PER_IP_PER_HOUR: "2", LIVE_RUNS_PER_DAY: "3", LIVE_TOKEN_RUNS_PER_DAY: "4" };
const neverFetch: typeof fetch = async () => { throw new Error("The memory limiter must not call the network."); };

function from(ip: string) {
  return new Request("https://promise-ledger.example/api/analyze", { method: "POST", headers: { "x-real-ip": ip } });
}

test("limit settings fall back to safe defaults for missing or invalid values", () => {
  assert.deepEqual(liveLimitSettings({}), LIVE_LIMIT_DEFAULTS);
  assert.deepEqual(liveLimitSettings({ LIVE_RUNS_PER_IP_PER_HOUR: "abc", LIVE_RUNS_PER_DAY: "-1", LIVE_TOKEN_RUNS_PER_DAY: "2.5" }), LIVE_LIMIT_DEFAULTS);
  assert.deepEqual(liveLimitSettings({ LIVE_RUNS_PER_IP_PER_HOUR: "0", LIVE_RUNS_PER_DAY: "20", LIVE_TOKEN_RUNS_PER_DAY: "7" }), { perIpPerHour: 0, perDay: 20, tokenPerDay: 7 });
});

test("durable store is used only with an HTTPS URL and token, from Marketplace or Upstash names", () => {
  assert.equal(limitStoreConfig({}), null);
  assert.equal(limitStoreConfig({ KV_REST_API_URL: "http://insecure.example", KV_REST_API_TOKEN: "t" }), null);
  assert.equal(limitStoreConfig({ KV_REST_API_URL: "https://db.upstash.io" }), null);
  assert.deepEqual(limitStoreConfig({ KV_REST_API_URL: "https://db.upstash.io/", KV_REST_API_TOKEN: "t" }), { url: "https://db.upstash.io", token: "t" });
  assert.deepEqual(limitStoreConfig({ UPSTASH_REDIS_REST_URL: "https://other.upstash.io", UPSTASH_REDIS_REST_TOKEN: "u" }), { url: "https://other.upstash.io", token: "u" });
});

test("IPv6 clients in one /64 share a bucket; IPv4 and mapped addresses stay exact", () => {
  assert.equal(networkKey("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(networkKey("2001:0db8:0001:0002:ffff:ffff:ffff:ffff"), "2001:db8:1:2::/64");
  assert.equal(networkKey("::1"), "0:0:0:0::/64");
  assert.equal(networkKey("::ffff:203.0.113.9"), "203.0.113.9");
  assert.equal(networkKey("203.0.113.9"), "203.0.113.9");
  assert.equal(networkKey(""), "unknown");
});

test("owner token comparison requires the exact bearer value and a long token", async () => {
  const token = "owner-token-with-at-least-24-chars";
  assert.equal(await ownerTokenMatches(`Bearer ${token}`, token), true);
  assert.equal(await ownerTokenMatches(`Bearer ${token}x`, token), false);
  assert.equal(await ownerTokenMatches(token, token), false);
  assert.equal(await ownerTokenMatches(null, token), false);
  assert.equal(await ownerTokenMatches("Bearer short", "short"), false);
});

test("memory limiter enforces the per-IP hourly window and resets next hour", async () => {
  resetLiveLimitMemory();
  const run = (ip: string, now = NOON) => reserveLiveRun({ request: from(ip), tier: "public", now, fetcher: neverFetch, env: { ...memoryEnv, LIVE_RUNS_PER_DAY: "100" } });
  assert.deepEqual(await run("198.51.100.1"), { allowed: true, store: "memory" });
  assert.equal((await run("198.51.100.1")).allowed, true);
  const limited = await run("198.51.100.1");
  assert.deepEqual(limited, { allowed: false, reason: "ip", retryAfterSeconds: 3600, store: "memory" });
  assert.equal((await run("198.51.100.2")).allowed, true, "another visitor is unaffected");
  assert.equal((await run("198.51.100.1", NOON + 3600_000)).allowed, true, "the next hour opens a new window");
});

test("memory limiter enforces the shared daily cap and resets at UTC midnight", async () => {
  resetLiveLimitMemory();
  const run = (ip: string, now = NOON) => reserveLiveRun({ request: from(ip), tier: "public", now, fetcher: neverFetch, env: memoryEnv });
  for (const ip of ["192.0.2.1", "192.0.2.2", "192.0.2.3"]) assert.equal((await run(ip)).allowed, true);
  const capped = await run("192.0.2.4");
  assert.equal(capped.allowed, false);
  assert.equal(!capped.allowed && capped.reason, "daily");
  assert.equal(!capped.allowed && capped.retryAfterSeconds, 12 * 3600);
  assert.equal((await run("192.0.2.4", Date.parse("2026-10-21T00:00:01Z"))).allowed, true);
});

test("a visitor blocked by the per-IP limit cannot consume the shared daily cap", async () => {
  resetLiveLimitMemory();
  const run = (ip: string) => reserveLiveRun({ request: from(ip), tier: "public", now: NOON, fetcher: neverFetch, env: memoryEnv });
  for (let attempt = 0; attempt < 20; attempt++) await run("203.0.113.50");
  assert.equal((await run("203.0.113.51")).allowed, true);
});

test("owner-token runs skip per-IP limits and use their own daily cap", async () => {
  resetLiveLimitMemory();
  const run = (tier: "public" | "token") => reserveLiveRun({ request: from("198.51.100.9"), tier, now: NOON, fetcher: neverFetch, env: memoryEnv });
  for (let index = 0; index < 4; index++) assert.equal((await run("token")).allowed, true);
  const capped = await run("token");
  assert.equal(!capped.allowed && capped.reason, "daily");
  assert.equal((await run("public")).allowed, true, "token usage does not consume the public cap");
});

test("a zero public limit closes open live mode without closing the owner token", async () => {
  resetLiveLimitMemory();
  const env = { ...memoryEnv, LIVE_RUNS_PER_DAY: "0" };
  const closed = await reserveLiveRun({ request: from("198.51.100.3"), tier: "public", now: NOON, fetcher: neverFetch, env });
  assert.equal(!closed.allowed && closed.reason, "closed");
  assert.equal((await reserveLiveRun({ request: from("198.51.100.3"), tier: "token", now: NOON, fetcher: neverFetch, env })).allowed, true);
});

test("durable limiter counts with Upstash REST pipelines and hashes client addresses", async () => {
  resetLiveLimitMemory();
  const counts = new Map<string, number>();
  const calls: { url: string; auth: string | null; body: unknown[][] }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    const body = JSON.parse(String(options?.body)) as unknown[][];
    calls.push({ url: String(url), auth: new Headers(options?.headers).get("Authorization"), body });
    const key = String(body[1][1]);
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return Response.json([{ result: counts.get(key) === 1 ? "OK" : null }, { result: counts.get(key) }]);
  };
  const env = { ...memoryEnv, LIVE_RUNS_PER_IP_PER_HOUR: "5", KV_REST_API_URL: "https://db.upstash.io", KV_REST_API_TOKEN: "store-token" };
  const decision = await reserveLiveRun({ request: from("198.51.100.77"), tier: "public", now: NOON, fetcher, env });
  assert.deepEqual(decision, { allowed: true, store: "upstash" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://db.upstash.io/pipeline");
  assert.equal(calls[0].auth, "Bearer store-token");
  assert.equal(calls[0].body[0][0], "SET");
  assert.deepEqual(calls[0].body[0].slice(2), ["0", "EX", "3660", "NX"]);
  assert.equal(calls[0].body[1][0], "INCR");
  assert.match(String(calls[0].body[0][1]), /^promise-ledger:live:v1:ip:[0-9a-f]{24}:\d+$/);
  assert.equal(calls[1].body[0][1], "promise-ledger:live:v1:day:2026-10-20");
  assert.doesNotMatch(JSON.stringify(calls), /198\.51\.100\.77/);
});

test("the durable store's shared count wins over a fresh instance's memory", async () => {
  resetLiveLimitMemory();
  const fetcher: typeof fetch = async (_url, options) => {
    const key = String((JSON.parse(String(options?.body)) as unknown[][])[1][1]);
    return Response.json([{ result: null }, { result: key.includes(":day:") ? 4 : 1 }]);
  };
  const decision = await reserveLiveRun({ request: from("198.51.100.8"), tier: "public", now: NOON, fetcher, env: { ...memoryEnv, KV_REST_API_URL: "https://db.upstash.io", KV_REST_API_TOKEN: "t" } });
  assert.equal(!decision.allowed && decision.reason, "daily");
  assert.equal(decision.store, "upstash");
});

test("a configured but failing store fails closed instead of allowing unlimited runs", async () => {
  const env = { ...memoryEnv, KV_REST_API_URL: "https://db.upstash.io", KV_REST_API_TOKEN: "t" };
  for (const fetcher of [
    (async () => { throw new Error("network down"); }) as typeof fetch,
    (async () => new Response("unauthorized", { status: 401 })) as typeof fetch,
    (async () => Response.json({ error: "ERR max daily request limit exceeded" })) as typeof fetch,
  ]) {
    resetLiveLimitMemory();
    const decision = await reserveLiveRun({ request: from("198.51.100.10"), tier: "public", now: NOON, fetcher, env });
    assert.deepEqual(decision, { allowed: false, reason: "unavailable", retryAfterSeconds: 60, store: "upstash" });
  }
});
