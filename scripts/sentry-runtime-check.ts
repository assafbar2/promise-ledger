import { writeFile } from "node:fs/promises";
import { z } from "zod";
import { ACCOUNT, FEATURE_IDS } from "../lib/fixtures.ts";
import { eventSchema, fetchRuntimeIssues, issueSchema, runtimeEvidence, SENTRY_TIMEOUT_MS, sentryConfig } from "../lib/sentry/runtime.ts";

/**
 * Prints the runtime evidence the Sentry provider would see right now. With --record, also writes
 * the stripped API responses (only schema fields, no user or stack data) as the reference-mode
 * replay fixture.
 */
const config = sentryConfig(process.env);
const responses: Record<string, unknown> = {};
const recordingFetch = async (input: string, init: { headers: Record<string, string>; signal: AbortSignal }) => {
  const response = await fetch(input, init);
  const path = input.slice(config.base.length);
  const body = await response.clone().json().catch(() => null);
  const schema = path.includes("/events/") ? z.array(eventSchema) : z.array(issueSchema);
  const stripped = schema.safeParse(body);
  if (response.ok && stripped.success) responses[path] = stripped.data.map((item) => "tags" in item ? { ...item, tags: item.tags.filter((tag) => tag.key === "customer" || tag.key === "feature") } : item);
  return response;
};

const now = new Date().toISOString();
const result = await fetchRuntimeIssues(config, { accountId: ACCOUNT.id, featureIds: FEATURE_IDS, now, signal: AbortSignal.timeout(SENTRY_TIMEOUT_MS) }, recordingFetch);
const { sources, signals } = runtimeEvidence(result, false);
console.log(`${result.requests} Sentry API requests at ${result.fetchedAt}; ${sources.length} runtime source(s).`);
for (const source of sources) console.log(`\n${source.id}  ${source.url}\n  ${source.text}`);
for (const signal of signals) console.log(`\nsignal runtimeErrors feature=${signal.featureId} count=${signal.count} users=${signal.users} lastSeen=${signal.lastSeen}`);

if (process.argv.includes("--record")) {
  const path = "lib/sentry/recorded-runtime.json";
  await writeFile(path, `${JSON.stringify({ capturedAt: result.fetchedAt, org: config.org, projectId: config.projectId, base: config.base, accountId: ACCOUNT.id, featureIds: FEATURE_IDS, responses }, null, 2)}\n`);
  console.log(`\nRecorded ${Object.keys(responses).length} stripped responses to ${path}.`);
}
