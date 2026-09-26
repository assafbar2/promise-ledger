import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CRON_FRESH_HOURS, handleSeedCron } from "../lib/sentry/seed-cron.ts";
import { buildEvent, envelope, eventId, MAX_EVENTS_PER_RUN, parseDsn, planSeed, SCENARIOS, seedConfig, sendSeed, WINDOW_MS } from "../lib/sentry/seed.ts";

const NOW = Date.parse("2026-09-26T09:00:00.000Z");
const HOUR = 60 * 60 * 1000;
const PUBLIC_KEY = "a".repeat(32);
const SECRET = "s".repeat(32);
const env = { SENTRY_READ_TOKEN: "t".repeat(64), SENTRY_ORG: "demo-org", SENTRY_PROJECT: "42", SENTRY_API_BASE: "https://us.sentry.io", SENTRY_SEED_DSN: `https://${PUBLIC_KEY}@o1.ingest.us.sentry.io/42`, CRON_SECRET: SECRET };
const TOTAL = SCENARIOS.reduce((sum, scenario) => sum + scenario.events, 0);

function sentryMock(options: { lastSeen?: Record<string, string>; project?: { id: string; slug: string }; ingestStatus?: number; apiStatus?: number } = {}) {
  const posts: { url: string; headers: Record<string, string>; body: string }[] = [];
  const reads: URL[] = [];
  const impl = async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (init.method === "POST") {
      posts.push({ url: input, headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response("{}", { status: options.ingestStatus ?? 200 });
    }
    reads.push(url);
    if (options.apiStatus) return new Response("{}", { status: options.apiStatus });
    if (url.pathname === "/api/0/projects/demo-org/42/") return Response.json(options.project ?? { id: "42", slug: "promise-ledger-demo" });
    const key = url.searchParams.get("query")?.match(/seed_key:(\S+)/)?.[1] ?? "";
    const lastSeen = options.lastSeen?.[key];
    return Response.json(lastSeen ? [{ id: "1", shortId: `DEMO-${key}`, count: "1", userCount: 1, lastSeen, project: { id: "42", slug: "promise-ledger-demo" } }] : []);
  };
  return { impl, posts, reads };
}
const cron = (authorization?: string) => new Request("https://promise-ledger-chi.vercel.app/api/cron/seed-sentry", { headers: authorization ? { authorization } : {} });
const read = async (response: Response) => (await response.json()) as { status: string; detail: string; sent?: number; scenarios?: unknown[] };
const allSeen = (at: number) => Object.fromEntries(SCENARIOS.map((scenario) => [scenario.key, new Date(at).toISOString()]));

test("seed scenarios are synthetic, tagged, deterministic per window and inside the free quota", async () => {
  assert.ok(TOTAL <= MAX_EVENTS_PER_RUN);
  assert.equal(new Set(SCENARIOS.map((scenario) => scenario.key)).size, SCENARIOS.length);
  assert.ok(SCENARIOS.some((scenario) => scenario.customer === "northstar" && scenario.feature === "audit-export"));
  assert.ok(SCENARIOS.filter((scenario) => scenario.customer !== "northstar").length >= 2);
  const [headline] = SCENARIOS;
  const first = await buildEvent(headline, 0, NOW);
  assert.deepEqual(first.fingerprint, ["promise-ledger", "northstar-audit-export"]);
  assert.deepEqual({ customer: first.tags.customer, feature: first.tags.feature, seed: first.tags.seed }, { customer: "northstar", feature: "audit-export", seed: "promise-ledger" });
  assert.deepEqual(Object.keys(first.user), ["id"]);
  assert.equal(await eventId(headline, 3, NOW), await eventId(headline, 3, NOW + 60_000));
  assert.notEqual(await eventId(headline, 3, NOW), await eventId(headline, 3, NOW + WINDOW_MS));
  assert.match(await eventId(headline, 0, NOW), /^[a-f0-9]{32}$/);
  assert.ok((await buildEvent(headline, headline.events - 1, NOW)).timestamp * 1000 > NOW - 3 * HOUR);
  const [header, item, body] = envelope(first, new Date(NOW).toISOString()).trimEnd().split("\n");
  assert.equal(JSON.parse(header).event_id, first.event_id);
  assert.equal(JSON.parse(item).length, new TextEncoder().encode(body).length);
});

test("seed DSN must be an https Sentry ingest DSN", () => {
  assert.deepEqual(parseDsn(env.SENTRY_SEED_DSN), { publicKey: PUBLIC_KEY, host: "o1.ingest.us.sentry.io", projectId: "42" });
  for (const bad of [`http://${PUBLIC_KEY}@o1.ingest.us.sentry.io/42`, "https://o1.ingest.us.sentry.io/42", `https://${PUBLIC_KEY}@evil.example/42`, `https://${PUBLIC_KEY}:secret@o1.ingest.us.sentry.io/42`, `https://${PUBLIC_KEY}@o1.ingest.us.sentry.io/demo`, "not a url"]) {
    assert.throws(() => parseDsn(bad), /SENTRY_SEED_DSN/, bad);
  }
});

test("planning refuses any project other than promise-ledger-demo and never sends", async () => {
  for (const [project, dsn] of [[{ id: "42", slug: "other-project" }, env.SENTRY_SEED_DSN], [{ id: "42", slug: "promise-ledger-demo" }, `https://${PUBLIC_KEY}@o1.ingest.us.sentry.io/43`]] as const) {
    const mock = sentryMock({ project });
    await assert.rejects(planSeed(seedConfig({ ...env, SENTRY_SEED_DSN: dsn }), { now: NOW, freshHours: 24 }, mock.impl), /promise-ledger-demo/);
    assert.equal(mock.posts.length, 0);
  }
});

test("only stale or missing scenarios are due; --force resends all", async () => {
  const mock = sentryMock({ lastSeen: { ...allSeen(NOW - HOUR), "initech-saml": new Date(NOW - 30 * HOUR).toISOString() } });
  const plan = await planSeed(seedConfig(env), { now: NOW, freshHours: 24 }, mock.impl);
  assert.deepEqual(plan.due.map((scenario) => scenario.key), ["initech-saml"]);
  assert.equal(plan.total, 6);
  assert.ok(mock.reads.every((url) => !url.searchParams.has("project") || url.searchParams.get("project") === "42"));
  assert.deepEqual((await planSeed(seedConfig(env), { now: NOW, freshHours: 24, force: true }, mock.impl)).due.map((scenario) => scenario.key), ["initech-saml"], "same-window issues are never resent");
  const earlier = sentryMock({ lastSeen: allSeen(NOW - 4 * HOUR) });
  assert.equal((await planSeed(seedConfig(env), { now: NOW, freshHours: 24 }, earlier.impl)).total, 0);
  assert.equal((await planSeed(seedConfig(env), { now: NOW, freshHours: 24, force: true }, earlier.impl)).total, TOTAL);
  await assert.rejects(planSeed(seedConfig(env), { now: NOW, freshHours: 100 }, mock.impl), /freshHours/);
});

test("sending posts authenticated envelopes to the DSN project and stops on the first failure", async () => {
  const ok = sentryMock();
  assert.equal(await sendSeed(seedConfig(env), SCENARIOS, NOW, ok.impl), TOTAL);
  assert.equal(ok.posts.length, TOTAL);
  assert.ok(ok.posts.every((post) => post.url === "https://o1.ingest.us.sentry.io/api/42/envelope/" && post.headers["X-Sentry-Auth"].includes(`sentry_key=${PUBLIC_KEY}`)));
  assert.ok(!ok.posts.some((post) => post.body.includes(env.SENTRY_READ_TOKEN)));
  assert.equal(new Set(ok.posts.map((post) => post.body.split("\n")[0])).size, TOTAL);
  const limited = sentryMock({ ingestStatus: 429 });
  await assert.rejects(sendSeed(seedConfig(env), SCENARIOS, NOW, limited.impl), /429/);
  assert.ok(limited.posts.length <= 4, `sent ${limited.posts.length} after a 429`);
});

test("cron is disabled without CRON_SECRET and rejects bad credentials before any Sentry call", async () => {
  for (const secret of [undefined, "", "short"]) {
    const mock = sentryMock();
    const response = await handleSeedCron(cron(`Bearer ${secret}`), { ...env, CRON_SECRET: secret }, mock.impl, NOW);
    assert.equal(response.status, 503);
    assert.equal((await read(response)).status, "disabled");
    assert.equal(mock.reads.length + mock.posts.length, 0);
  }
  for (const authorization of [undefined, `Bearer ${SECRET.slice(1)}`, `Bearer ${SECRET}x`, SECRET, `bearer ${SECRET}`]) {
    const mock = sentryMock();
    const response = await handleSeedCron(cron(authorization), env, mock.impl, NOW);
    assert.equal(response.status, 401);
    assert.equal(mock.reads.length + mock.posts.length, 0);
  }
});

test("cron is a safe no-op when seed env is missing or malformed", async () => {
  for (const missing of ["SENTRY_SEED_DSN", "SENTRY_READ_TOKEN", "SENTRY_PROJECT", "SENTRY_API_BASE"]) {
    const mock = sentryMock();
    const response = await handleSeedCron(cron(`Bearer ${SECRET}`), { ...env, [missing]: undefined }, mock.impl, NOW);
    const body = await read(response);
    assert.equal(response.status, 200);
    assert.equal(body.status, "skipped");
    assert.ok(!JSON.stringify(body).includes(env.SENTRY_READ_TOKEN) && !JSON.stringify(body).includes(PUBLIC_KEY));
    assert.equal(mock.reads.length + mock.posts.length, 0);
  }
});

test("cron seeds stale scenarios once, then is idempotent while fresh", async () => {
  const stale = sentryMock({ lastSeen: allSeen(NOW - (CRON_FRESH_HOURS + 1) * HOUR) });
  const first = await handleSeedCron(cron(`Bearer ${SECRET}`), env, stale.impl, NOW);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.deepEqual(await read(first), { status: "seeded", detail: `Sent ${TOTAL} synthetic events to promise-ledger-demo.`, sent: TOTAL, scenarios: SCENARIOS.map((scenario) => ({ key: scenario.key, action: "send" })) });
  assert.equal(stale.posts.length, TOTAL);

  const fresh = sentryMock({ lastSeen: allSeen(NOW - 2 * HOUR) });
  const second = await handleSeedCron(cron(`Bearer ${SECRET}`), env, fresh.impl, NOW);
  assert.equal((await read(second)).status, "fresh");
  assert.equal(fresh.posts.length, 0);
});

test("cron fails closed without sending when Sentry reads fail, and reports partial sends", async () => {
  const down = sentryMock({ apiStatus: 401 });
  const response = await handleSeedCron(cron(`Bearer ${SECRET}`), env, down.impl, NOW);
  assert.equal(response.status, 502);
  assert.match((await read(response)).detail, /401/);
  assert.equal(down.posts.length, 0);
  const rejected = await handleSeedCron(cron(`Bearer ${SECRET}`), env, sentryMock({ ingestStatus: 429 }).impl, NOW);
  const body = await read(rejected);
  assert.equal(rejected.status, 502);
  assert.deepEqual([body.status, body.sent], ["failed", 0]);
});

test("vercel.json schedules the cron daily, within the Hobby limit", async () => {
  const config = JSON.parse(await readFile(new URL("../vercel.json", import.meta.url), "utf8"));
  assert.deepEqual(config.crons, [{ path: "/api/cron/seed-sentry", schedule: "17 6 * * *" }]);
});
