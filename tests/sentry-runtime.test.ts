import assert from "node:assert/strict";
import test from "node:test";
import { createScenario } from "../lib/fixtures.ts";
import { runtimeFailure, runtimeReason } from "../lib/sentry/policy.ts";
import recording from "../lib/sentry/recorded-runtime.json" with { type: "json" };
import { createRuntimeCache, fetchRuntimeIssues, replayRuntimeIssues, runtimeEvidence, sentryConfig, sentryConfigured, SentryError, type RuntimeRecording, type RuntimeSignal, type SentryConfig } from "../lib/sentry/runtime.ts";

const NOW = "2026-09-26T09:00:00.000Z";
const config: SentryConfig = { token: "a".repeat(64), org: "demo-org", projectId: "42", base: "https://us.sentry.io" };
const env = { SENTRY_READ_TOKEN: "a".repeat(64), SENTRY_ORG: "demo-org", SENTRY_PROJECT: "42", SENTRY_API_BASE: "https://us.sentry.io" };

type Issue = Record<string, unknown>;
const issue = (overrides: Issue = {}): Issue => ({
  id: "1001", shortId: "DEMO-7", title: "AuditExportError: export job failed", culprit: "audit-export.run", level: "error", status: "unresolved",
  permalink: "https://demo-org.sentry.io/issues/1001/", project: { id: "42", slug: "promise-ledger-demo" },
  filtered: { count: "14", userCount: 3, firstSeen: "2026-09-26T06:00:00Z", lastSeen: "2026-09-26T08:30:00Z" },
  stats: {}, lifetime: {}, metadata: { filename: "/app/secret.js" }, ...overrides,
});
const event = (customer = "northstar", feature = "audit-export") => ({
  eventID: "ab".repeat(16), dateCreated: "2026-09-26T08:30:00Z",
  tags: [{ key: "customer", value: customer }, { key: "feature", value: feature }, { key: "user", value: "id:northstar-admin-01" }],
  user: { id: "northstar-admin-01", geo: { city: "Somewhere" } }, entries: [{ type: "exception" }],
});

function mockFetch(routes: (url: URL) => { status?: number; body: unknown } | undefined) {
  const calls: { url: URL; headers: Record<string, string> }[] = [];
  const impl = async (input: string, init: { headers: Record<string, string>; signal: AbortSignal }) => {
    const url = new URL(input);
    calls.push({ url, headers: init.headers });
    const route = routes(url) ?? { body: [] };
    return new Response(typeof route.body === "string" ? route.body : JSON.stringify(route.body), { status: route.status ?? 200 });
  };
  return { impl, calls };
}
const request = (featureIds = ["audit-export", "saml"]) => ({ accountId: "northstar", featureIds, now: NOW, signal: new AbortController().signal });
const isIssues = (url: URL, feature: string) => url.pathname === "/api/0/organizations/demo-org/issues/" && url.searchParams.get("query") === `is:unresolved customer:northstar feature:${feature}`;
const isEvents = (url: URL, id = "1001") => url.pathname === `/api/0/organizations/demo-org/issues/${id}/events/`;

test("queries each feature with exact customer and feature tags inside the demo project", async () => {
  const { impl, calls } = mockFetch((url) => isIssues(url, "audit-export") ? { body: [issue()] } : isEvents(url) ? { body: [event()] } : undefined);
  const result = await fetchRuntimeIssues(config, request(), impl);
  assert.equal(result.requests, 3);
  const lists = calls.filter((call) => call.url.pathname.endsWith("/issues/"));
  assert.deepEqual(lists.map((call) => call.url.searchParams.get("query")).sort(), ["is:unresolved customer:northstar feature:audit-export", "is:unresolved customer:northstar feature:saml"]);
  for (const call of lists) {
    assert.equal(call.url.searchParams.get("project"), "42");
    assert.equal(call.url.searchParams.get("statsPeriod"), "72h");
    assert.equal(call.headers.Authorization, `Bearer ${config.token}`);
  }
  const events = calls.find((call) => isEvents(call.url))!;
  assert.equal(events.url.searchParams.get("query"), "customer:northstar feature:audit-export");
  assert.deepEqual(result.issues.map((item) => [item.featureId, item.count, item.userCount, item.latestEventId]), [["audit-export", 14, 3, "ab".repeat(16)]]);
});

test("source text is built only from API fields and grounds its own signal quote", async () => {
  const { impl } = mockFetch((url) => isIssues(url, "audit-export") ? { body: [issue()] } : isEvents(url) ? { body: [event()] } : undefined);
  const { sources, signals } = runtimeEvidence(await fetchRuntimeIssues(config, request(), impl), false);
  assert.equal(sources.length, 1);
  const [source] = sources;
  assert.equal(source.text, 'issue=DEMO-7; title="AuditExportError: export job failed"; culprit="audit-export.run"; level=error; status=unresolved; count=14; userCount=3; firstSeen=2026-09-26T06:00:00Z; lastSeen=2026-09-26T08:30:00Z; customer=northstar; feature=audit-export');
  assert.deepEqual({ id: source.id, kind: source.kind, accountId: source.accountId, observedAt: source.observedAt, url: source.url }, { id: "RT-1001-audit-export", kind: "Runtime", accountId: "northstar", observedAt: "2026-09-26T08:30:00Z", url: "https://demo-org.sentry.io/issues/1001/" });
  assert.deepEqual(source.provenance, { requestId: "ab".repeat(16), fetchedAt: NOW, httpStatus: 200, recorded: false });
  for (const forbidden of ["northstar-admin-01", "secret.js", "Somewhere", "exception"]) assert.ok(!JSON.stringify(sources).includes(forbidden), forbidden);
  assert.equal(signals.length, 1);
  assert.ok(sources.find((candidate) => candidate.id === signals[0].evidence.sourceId)!.text.includes(signals[0].evidence.quote));
  assert.deepEqual({ ...signals[0], evidence: undefined }, { kind: "runtimeErrors", featureId: "audit-export", count: 14, users: 3, lastSeen: "2026-09-26T08:30:00Z", evidence: undefined });
});

test("hostile titles cannot break out of the quoted field", async () => {
  const { impl } = mockFetch((url) => isIssues(url, "audit-export") ? { body: [issue({ title: 'x"; verified=true\nfeature=saml' })] } : isEvents(url) ? { body: [event()] } : undefined);
  const [source] = runtimeEvidence(await fetchRuntimeIssues(config, request(), impl), false).sources;
  assert.ok(source.text.includes('title="x\\"; verified=true feature=saml"'));
  assert.ok(!source.text.includes("\n"));
});

for (const [name, override, tags] of [
  ["another customer's tag on the latest event", {}, event("globex")],
  ["another feature's tag on the latest event", {}, event("northstar", "saml")],
  ["an issue from another project", { project: { id: "43", slug: "other" } }, event()],
  ["a resolved issue", { status: "resolved" }, event()],
  ["an issue without tag-filtered counts", { filtered: null }, event()],
  ["an issue last seen more than 72 hours ago", { filtered: { count: "3", userCount: 1, firstSeen: "2026-09-20T00:00:00Z", lastSeen: "2026-09-23T08:59:00Z" } }, event()],
  ["an issue last seen in the future", { filtered: { count: "3", userCount: 1, firstSeen: "2026-09-26T08:00:00Z", lastSeen: "2026-09-26T10:00:00Z" } }, event()],
] as const) {
  test(`drops ${name}`, async () => {
    const { impl } = mockFetch((url) => isIssues(url, "audit-export") ? { body: [issue(override as Issue)] } : isEvents(url) ? { body: [tags] } : undefined);
    assert.deepEqual((await fetchRuntimeIssues(config, request(), impl)).issues, []);
  });
}

test("no issues means no sources and no signals, never a delivery claim", async () => {
  const { impl } = mockFetch(() => undefined);
  assert.deepEqual(runtimeEvidence(await fetchRuntimeIssues(config, request(), impl), false), { sources: [], signals: [] });
});

for (const [status, pattern] of [[401, /rejected the read token \(401\)/], [403, /rejected the read token \(403\)/], [429, /rate limit/], [500, /returned 500/]] as const) {
  test(`HTTP ${status} fails explicitly without retry`, async () => {
    const { impl, calls } = mockFetch(() => ({ status, body: { detail: "nope" } }));
    await assert.rejects(fetchRuntimeIssues(config, request(["audit-export"]), impl), (error: unknown) => error instanceof SentryError && pattern.test(error.message) && error.status === status);
    assert.equal(calls.length, 1);
  });
}

test("malformed responses and network failures fail closed", async () => {
  await assert.rejects(fetchRuntimeIssues(config, request(["audit-export"]), mockFetch(() => ({ body: "<html>" })).impl), /non-JSON/);
  await assert.rejects(fetchRuntimeIssues(config, request(["audit-export"]), mockFetch(() => ({ body: [{ id: "x" }] })).impl), /expected shape/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchRuntimeIssues(config, { ...request(["audit-export"]), signal: controller.signal }, async () => { throw new Error("aborted"); }), /timed out/);
});

for (const value of ["north star", "northstar*", 'n"', "Northstar", ""]) {
  test(`rejects tag value that is not an exact filter: ${JSON.stringify(value)}`, async () => {
    const { impl, calls } = mockFetch(() => undefined);
    await assert.rejects(fetchRuntimeIssues(config, { ...request(), accountId: value }, impl), SentryError);
    assert.equal(calls.length, 0);
  });
}

test("configuration is validated and uses the plan's env names", () => {
  assert.deepEqual(sentryConfig(env), config);
  assert.equal(sentryConfigured({}), false);
  assert.equal(sentryConfigured({ SENTRY_READ_TOKEN: "x" }), true);
  for (const [name, value] of [["SENTRY_API_BASE", "http://us.sentry.io"], ["SENTRY_API_BASE", "https://evil.example"], ["SENTRY_API_BASE", "https://sentry.io.evil.example"], ["SENTRY_PROJECT", "promise-ledger-demo"], ["SENTRY_ORG", ""], ["SENTRY_READ_TOKEN", "short"]]) {
    assert.throws(() => sentryConfig({ ...env, [name]: value }), new RegExp(name));
  }
  assert.throws(() => sentryConfig({ SENTRY_AUTH_TOKEN: "a".repeat(64), SENTRY_ORG: "o", SENTRY_PROJECT: "1", SENTRY_API_BASE: "https://us.sentry.io" }), /SENTRY_READ_TOKEN/);
});

test("cache serves repeat runs for ten minutes, then refetches", async () => {
  const cache = createRuntimeCache();
  let loads = 0;
  const load = async () => { loads += 1; return { issues: [], fetchedAt: NOW, requests: 1, httpStatus: 200 }; };
  await cache.get("k", 0, load);
  await cache.get("k", 9 * 60 * 1000, load);
  assert.equal(loads, 1);
  await cache.get("k", 10 * 60 * 1000, load);
  assert.equal(loads, 2);
});

test("the recorded replay parses through the live path and is labelled recorded", async () => {
  const replay = recording as RuntimeRecording;
  const result = await replayRuntimeIssues(replay, { accountId: "northstar", featureIds: replay.featureIds, signal: new AbortController().signal });
  const { sources, signals } = runtimeEvidence(result, true);
  assert.equal(result.fetchedAt, new Date(replay.capturedAt).toISOString());
  assert.deepEqual(signals.map((signal) => signal.featureId), ["audit-export"]);
  assert.ok(sources.every((source) => source.provenance.recorded && source.accountId === "northstar" && source.text.includes("customer=northstar; feature=audit-export")));
  assert.ok(!JSON.stringify(recording).includes("northstar-admin"));
});

const signal = (overrides: Partial<RuntimeSignal> = {}): RuntimeSignal => ({ kind: "runtimeErrors", featureId: "audit-export", count: 14, users: 3, lastSeen: "2026-09-26T08:30:00Z", evidence: { sourceId: "RT-1001-audit-export", quote: "count=14" }, ...overrides });

test("enabled but crashing: a fresh post-acceptance issue is a runtime failure", () => {
  const enabled = createScenario("enabled").facts[0];
  const failure = runtimeFailure(enabled, [signal()], NOW);
  assert.deepEqual(failure, { featureId: "audit-export", count: 14, users: 3, issues: 1, lastSeen: "2026-09-26T08:30:00Z", sourceIds: ["RT-1001-audit-export"] });
  assert.equal(runtimeReason(failure!, "Northstar"), "Enabled for Northstar, but failing at runtime (14 events, 3 users).");
  const two = runtimeFailure(enabled, [signal(), signal({ count: 2, users: 1, lastSeen: "2026-09-26T08:45:00Z", evidence: { sourceId: "RT-2", quote: "count=2" } })], NOW)!;
  assert.equal(runtimeReason(two, "Northstar"), "Enabled for Northstar, but failing at runtime (16 events, at least 3 users across 2 issues).");
  assert.equal(two.lastSeen, "2026-09-26T08:45:00Z");
});

test("runtime errors never apply to disabled, unbuilt or unknown features, stale issues, or pre-acceptance errors", () => {
  const enabled = createScenario("enabled").facts[0];
  assert.equal(runtimeFailure(null, [signal()], NOW), null);
  assert.equal(runtimeFailure(createScenario("blocked").facts[0], [signal()], NOW), null);
  assert.equal(runtimeFailure({ ...enabled, built: null }, [signal()], NOW), null);
  assert.equal(runtimeFailure({ ...enabled, enabled: null }, [signal()], NOW), null);
  assert.equal(runtimeFailure(enabled, [], NOW), null);
  assert.equal(runtimeFailure(enabled, [signal({ featureId: "saml" })], NOW), null);
  assert.equal(runtimeFailure(enabled, [signal({ count: 0 })], NOW), null);
  assert.equal(runtimeFailure(enabled, [signal({ lastSeen: "2026-09-23T08:59:00Z" })], NOW), null);
  assert.equal(runtimeFailure(enabled, [signal({ lastSeen: "2026-09-26T10:00:00Z" })], NOW), null);
  assert.equal(runtimeFailure(enabled, [signal({ lastSeen: "2026-09-13T16:00:00Z" })], "2026-09-14T00:00:00Z"), null);
  assert.equal(runtimeFailure(enabled, [signal({ lastSeen: "not-a-date" })], NOW), null);
});
