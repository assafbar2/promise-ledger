import { z } from "zod";
import type { ProviderSignal } from "../schema";

/**
 * Read-only Sentry client for runtime-error evidence. It turns Sentry API responses into
 * canonical Runtime sources whose text is assembled only from API field values, so every
 * downstream quote can be checked with `source.text.includes(quote)`. Stack frames, event
 * payloads and user fields are never read into a source.
 *
 * Env names deliberately avoid SENTRY_AUTH_TOKEN and SENTRY_DSN, which Sentry tooling picks up
 * automatically.
 */

export const SENTRY_TIMEOUT_MS = 8000;
export const RUNTIME_FRESH_MS = 72 * 60 * 60 * 1000;
export const RUNTIME_CACHE_MS = 10 * 60 * 1000;
export const MAX_ISSUES_PER_FEATURE = 3;
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const TAG_VALUE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export type SentryConfig = { token: string; org: string; projectId: string; base: string };
export type SentryEnv = Record<string, string | undefined>;

export class SentryError extends Error {
  constructor(message: string, public status: number | null = null) { super(message); }
}

export function sentryConfigured(env: SentryEnv): boolean {
  return Boolean(env.SENTRY_READ_TOKEN?.trim());
}

export function sentryConfig(env: SentryEnv): SentryConfig {
  const read = (name: string, pattern: RegExp) => {
    const value = env[name]?.trim() ?? "";
    if (!pattern.test(value)) throw new SentryError(`Sentry is misconfigured: ${name} is missing or malformed.`);
    return value;
  };
  return {
    token: read("SENTRY_READ_TOKEN", /^[A-Za-z0-9_]{20,200}$/),
    org: read("SENTRY_ORG", /^[a-z0-9][a-z0-9_-]{0,49}$/),
    projectId: read("SENTRY_PROJECT", /^\d{1,20}$/),
    base: read("SENTRY_API_BASE", /^https:\/\/(?:[a-z0-9-]+\.)?sentry\.io$/),
  };
}

const isoInstant = z.string().refine((value) => Number.isFinite(Date.parse(value)), "invalid timestamp");
const countString = z.string().regex(/^\d{1,12}$/);

export const issueSchema = z.object({
  id: z.string().regex(/^\d{1,20}$/),
  shortId: z.string().regex(/^[A-Z0-9-]{1,60}$/),
  title: z.string().min(1).max(1000),
  culprit: z.string().max(1000).nullable(),
  level: z.string().regex(/^[a-z]{1,16}$/),
  status: z.string(),
  permalink: z.string().url().refine((value) => value.startsWith("https://"), "permalink must be https"),
  project: z.object({ id: z.string(), slug: z.string().regex(/^[a-z0-9_-]{1,100}$/) }),
  filtered: z.object({ count: countString, userCount: z.number().int().nonnegative(), firstSeen: isoInstant, lastSeen: isoInstant }).nullable(),
});
export const eventSchema = z.object({
  eventID: z.string().regex(/^[a-f0-9]{32}$/),
  dateCreated: isoInstant,
  tags: z.array(z.object({ key: z.string(), value: z.string() })),
});
export type SentryIssue = z.infer<typeof issueSchema>;
export type SentryEvent = z.infer<typeof eventSchema>;

/** One unresolved issue, scoped by exact tags to one customer and one ledger feature. */
export type RuntimeIssue = {
  accountId: string;
  featureId: string;
  issueId: string;
  shortId: string;
  title: string;
  culprit: string | null;
  level: string;
  status: string;
  count: number;
  userCount: number;
  firstSeen: string;
  lastSeen: string;
  latestEventId: string;
  permalink: string;
  projectSlug: string;
};

export type RuntimeFetch = {
  issues: RuntimeIssue[];
  fetchedAt: string;
  requests: number;
  httpStatus: number;
};

type FetchLike = (input: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<Response>;

function checkTagValue(name: string, value: string) {
  if (!TAG_VALUE.test(value)) throw new SentryError(`${name} "${value.slice(0, 40)}" cannot be used as an exact Sentry tag filter.`);
}

async function getJson(fetchImpl: FetchLike, config: SentryConfig, path: string, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(`${config.base}/api/0/${path}`, { headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json" }, signal });
  } catch {
    throw new SentryError(signal.aborted ? "Sentry request timed out." : "Sentry could not be reached.");
  }
  if (response.status === 401 || response.status === 403) throw new SentryError(`Sentry rejected the read token (${response.status}).`, response.status);
  if (response.status === 429) throw new SentryError("Sentry rate limit reached (429).", 429);
  if (!response.ok) throw new SentryError(`Sentry returned ${response.status}.`, response.status);
  try {
    return await response.json();
  } catch {
    throw new SentryError("Sentry returned a non-JSON response.", response.status);
  }
}

/**
 * Issue search is exact per tag: `customer:<accountId> feature:<featureId>`, one feature per
 * request, so `filtered` counts belong to that customer and feature only. The newest matching
 * event is then read to confirm both tag values verbatim. An issue whose tags do not match, that
 * belongs to another project, or whose last matching event is outside 72 hours is dropped.
 */
export async function fetchRuntimeIssues(
  config: SentryConfig,
  request: { accountId: string; featureIds: readonly string[]; now: string; signal: AbortSignal },
  fetchImpl: FetchLike = fetch,
): Promise<RuntimeFetch> {
  checkTagValue("Account ID", request.accountId);
  for (const featureId of request.featureIds) checkTagValue("Feature ID", featureId);
  const now = Date.parse(request.now);
  if (!Number.isFinite(now)) throw new SentryError("Invalid clock for runtime evidence.");
  let requests = 0;

  const perFeature = await Promise.all(request.featureIds.map(async (featureId) => {
    const query = `is:unresolved customer:${request.accountId} feature:${featureId}`;
    const params = new URLSearchParams({ project: config.projectId, query, statsPeriod: "72h", sort: "date", limit: String(MAX_ISSUES_PER_FEATURE) });
    requests += 1;
    const body = await getJson(fetchImpl, config, `organizations/${config.org}/issues/?${params}`, request.signal);
    const parsed = z.array(issueSchema).max(100).safeParse(body);
    if (!parsed.success) throw new SentryError("Sentry issue list did not match the expected shape.");
    return parsed.data.slice(0, MAX_ISSUES_PER_FEATURE).map((issue) => ({ featureId, issue, query }));
  }));

  const issues: RuntimeIssue[] = [];
  for (const { featureId, issue, query } of perFeature.flat()) {
    if (issue.project.id !== config.projectId || issue.status !== "unresolved" || !issue.filtered) continue;
    const lastSeen = Date.parse(issue.filtered.lastSeen);
    if (lastSeen > now + CLOCK_SKEW_MS || now - lastSeen > RUNTIME_FRESH_MS) continue;
    requests += 1;
    const params = new URLSearchParams({ query: query.replace("is:unresolved ", ""), statsPeriod: "72h", per_page: "1" });
    const body = await getJson(fetchImpl, config, `organizations/${config.org}/issues/${issue.id}/events/?${params}`, request.signal);
    const parsed = z.array(eventSchema).max(10).safeParse(body);
    if (!parsed.success) throw new SentryError("Sentry event list did not match the expected shape.");
    const event = parsed.data[0];
    if (!event) continue;
    const tag = (key: string) => event.tags.filter((candidate) => candidate.key === key).map((candidate) => candidate.value);
    const customers = tag("customer");
    const features = tag("feature");
    if (customers.length !== 1 || customers[0] !== request.accountId || features.length !== 1 || features[0] !== featureId) continue;
    issues.push({
      accountId: request.accountId, featureId, issueId: issue.id, shortId: issue.shortId, title: issue.title, culprit: issue.culprit,
      level: issue.level, status: issue.status, count: Number(issue.filtered.count), userCount: issue.filtered.userCount,
      firstSeen: issue.filtered.firstSeen, lastSeen: issue.filtered.lastSeen, latestEventId: event.eventID, permalink: issue.permalink, projectSlug: issue.project.slug,
    });
  }
  return { issues, fetchedAt: new Date(now).toISOString(), requests, httpStatus: 200 };
}

const quoted = (value: string) => JSON.stringify(value.replace(/\s+/g, " ").trim().slice(0, 300));

/** Canonical source text: `key=value` pairs, each value copied from the Sentry response. */
export function runtimeText(issue: RuntimeIssue): string {
  return [
    `issue=${issue.shortId}`,
    `title=${quoted(issue.title)}`,
    ...(issue.culprit ? [`culprit=${quoted(issue.culprit)}`] : []),
    `level=${issue.level}`,
    `status=${issue.status}`,
    `count=${issue.count}`,
    `userCount=${issue.userCount}`,
    `firstSeen=${issue.firstSeen}`,
    `lastSeen=${issue.lastSeen}`,
    `customer=${issue.accountId}`,
    `feature=${issue.featureId}`,
  ].join("; ");
}

export type RuntimeSource = {
  id: string;
  accountId: string;
  kind: "Runtime";
  title: string;
  author: string;
  observedAt: string;
  text: string;
  url: string;
  provenance: { requestId: string; fetchedAt: string; httpStatus: number; recorded: boolean };
};
export type RuntimeSignal = Extract<ProviderSignal, { kind: "runtimeErrors" }>;

export function runtimeEvidence(result: RuntimeFetch, recorded: boolean): { sources: RuntimeSource[]; signals: RuntimeSignal[] } {
  const sources: RuntimeSource[] = [];
  const signals: RuntimeSignal[] = [];
  for (const issue of result.issues) {
    const text = runtimeText(issue);
    const source: RuntimeSource = {
      id: `RT-${issue.issueId}-${issue.featureId}`.slice(0, 40),
      accountId: issue.accountId,
      kind: "Runtime",
      title: `${issue.shortId} · ${issue.featureId} runtime errors`.slice(0, 140),
      author: `Error monitoring · ${issue.projectSlug}`,
      observedAt: issue.lastSeen,
      text,
      url: issue.permalink,
      provenance: { requestId: issue.latestEventId, fetchedAt: result.fetchedAt, httpStatus: result.httpStatus, recorded },
    };
    sources.push(source);
    signals.push({ kind: "runtimeErrors", featureId: issue.featureId, count: issue.count, users: issue.userCount, lastSeen: issue.lastSeen, evidence: { sourceId: source.id, quote: text } });
  }
  return { sources, signals };
}

export type RuntimeRecording = { capturedAt: string; org: string; projectId: string; base: string; accountId: string; featureIds: string[]; responses: Record<string, unknown> };

/**
 * Replays a recording made by `scripts/sentry-runtime-check.ts --record` through the same parser
 * as live responses, evaluated at its capture time. Reference mode only.
 */
export async function replayRuntimeIssues(recording: RuntimeRecording, request: { accountId: string; featureIds: readonly string[]; signal: AbortSignal }): Promise<RuntimeFetch> {
  const config: SentryConfig = { token: "recorded", org: recording.org, projectId: recording.projectId, base: recording.base };
  const replay: FetchLike = async (input) => {
    const path = input.slice(config.base.length);
    if (!(path in recording.responses)) return new Response("not recorded", { status: 404 });
    return new Response(JSON.stringify(recording.responses[path]), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  return fetchRuntimeIssues(config, { ...request, now: recording.capturedAt }, replay);
}

/** Per-instance cache so repeated demo runs do not poll Sentry; entries carry their real fetch time. */
export function createRuntimeCache(ttlMs = RUNTIME_CACHE_MS) {
  const entries = new Map<string, { at: number; value: RuntimeFetch }>();
  return {
    async get(key: string, now: number, load: () => Promise<RuntimeFetch>): Promise<RuntimeFetch> {
      const hit = entries.get(key);
      if (hit && now - hit.at >= 0 && now - hit.at < ttlMs) return hit.value;
      const value = await load();
      entries.set(key, { at: now, value });
      return value;
    },
    clear: () => entries.clear(),
  };
}
