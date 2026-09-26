import { z } from "zod";
import type { Evidence } from "../schema";
import { PUBLIC_VENDOR } from "./changelog";
import { claimEvidence, claimFresh, findPublicClaims, sourceText, type PublicClaim } from "./claims";
import { cacheKey, readCache, reserveTavilyCall, writeCache } from "./store";
import { tavilyConfig, tavilyExtract, TavilyError, type TavilyErrorCode } from "./tavily";

type Env = Record<string, string | undefined>;

export type PublicClaimSource = {
  id: string;
  accountId: string;
  kind: "PublicClaim";
  title: string;
  author: string;
  observedAt: string;
  text: string;
  url: string;
  provenance: { requestId?: string; fetchedAt: string; httpStatus: number; credits?: number; recorded: boolean };
};
export type PublicClaimSignal = { kind: "publicClaimGA"; featureId: string; evidence: Evidence };
export type PublicClaimUsage = { extractCalls: number; credits: number; cachedPages: number };

export type PublicClaimCheck =
  | { status: "checked"; sources: PublicClaimSource[]; claims: PublicClaim[]; signals: PublicClaimSignal[]; usage: PublicClaimUsage }
  | { status: "disabled"; message: string }
  | { status: "unavailable"; code: TavilyErrorCode; httpStatus: number | null; message: string };

const cachedPageSchema = z.object({
  url: z.string(),
  chunks: z.array(z.string()).min(1),
  requestId: z.string().nullable(),
  credits: z.number().nullable(),
  httpStatus: z.number().int(),
  fetchedAt: z.iso.datetime(),
});
type CachedPage = z.infer<typeof cachedPageSchema>;

function unavailable(code: TavilyErrorCode, message: string, httpStatus: number | null = null): PublicClaimCheck {
  return { status: "unavailable", code, httpStatus, message: `Public claim not checked: ${message}` };
}

function parseCached(value: string | null) {
  if (!value) return null;
  try { return cachedPageSchema.parse(JSON.parse(value)); } catch { return null; }
}

/**
 * Fetches the server-configured public pages through Tavily Extract (or the 6-hour cache) and
 * returns exact-quote GA claims as untrusted PublicClaim sources. Live callers never get a fixture:
 * any failure is reported as "public claim not checked".
 */
export async function checkPublicClaims({ accountId, featureIds, now = new Date().toISOString(), env = process.env, fetcher = fetch, signal }: { accountId: string; featureIds: readonly string[]; now?: string; env?: Env; fetcher?: typeof fetch; signal?: AbortSignal }): Promise<PublicClaimCheck> {
  const config = tavilyConfig(env);
  if (!config.apiKey) return { status: "disabled", message: "Public claim not checked: Tavily is not configured on the server." };
  if (config.urls.length === 0 || config.rejectedUrls > 0) return unavailable("not_allowed", "a configured URL is not an allowlisted HTTPS page.");
  const nowMs = Date.parse(now);
  const byUrl = new Map<string, CachedPage>();
  const misses: string[] = [];
  for (const url of config.urls) {
    const cached = parseCached(await readCache(await cacheKey(url), { now: nowMs, fetcher, env }));
    if (cached && claimFresh(cached.fetchedAt, now)) byUrl.set(url, cached);
    else misses.push(url);
  }
  const usage: PublicClaimUsage = { extractCalls: 0, credits: 0, cachedPages: byUrl.size };
  if (misses.length > 0) {
    const decision = await reserveTavilyCall({ limit: config.dailyLimit, now: nowMs, fetcher, env });
    if (!decision.allowed) {
      return decision.reason === "unavailable"
        ? unavailable("store_unavailable", "the usage store is unavailable, so no Tavily call was made.")
        : unavailable("daily_cap", "today's Tavily call budget is used up.");
    }
    let extracted;
    try {
      usage.extractCalls = 1;
      extracted = await tavilyExtract({ apiKey: config.apiKey, urls: misses, allowlist: config.allowlist, fetcher, signal });
    } catch (error) {
      if (error instanceof TavilyError) return unavailable(error.code, error.message.charAt(0).toLowerCase() + error.message.slice(1), error.httpStatus);
      return unavailable("transport", "Tavily could not be reached.");
    }
    for (const [index, page] of extracted.entries()) {
      const requested = misses.includes(page.url) ? page.url : misses[index];
      const fresh: CachedPage = { url: page.url, chunks: page.chunks, requestId: page.requestId, credits: page.credits, httpStatus: page.httpStatus, fetchedAt: now };
      usage.credits += page.credits ?? 0;
      byUrl.set(requested, fresh);
      await writeCache(await cacheKey(requested), JSON.stringify(fresh), { now: nowMs, fetcher, env });
    }
  }
  const pages = config.urls.map((url) => byUrl.get(url)).filter((page): page is CachedPage => Boolean(page));
  return { status: "checked", ...claimEvidenceFromPages(pages, accountId, featureIds, false), usage };
}

function claimEvidenceFromPages(pages: CachedPage[], accountId: string, featureIds: readonly string[], recorded: boolean) {
  const sources = pages.map((page, index): PublicClaimSource => ({
    id: `PUB-${String(index + 1).padStart(2, "0")}`,
    accountId,
    kind: "PublicClaim",
    title: `${PUBLIC_VENDOR} public page · ${new URL(page.url).pathname}`,
    author: recorded ? "Recorded Tavily response · no live call" : "Public web · fetched by Tavily Extract",
    observedAt: page.fetchedAt,
    text: sourceText(page.chunks),
    url: page.url,
    provenance: { ...(page.requestId ? { requestId: page.requestId } : {}), fetchedAt: page.fetchedAt, httpStatus: page.httpStatus, ...(page.credits === null ? {} : { credits: page.credits }), recorded },
  }));
  const claims = sources.flatMap((source) => findPublicClaims({ text: source.text, sourceId: source.id, url: source.url, featureIds }));
  return { sources, claims, signals: claims.map((claim): PublicClaimSignal => ({ kind: "publicClaimGA", featureId: claim.featureId, evidence: claimEvidence(claim) })) };
}

export type PublicClaimRecording = { capturedAt: string; request: { urls: string[] }; response: unknown };

/** Replays a recorded Extract response through the same parser, allowlist and grounding as a live fetch. No network. */
export async function replayPublicClaims(recording: PublicClaimRecording, { accountId, featureIds }: { accountId: string; featureIds: readonly string[] }) {
  const replay: typeof fetch = async () => Response.json(recording.response);
  const extracted = await tavilyExtract({ apiKey: "recorded", urls: recording.request.urls, allowlist: tavilyConfig({}).allowlist, fetcher: replay });
  const pages = extracted.map((page): CachedPage => ({ url: page.url, chunks: page.chunks, requestId: page.requestId, credits: page.credits, httpStatus: page.httpStatus, fetchedAt: recording.capturedAt }));
  return claimEvidenceFromPages(pages, accountId, featureIds, true);
}
