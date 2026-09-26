// One real Tavily Extract call through the public-claim check, for manual verification.
// node --env-file-if-exists=.env.local --import tsx scripts/tavily-smoke.ts [--url=https://<allowlisted>/path] [--record=file.json]
import { writeFile } from "node:fs/promises";
import { ACCOUNT, FEATURE_IDS } from "../lib/fixtures";
import { checkPublicClaims } from "../lib/public-claims/check";
import { tavilyConfig } from "../lib/public-claims/tavily";

const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split(/=(.*)/s, 2) as [string, string]));

async function keyUsage(apiKey: string) {
  const response = await fetch("https://api.tavily.com/usage", { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(10000) });
  if (!response.ok) return { httpStatus: response.status };
  const body = await response.json() as { key?: { usage?: number; limit?: number | null }; account?: { current_plan?: string; plan_usage?: number; plan_limit?: number; paygo_usage?: number; paygo_limit?: number | null } };
  return { keyUsage: body.key?.usage, keyLimit: body.key?.limit, plan: body.account?.current_plan, planUsage: body.account?.plan_usage, planLimit: body.account?.plan_limit, paygoUsage: body.account?.paygo_usage, paygoLimit: body.account?.paygo_limit };
}

const env = { ...process.env, KV_REST_API_URL: "", UPSTASH_REDIS_REST_URL: "", ...(args.get("url") ? { TAVILY_CLAIM_URLS: args.get("url") } : {}) };
const { apiKey, urls } = tavilyConfig(env);
if (!apiKey) throw new Error("Set TAVILY_API_KEY in .env.local first.");
console.log(JSON.stringify({ urls, before: await keyUsage(apiKey) }, null, 2));
const result = await checkPublicClaims({ accountId: ACCOUNT.id, featureIds: FEATURE_IDS, env });
if (result.status !== "checked") {
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({
    status: result.status,
    usage: result.usage,
    sources: result.sources.map((source) => ({ id: source.id, url: source.url, provenance: source.provenance, textChars: source.text.length, chunks: source.text.split(" [...] ").length, preview: source.text.slice(0, 400) })),
    claims: result.claims,
  }, null, 2));
  const record = args.get("record");
  if (record) await writeFile(record, `${JSON.stringify({ capturedAt: result.sources[0]?.observedAt, sources: result.sources, claims: result.claims }, null, 2)}\n`);
}
await new Promise((resolve) => setTimeout(resolve, 1500));
console.log(JSON.stringify({ after: await keyUsage(apiKey) }, null, 2));
