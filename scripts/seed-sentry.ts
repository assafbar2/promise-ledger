import { pathToFileURL } from "node:url";
import { planSeed, SCENARIOS, seedConfig, seededIssues, sendSeed, type SeedIssue } from "../lib/sentry/seed.ts";

/**
 * Local seeding of the `promise-ledger-demo` Sentry project (the daily Vercel Cron at
 * /api/cron/seed-sentry does the same unattended). Reads .env.local.
 *
 *   --dry-run          read only; report what would be sent
 *   --force            ignore freshness (scenarios already seen in the current 6-hour window are still skipped)
 *   --fresh-hours=N    skip scenarios seen within N hours (default 24, max 72)
 */

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function main(argv: string[], env: Record<string, string | undefined>) {
  const flag = (name: string) => argv.includes(`--${name}`);
  const freshHours = Number(argv.find((argument) => argument.startsWith("--fresh-hours="))?.split("=")[1] ?? 24);
  const config = seedConfig(env);
  const now = Date.now();
  const plan = await planSeed(config, { now, freshHours, force: flag("force") });
  for (const scenario of SCENARIOS) console.log(`${plan.due.includes(scenario) ? "send" : "skip (fresh)"}  ${scenario.key.padEnd(26)} ${scenario.events} events  ${scenario.purpose}`);

  if (flag("dry-run") || plan.total === 0) {
    console.log(flag("dry-run") ? `Dry run: would send ${plan.total} events to ${plan.projectSlug}.` : "All scenarios are fresh. Nothing sent.");
  } else {
    const sent = await sendSeed(config, plan.due, now);
    console.log(`Sent ${sent} synthetic events to ${plan.projectSlug}. Waiting for ingestion...`);
  }

  const sentWindow = now - 5 * 60 * 1000;
  const current = (issues: Map<string, SeedIssue>, key: string) => Date.parse(issues.get(key)?.lastSeen ?? "") >= sentWindow;
  let issues = plan.existing;
  for (let attempt = 0; attempt < 12 && plan.total > 0 && !flag("dry-run"); attempt += 1) {
    await sleep(5000);
    issues = await seededIssues(config);
    if (plan.due.every((scenario) => current(issues, scenario.key))) break;
  }
  console.log("\nSeeded issues readable through the API:");
  for (const [key, issue] of issues) console.log(`  ${issue.shortId.padEnd(24)} ${key.padEnd(26)} count=${issue.count} users=${issue.userCount} lastSeen=${issue.lastSeen}`);
  const oldest = Math.min(...[...issues.values()].map((issue) => Date.parse(issue.lastSeen)));
  if (Number.isFinite(oldest)) console.log(`\nRe-seed before ${new Date(oldest + 72 * 60 * 60 * 1000).toISOString()} (72-hour freshness window; Sentry keeps 30 days).`);
  const missing = flag("dry-run") ? [] : plan.due.filter((scenario) => !current(issues, scenario.key));
  if (missing.length > 0) throw new Error(`Not yet readable: ${missing.map((scenario) => scenario.key).join(", ")}. Re-run with --dry-run in a minute to check.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2), process.env).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Seeding failed.");
    process.exitCode = 1;
  });
}
