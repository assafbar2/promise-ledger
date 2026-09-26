import { planSeed, SCENARIOS, seedConfig, SeedError, sendSeed } from "./seed";
import type { SentryEnv } from "./runtime";

/**
 * Daily Vercel Cron re-seed that keeps demo runtime evidence inside the provider's 72-hour
 * window. Vercel sends `Authorization: Bearer $CRON_SECRET`. Without CRON_SECRET the route is
 * disabled; without the seed variables it is a no-op. A run skips anything seen in the last
 * CRON_FRESH_HOURS, so repeated or overlapping invocations send nothing extra.
 */
export const CRON_FRESH_HOURS = 20;
const MIN_SECRET_LENGTH = 16;

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
type Summary = { status: "disabled" | "unauthorized" | "skipped" | "fresh" | "seeded" | "failed"; detail: string; sent?: number; scenarios?: { key: string; action: "send" | "fresh" }[] };

function json(summary: Summary, status: number) {
  return Response.json(summary, { status, headers: { "Cache-Control": "no-store" } });
}

function sameSecret(given: string, expected: string): boolean {
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(expected);
  let difference = a.length ^ b.length;
  for (let index = 0; index < b.length; index += 1) difference |= (a[index] ?? 0) ^ b[index];
  return difference === 0;
}

export async function handleSeedCron(request: Request, env: SentryEnv, fetchImpl: FetchLike = fetch, now = Date.now()): Promise<Response> {
  const secret = env.CRON_SECRET ?? "";
  if (secret.length < MIN_SECRET_LENGTH) return json({ status: "disabled", detail: "CRON_SECRET is not configured." }, 503);
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return json({ status: "unauthorized", detail: "Missing or invalid cron credentials." }, 401);

  let config;
  try {
    config = seedConfig(env);
  } catch (error) {
    return json({ status: "skipped", detail: `Sentry re-seed is not configured: ${error instanceof Error ? error.message : "invalid configuration"}` }, 200);
  }
  try {
    const plan = await planSeed(config, { now, freshHours: CRON_FRESH_HOURS }, fetchImpl);
    const scenarios = SCENARIOS.map((scenario) => ({ key: scenario.key, action: plan.due.includes(scenario) ? "send" as const : "fresh" as const }));
    if (plan.total === 0) return json({ status: "fresh", detail: `All scenarios were seen within ${CRON_FRESH_HOURS} hours. Nothing sent.`, sent: 0, scenarios }, 200);
    const sent = await sendSeed(config, plan.due, now, fetchImpl);
    return json({ status: "seeded", detail: `Sent ${sent} synthetic events to ${plan.projectSlug}.`, sent, scenarios }, 200);
  } catch (error) {
    const sent = typeof (error as { accepted?: unknown }).accepted === "number" ? (error as { accepted: number }).accepted : 0;
    return json({ status: "failed", detail: error instanceof SeedError ? error.message : "Sentry re-seed failed.", sent }, 502);
  }
}
