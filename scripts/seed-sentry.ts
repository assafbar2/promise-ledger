import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { sentryConfig } from "../lib/sentry/runtime.ts";

/**
 * Seeds the free `promise-ledger-demo` Sentry project with synthetic runtime errors for the
 * Promise Ledger demo. Local only: SENTRY_SEED_DSN must never be configured on Vercel.
 *
 * Idempotent: every scenario has a fixed fingerprint (one issue each, forever) and deterministic
 * event IDs per 6-hour window, and a scenario is skipped while its issue was seen within
 * --fresh-hours (default 24). Re-run within 72 hours of any demo, because the provider ignores
 * older issues, and at least every 30 days, because the Developer plan drops older data.
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
  /** Why the scenario exists; printed in the run summary, never sent. */
  purpose: string;
};

export const SEED_TAG = "promise-ledger";
export const DEMO_PROJECT_SLUG = "promise-ledger-demo";
export const RELEASE = "acme-app@2.14.0";
export const ENVIRONMENT = "demo";
export const WINDOW_MS = 6 * 60 * 60 * 1000;
export const MAX_EVENTS_PER_RUN = 60;

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

export type Dsn = { publicKey: string; host: string; projectId: string; protocol: string };

export function parseDsn(value: string): Dsn {
  const url = new URL(value);
  const projectId = url.pathname.replace(/^\//, "");
  if (url.protocol !== "https:" || !url.username || !/^\d+$/.test(projectId)) throw new Error("SENTRY_SEED_DSN is not a valid https DSN.");
  return { publicKey: url.username, host: url.host, projectId, protocol: url.protocol };
}

export function eventId(scenario: SeedScenario, index: number, now: number): string {
  return createHash("sha256").update(`${SEED_TAG}:${scenario.key}:${index}:${Math.floor(now / WINDOW_MS)}`).digest("hex").slice(0, 32);
}

/** Events are spread over the last ~2.5 hours so issue.lastSeen stays close to the run time. */
export function buildEvent(scenario: SeedScenario, index: number, now: number) {
  const timestamp = (now - index * 11 * 60 * 1000) / 1000;
  return {
    event_id: eventId(scenario, index, now),
    timestamp,
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

export function envelope(event: ReturnType<typeof buildEvent>, dsn: Dsn, sentAt: string): string {
  const header = { event_id: event.event_id, sent_at: sentAt, sdk: { name: "promise-ledger-seed", version: "1.0.0" } };
  const body = JSON.stringify(event);
  return `${JSON.stringify(header)}\n${JSON.stringify({ type: "event", content_type: "application/json", length: Buffer.byteLength(body) })}\n${body}\n`;
}

type Env = Record<string, string | undefined>;
type SeedIssue = { id: string; shortId: string; title: string; culprit: string; level: string; count: string; userCount: number; firstSeen: string; lastSeen: string; permalink: string; project: { id: string; slug: string } };

function config(env: Env) {
  const dsn = env.SENTRY_SEED_DSN?.trim();
  if (!dsn) throw new Error("SENTRY_SEED_DSN is missing. Put it in .env.local; never on Vercel.");
  return { ...sentryConfig(env), dsn: parseDsn(dsn) };
}

async function api<T>(cfg: ReturnType<typeof config>, path: string): Promise<T> {
  const response = await fetch(`${cfg.base}/api/0/${path}`, { headers: { Authorization: `Bearer ${cfg.token}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`Sentry API ${response.status} for ${path.split("?")[0]}`);
  return response.json() as Promise<T>;
}

async function seededIssue(cfg: ReturnType<typeof config>, scenario: SeedScenario): Promise<SeedIssue | undefined> {
  const query = new URLSearchParams({ project: cfg.projectId, query: `seed:${SEED_TAG} seed_key:${scenario.key}`, statsPeriod: "30d", sort: "date", limit: "5" });
  const issues = await api<SeedIssue[]>(cfg, `organizations/${cfg.org}/issues/?${query}`);
  return issues.find((issue) => issue.project.id === cfg.projectId);
}

async function seededIssues(cfg: ReturnType<typeof config>): Promise<Map<string, SeedIssue>> {
  const found = new Map<string, SeedIssue>();
  for (const scenario of SCENARIOS) { const issue = await seededIssue(cfg, scenario); if (issue) found.set(scenario.key, issue); }
  return found;
}

async function send(cfg: ReturnType<typeof config>, body: string) {
  const auth = `Sentry sentry_version=7, sentry_key=${cfg.dsn.publicKey}, sentry_client=promise-ledger-seed/1.0.0`;
  const response = await fetch(`${cfg.dsn.protocol}//${cfg.dsn.host}/api/${cfg.dsn.projectId}/envelope/`, { method: "POST", headers: { "Content-Type": "application/x-sentry-envelope", "X-Sentry-Auth": auth }, body, signal: AbortSignal.timeout(10_000) });
  if (response.status === 429) throw new Error("Sentry ingest returned 429 (quota or rate limit). Stopping without retry.");
  if (!response.ok) throw new Error(`Sentry ingest returned ${response.status}.`);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function main(argv: string[], env: Env) {
  const flag = (name: string) => argv.includes(`--${name}`);
  const freshHours = Number(argv.find((argument) => argument.startsWith("--fresh-hours="))?.split("=")[1] ?? 24);
  if (!Number.isFinite(freshHours) || freshHours < 0 || freshHours > 72) throw new Error("--fresh-hours must be between 0 and 72.");
  const cfg = config(env);

  const project = await api<{ id: string; slug: string }>(cfg, `projects/${cfg.org}/${cfg.projectId}/`);
  if (project.id !== cfg.projectId || project.slug !== DEMO_PROJECT_SLUG || cfg.dsn.projectId !== cfg.projectId) throw new Error(`SENTRY_PROJECT and SENTRY_SEED_DSN must both name the ${DEMO_PROJECT_SLUG} project. Nothing was sent.`);

  const now = Date.now();
  const existing = await seededIssues(cfg);
  const due = SCENARIOS.filter((scenario) => {
    const seen = existing.get(scenario.key);
    return flag("force") || !seen || now - Date.parse(seen.lastSeen) > freshHours * 60 * 60 * 1000;
  });
  const total = due.reduce((sum, scenario) => sum + scenario.events, 0);
  if (total > MAX_EVENTS_PER_RUN) throw new Error(`Refusing to send ${total} events; the per-run cap is ${MAX_EVENTS_PER_RUN}.`);
  for (const scenario of SCENARIOS) console.log(`${due.includes(scenario) ? "send" : "skip (fresh)"}  ${scenario.key.padEnd(26)} ${scenario.events} events  ${scenario.purpose}`);

  if (flag("dry-run") || total === 0) {
    console.log(flag("dry-run") ? `Dry run: would send ${total} events to ${project.slug}.` : "All scenarios are fresh. Nothing sent.");
  } else {
    const sentAt = new Date(now).toISOString();
    for (const scenario of due) for (let index = 0; index < scenario.events; index += 1) await send(cfg, envelope(buildEvent(scenario, index, now), cfg.dsn, sentAt));
    console.log(`Sent ${total} synthetic events to ${project.slug}. Waiting for ingestion...`);
  }

  const sentWindow = now - 5 * 60 * 1000;
  let issues = existing;
  for (let attempt = 0; attempt < 12 && total > 0 && !flag("dry-run"); attempt += 1) {
    await sleep(5000);
    issues = await seededIssues(cfg);
    if (due.every((scenario) => Date.parse(issues.get(scenario.key)?.lastSeen ?? "") >= sentWindow)) break;
  }
  console.log("\nSeeded issues readable through the API:");
  for (const [key, issue] of issues) console.log(`  ${issue.shortId.padEnd(24)} ${key.padEnd(26)} count=${issue.count} users=${issue.userCount} lastSeen=${issue.lastSeen}`);
  const oldest = Math.min(...[...issues.values()].map((issue) => Date.parse(issue.lastSeen)));
  if (Number.isFinite(oldest)) console.log(`\nRe-seed before ${new Date(oldest + 72 * 60 * 60 * 1000).toISOString()} (72-hour freshness window; Sentry keeps 30 days).`);
  const missing = flag("dry-run") ? [] : due.filter((scenario) => !(Date.parse(issues.get(scenario.key)?.lastSeen ?? "") >= sentWindow));
  if (missing.length > 0) throw new Error(`Not yet readable: ${missing.map((scenario) => scenario.key).join(", ")}. Re-run with --dry-run in a minute to check.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Seeding failed.");
    process.exitCode = 1;
  });
}
