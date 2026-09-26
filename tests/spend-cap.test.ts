import assert from "node:assert/strict";
import test from "node:test";
import { EVIDENCE_PROVIDER_USD_PER_RUN, liveSpendStatus, reserveLiveSpend, settleLiveSpend, spendCapSettings, SPEND_CAP_DEFAULT_USD } from "../lib/spend-cap.ts";
import { upstashMock } from "./helpers/upstash-mock.ts";

const KEY = "promise-ledger:spend:v1:1";
const neverFetch: typeof fetch = async () => { throw new Error("No store call expected."); };

test("spend cap settings default conservatively and close live mode on invalid values", () => {
  assert.deepEqual(spendCapSettings({}), { capUsd: SPEND_CAP_DEFAULT_USD, ledger: "1", key: KEY, runReserveUsd: 0.05, providersUsd: 0 });
  assert.equal(SPEND_CAP_DEFAULT_USD, 30);
  for (const value of ["abc", "-1", "NaN", "$40"]) assert.equal(spendCapSettings({ LIVE_SPEND_CAP_USD: value }).capUsd, 0, value);
  assert.equal(spendCapSettings({ LIVE_SPEND_CAP_USD: "12.5" }).capUsd, 12.5);
  assert.equal(spendCapSettings({ LIVE_SPEND_LEDGER: "2026-10-18" }).key, "promise-ledger:spend:v1:2026-10-18");
  assert.equal(spendCapSettings({ LIVE_SPEND_LEDGER: "bad key with spaces" }).ledger, "1");
  assert.equal(spendCapSettings({ LIVE_RUN_BUDGET_USD: "0.02" }).runReserveUsd, 0.02);
  assert.deepEqual(EVIDENCE_PROVIDER_USD_PER_RUN, { "tavily-public-claim": 0, "sentry-runtime": 0 }, "free evidence providers keep a $0 hook");
});

test("without a durable store no live run is allowed and nothing is fetched", async () => {
  assert.deepEqual(await reserveLiveSpend({ env: {}, fetcher: neverFetch }), { allowed: false, reason: "unavailable" });
  const status = await liveSpendStatus({ env: {}, fetcher: neverFetch });
  assert.deepEqual(status, { capUsd: 30, spentUsd: null, remainingUsd: null, runReserveUsd: 0.05, ledger: "1", durable: false, available: false });
});

test("each run reserves its worst case, settles to actual cost, and the lifetime cap holds", async () => {
  const store = upstashMock();
  const env = { ...store.env, LIVE_SPEND_CAP_USD: "0.12" };
  const reserve = () => reserveLiveSpend({ env, fetcher: store.fetcher });
  const first = await reserve();
  const second = await reserve();
  assert.ok(first.allowed && second.allowed);
  assert.equal(store.data.get(KEY), 100_000, "two $0.05 reservations are held in microdollars");
  assert.deepEqual(await reserve(), { allowed: false, reason: "cap" }, "a third worst case would exceed $0.12");
  assert.equal(store.data.get(KEY), 100_000, "the rejected reservation is released");
  await settleLiveSpend(first.reservation, 0.0091, store.fetcher);
  assert.equal(store.data.get(KEY), 59_100);
  assert.equal((await reserve()).allowed, true, "settling frees room for another run");
  assert.deepEqual(await liveSpendStatus({ env, fetcher: store.fetcher }), { capUsd: 0.12, spentUsd: 0.1091, remainingUsd: 0.0109, runReserveUsd: 0.05, ledger: "1", durable: true, available: false });
  assert.ok(store.commands.every(([name]) => ["INCRBY", "DECRBY", "GET"].includes(name)));
});

test("unknown usage or a failed settlement keeps the full reservation", async () => {
  const store = upstashMock();
  const decision = await reserveLiveSpend({ env: store.env, fetcher: store.fetcher });
  assert.ok(decision.allowed);
  await settleLiveSpend(decision.reservation, null, store.fetcher);
  assert.equal(store.data.get(KEY), 50_000);
  store.setDown(true);
  await settleLiveSpend(decision.reservation, 0.001, store.fetcher);
  assert.equal(store.data.get(KEY), 50_000);
});

test("a cap below one run's worst case, or zero, closes live mode without a store write", async () => {
  const store = upstashMock();
  for (const cap of ["0", "0.04"]) assert.deepEqual(await reserveLiveSpend({ env: { ...store.env, LIVE_SPEND_CAP_USD: cap }, fetcher: store.fetcher }), { allowed: false, reason: "cap" });
  assert.equal(store.commands.length, 0);
});

test("a configured but failing store fails closed for reservations and status", async () => {
  const env = { KV_REST_API_URL: "https://kv.upstash.test", KV_REST_API_TOKEN: "t" };
  for (const fetcher of [
    (async () => { throw new Error("network down"); }) as typeof fetch,
    (async () => new Response("unauthorized", { status: 401 })) as typeof fetch,
    (async () => Response.json([{ error: "ERR max daily request limit exceeded" }])) as typeof fetch,
    (async () => Response.json([{ result: null }])) as typeof fetch,
  ]) {
    assert.deepEqual(await reserveLiveSpend({ env, fetcher }), { allowed: false, reason: "unavailable" });
  }
  const status = await liveSpendStatus({ env, fetcher: (async () => { throw new Error("down"); }) as typeof fetch });
  assert.equal(status.durable, false);
  assert.equal(status.available, false);
});

test("a new ledger name starts a fresh count; the old one is kept", async () => {
  const store = upstashMock();
  store.data.set(KEY, 29_990_000);
  assert.deepEqual(await reserveLiveSpend({ env: store.env, fetcher: store.fetcher }), { allowed: false, reason: "cap" });
  const fresh = await reserveLiveSpend({ env: { ...store.env, LIVE_SPEND_LEDGER: "2", LIVE_SPEND_CAP_USD: "5" }, fetcher: store.fetcher });
  assert.equal(fresh.allowed, true);
  assert.equal(store.data.get(KEY), 29_990_000);
  assert.equal(store.data.get("promise-ledger:spend:v1:2"), 50_000);
});
