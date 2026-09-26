import { sentryConfig, type SentryEnv } from "./runtime";

/**
 * Synthetic runtime errors for the free `promise-ledger-demo` Sentry project, shared by the local
 * CLI (`scripts/seed-sentry.ts`) and the daily Vercel Cron route. Web APIs only, so it runs in
 * Node and the Worker build alike.
 *
 * Idempotent: each scenario has a fixed fingerprint (one issue each), event IDs are deterministic
 * per 6-hour window, and a scenario is skipped while its issue was seen within `freshHours`. Any
 * failed read aborts before sending. A run never exceeds MAX_EVENTS_PER_RUN.
 */

export type SeedScenario = {
  key: string;
  customer: string;
  feature: string;
  plan: string;
  type: string;
  value: string;
  level: "error" | "warning";
  transaction: string;
  frames: { module: string; function: string; lineno: number }[];
  users: string[];
  events: number;
  /** Why the scenario exists; reported in run summaries, never sent. */
  purpose: string;
};

export const SEED_TAG = "promise-ledger";
export const DEMO_PROJECT_SLUG = "promise-ledger-demo";
export const RELEASE = "acme-app@2.14.0";
export const ENVIRONMENT = "demo";
export const WINDOW_MS = 6 * 60 * 60 * 1000;
export const MAX_EVENTS_PER_RUN = 60;
const REQUEST_TIMEOUT_MS = 10_000;
const SEND_CONCURRENCY = 4;

export const SCENARIOS: readonly SeedScenario[] = [
  {
    key: "northstar-audit-export",
    customer: "northstar", feature: "audit-export", plan: "enterprise",
    type: "AuditExportError", value: "export job failed: audit event stream cursor expired after 900s for workspace northstar",
    level: "error", transaction: "audit-export.run",
    frames: [{ module: "worker/queue", function: "runJob", lineno: 88 }, { module: "audit-export/job", function: "runExport", lineno: 142 }, { module: "audit-export/stream", function: "streamAuditEvents", lineno: 57 }],
    users: ["northstar-admin-01", "northstar-auditor-02", "northstar-secops-03"], events: 14,
    purpose: "Headline: audit export is enabled for Northstar but failing at runtime.",
  },
  {
    key: "globex-audit-export",
    customer: "globex", feature: "audit-export", plan: "business",
    type: "AuditExportError", value: "export job failed: object storage upload timed out after 30000ms for workspace globex",
    level: "error", transaction: "audit-export.run",
    frames: [{ module: "worker/queue", function: "runJob", lineno: 88 }, { module: "audit-export/job", function: "runExport", lineno: 142 }, { module: "audit-export/upload", function: "putArchive", lineno: 31 }],
    users: ["globex-admin-01", "globex-analyst-02"], events: 8,
    purpose: "Decoy: same feature, other customer. Must not affect Northstar.",
  },
  {
    key: "initech-saml",
    customer: "initech", feature: "saml", plan: "enterprise",
    type: "SamlAssertionError", value: "SAML assertion rejected: audience mismatch for workspace initech",
    level: "error", transaction: "sso.saml.acs",
    frames: [{ module: "auth/saml/acs", function: "consumeAssertion", lineno: 204 }, { module: "auth/saml/validate", function: "checkAudience", lineno: 66 }],
    users: ["initech-admin-01", "initech-it-02"], events: 6,
    purpose: "Decoy: other customer, feature Northstar already verified.",
  },
  {
    key: "northstar-billing-portal",
    customer: "northstar", feature: "billing-portal", plan: "enterprise",
    type: "InvoiceRenderWarning", value: "invoice PDF rendered without logo: asset fetch returned 404 for workspace northstar",
    level: "warning", transaction: "billing.invoice.render",
    frames: [{ module: "billing/invoice", function: "renderPdf", lineno: 119 }],
    users: ["northstar-finance-01"], events: 4,
    purpose: "Decoy: Northstar, but a feature outside the ledger.",
  },
];

export type Dsn = { publicKey: string; host: string; projectId: string };

export function parseDsn(value: string): Dsn {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("SENTRY_SEED_DSN is not a valid DSN."); }
  const projectId = url.pathname.replace(/^\//, "");
  if (url.protocol !== "https:" || !/^[a-f0-9]{32}$/.test(url.username) || url.password || !/^o\d+\.ingest\.(?:[a-z]{2}\.)?sentry\.io$/.test(url.host) || !/^\d{1,20}$/.test(projectId)) throw new Error("SENTRY_SEED_DSN is not a valid Sentry ingest DSN.");
  return { publicKey: url.username, host: url.host, projectId };
}

export async function eventId(scenario: SeedScenario, index: number, now: number): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${SEED_TAG}:${scenario.key}:${index}:${Math.floor(now / WINDOW_MS)}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Events are spread over the last ~2.5 hours so issue.lastSeen stays close to the run time. */
export async function buildEvent(scenario: SeedScenario, index: number, now: number) {
  return {
    event_id: await eventId(scenario, index, now),
    timestamp: (now - index * 11 * 60 * 1000) / 1000,
    platform: "node",
    level: scenario.level,
    logger: "promise-ledger-seed",
    environment: ENVIRONMENT,
    release: RELEASE,
    server_name: "demo-worker-1",
    transaction: scenario.transaction,
    fingerprint: [SEED_TAG, scenario.key],
    tags: { customer: scenario.customer, feature: scenario.feature, plan: scenario.plan, seed: SEED_TAG, seed_key: scenario.key, synthetic: "true" },
    user: { id: scenario.users[index % scenario.users.length] },
    exception: { values: [{ type: scenario.type, value: scenario.value, mechanism: { type: "generic", handled: true }, stacktrace: { frames: scenario.frames.map((frame) => ({ ...frame, filename: `/app/${frame.module}.js`, abs_path: `/app/${frame.module}.js`, in_app: true })) } }] },
    contexts: { runtime: { name: "node", version: "v22.14.0" } },
    extra: { note: "Synthetic Promise Ledger demo event. No real customer data." },
  };
}
export type SeedEvent = Awaited<ReturnType<typeof buildEvent>>;

export function envelope(event: SeedEvent, sentAt: string): string {
  const header = { event_id: event.event_id, sent_at: sentAt, sdk: { name: "promise-ledger-seed", version: "1.0.0" } };
  const body = JSON.stringify(event);
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: "event", content_type: "application/json", length: new TextEncoder().encode(body).length })}\n${body}\n`;
}

export type SeedConfig = ReturnType<typeof sentryConfig> & { dsn: Dsn };
export type SeedIssue = { id: string; shortId: string; count: string; userCount: number; lastSeen: string; project: { id: string; slug: string } };
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export class SeedError extends Error {}

/** Throws SeedError when any variable is missing or malformed; callers decide whether that is fatal. */
export function seedConfig(env: SentryEnv): SeedConfig {
  const dsn = env.SENTRY_SEED_DSN?.trim();
  if (!dsn) throw new SeedError("SENTRY_SEED_DSN is not set.");
  try {
    return { ...sentryConfig(env), dsn: parseDsn(dsn) };
  } catch (error) {
    throw new SeedError(error instanceof Error ? error.message : "Sentry seed configuration is invalid.");
  }
}

async function api<T>(config: SeedConfig, path: string, fetchImpl: FetchLike): Promise<T> {
  const response = await fetchImpl(`${config.base}/api/0/${path}`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new SeedError(`Sentry API returned ${response.status} for ${path.split("?")[0].replace(/\d{6,}/g, ":id")}.`);
  return response.json() as Promise<T>;
}

export async function seededIssues(config: SeedConfig, fetchImpl: FetchLike = fetch): Promise<Map<string, SeedIssue>> {
  const found = new Map<string, SeedIssue>();
  for (const scenario of SCENARIOS) {
    const query = new URLSearchParams({ project: config.projectId, query: `seed:${SEED_TAG} seed_key:${scenario.key}`, statsPeriod: "30d", sort: "date", limit: "5" });
    const issues = await api<SeedIssue[]>(config, `organizations/${config.org}/issues/?${query}`, fetchImpl);
    const issue = Array.isArray(issues) ? issues.find((candidate) => candidate.project?.id === config.projectId) : undefined;
    if (issue) found.set(scenario.key, issue);
  }
  return found;
}

export type SeedPlan = { projectSlug: string; existing: Map<string, SeedIssue>; due: SeedScenario[]; total: number };

/** Confirms the read token, SENTRY_PROJECT and the DSN all name the demo project, then picks stale scenarios. */
export async function planSeed(config: SeedConfig, options: { now: number; freshHours: number; force?: boolean }, fetchImpl: FetchLike = fetch): Promise<SeedPlan> {
  if (!Number.isFinite(options.freshHours) || options.freshHours < 0 || options.freshHours > 72) throw new SeedError("freshHours must be between 0 and 72.");
  const project = await api<{ id?: string; slug?: string }>(config, `projects/${config.org}/${config.projectId}/`, fetchImpl);
  if (project.id !== config.projectId || project.slug !== DEMO_PROJECT_SLUG || config.dsn.projectId !== config.projectId) throw new SeedError(`SENTRY_PROJECT and SENTRY_SEED_DSN must both name the ${DEMO_PROJECT_SLUG} project. Nothing was sent.`);
  const existing = await seededIssues(config, fetchImpl);
  const windowStart = Math.floor(options.now / WINDOW_MS) * WINDOW_MS;
  const due = SCENARIOS.filter((scenario) => {
    const lastSeen = Date.parse(existing.get(scenario.key)?.lastSeen ?? "");
    if (!Number.isFinite(lastSeen)) return true;
    // Sentry drops repeated event IDs, so resending inside the same window cannot add events.
    if (lastSeen >= windowStart) return false;
    return options.force || options.now - lastSeen > options.freshHours * 60 * 60 * 1000;
  });
  const total = due.reduce((sum, scenario) => sum + scenario.events, 0);
  if (total > MAX_EVENTS_PER_RUN) throw new SeedError(`Refusing to send ${total} events; the per-run cap is ${MAX_EVENTS_PER_RUN}.`);
  return { projectSlug: project.slug, existing, due, total };
}

/** Sends every due event; stops at the first ingest failure (no retries). Returns the number accepted. */
export async function sendSeed(config: SeedConfig, due: readonly SeedScenario[], now: number, fetchImpl: FetchLike = fetch): Promise<number> {
  const sentAt = new Date(now).toISOString();
  const auth = `Sentry sentry_version=7, sentry_key=${config.dsn.publicKey}, sentry_client=promise-ledger-seed/1.0.0`;
  const url = `https://${config.dsn.host}/api/${config.dsn.projectId}/envelope/`;
  const bodies = await Promise.all(due.flatMap((scenario) => Array.from({ length: scenario.events }, async (_, index) => envelope(await buildEvent(scenario, index, now), sentAt))));
  if (bodies.length > MAX_EVENTS_PER_RUN) throw new SeedError(`Refusing to send ${bodies.length} events; the per-run cap is ${MAX_EVENTS_PER_RUN}.`);
  let accepted = 0;
  let failure: SeedError | null = null;
  const queue = [...bodies];
  await Promise.all(Array.from({ length: SEND_CONCURRENCY }, async () => {
    for (let body = queue.shift(); body && !failure; body = queue.shift()) {
      const response = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": auth }, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }).catch(() => null);
      if (response?.ok) accepted += 1;
      else failure ??= new SeedError(response?.status === 429 ? "Sentry ingest returned 429 (quota or rate limit). Stopped without retry." : `Sentry ingest failed (${response?.status ?? "network"}). Stopped without retry.`);
    }
  }));
  if (failure) throw Object.assign(failure, { accepted });
  return accepted;
}
