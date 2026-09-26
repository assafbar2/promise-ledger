import { z } from "zod";
import { PUBLIC_CHANGELOG_PATH } from "./changelog";

type Env = Record<string, string | undefined>;

export const TAVILY_EXTRACT_URL = "https://api.tavily.com/extract";
export const DEFAULT_PUBLIC_HOST = "promise-ledger-chi.vercel.app";
export const TAVILY_DEFAULTS = { dailyLimit: 20, fetchTimeoutMs: 10000, providerTimeoutSeconds: 8, maxUrls: 5 } as const;
// Tavily joins reranked chunks with this separator; quotes must never span it.
export const CHUNK_SEPARATOR = " [...] ";

export type TavilyErrorCode =
  | "configuration" | "not_allowed" | "daily_cap" | "store_unavailable"
  | "unauthorized" | "rate_limit" | "plan_limit" | "paygo_limit" | "request_rejected" | "http"
  | "timeout" | "transport" | "response_shape" | "failed_url" | "off_allowlist";

export class TavilyError extends Error {
  constructor(message: string, public code: TavilyErrorCode, public httpStatus: number | null = null) { super(message); }
}

export type ExtractedPage = { url: string; chunks: string[]; requestId: string | null; credits: number | null; responseTimeSeconds: number | null; httpStatus: number };

function count(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 1000 ? parsed : fallback;
}

function list(value: string | undefined) {
  return (value ?? "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
}

/** Exact host match; a `*.` entry matches subdomains only, never the apex or look-alike suffixes. */
export function hostAllowed(host: string, allowlist: readonly string[]) {
  const value = host.toLowerCase();
  return allowlist.some((entry) => entry.startsWith("*.") ? value.endsWith(entry.slice(1)) : value === entry);
}

export function allowedUrl(value: string, allowlist: readonly string[]): URL | null {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  return hostAllowed(url.hostname, allowlist) ? url : null;
}

export function tavilyConfig(env: Env = process.env) {
  const apiKey = (env.TAVILY_API_KEY ?? "").trim();
  const allowlist = env.TAVILY_ALLOWED_DOMAINS === undefined ? [DEFAULT_PUBLIC_HOST] : list(env.TAVILY_ALLOWED_DOMAINS);
  const configured = env.TAVILY_CLAIM_URLS === undefined ? [`https://${DEFAULT_PUBLIC_HOST}${PUBLIC_CHANGELOG_PATH}`] : list(env.TAVILY_CLAIM_URLS);
  const urls = configured.map((value) => allowedUrl(value, allowlist)?.toString()).filter((value): value is string => Boolean(value));
  return {
    apiKey: /^tvly-[A-Za-z0-9_-]{8,}$/.test(apiKey) ? apiKey : "",
    allowlist,
    urls: [...new Set(urls)].slice(0, TAVILY_DEFAULTS.maxUrls),
    rejectedUrls: configured.length - urls.length,
    dailyLimit: count(env.TAVILY_DAILY_LIMIT, TAVILY_DEFAULTS.dailyLimit),
  };
}

const responseSchema = z.object({
  results: z.array(z.object({ url: z.string(), raw_content: z.string().nullable() })),
  failed_results: z.array(z.object({ url: z.string() }).loose()).optional(),
  response_time: z.number().optional(),
  request_id: z.string().optional(),
  usage: z.object({ credits: z.number().nonnegative() }).loose().optional(),
});

function httpError(status: number) {
  if (status === 401 || status === 403) return new TavilyError("Tavily rejected the server's API key.", "unauthorized", status);
  if (status === 429) return new TavilyError("Tavily rate limit reached. Try again later.", "rate_limit", status);
  if (status === 432) return new TavilyError("Tavily key or plan credit limit reached. No paid usage is enabled, so the check stops here.", "plan_limit", status);
  if (status === 433) return new TavilyError("Tavily pay-as-you-go limit reached.", "paygo_limit", status);
  if (status === 400) return new TavilyError("Tavily rejected the extract request.", "request_rejected", status);
  return new TavilyError(`Tavily returned HTTP ${status}.`, "http", status);
}

/**
 * One basic Extract call for server-chosen, allowlisted URLs. Returns only fetched page text;
 * the request never asks for Tavily's generated answers, and any extra response fields are dropped.
 */
export async function tavilyExtract({ apiKey, urls, allowlist, fetcher = fetch, signal }: { apiKey: string; urls: string[]; allowlist: readonly string[]; fetcher?: typeof fetch; signal?: AbortSignal }): Promise<ExtractedPage[]> {
  if (!apiKey) throw new TavilyError("Tavily is not configured on the server.", "configuration");
  if (urls.length === 0 || urls.length > TAVILY_DEFAULTS.maxUrls || urls.some((url) => !allowedUrl(url, allowlist))) throw new TavilyError("Only allowlisted HTTPS URLs can be checked.", "not_allowed");
  const timeout = AbortSignal.timeout(TAVILY_DEFAULTS.fetchTimeoutMs);
  let response: Response;
  try {
    response = await fetcher(TAVILY_EXTRACT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ urls, extract_depth: "basic", format: "text", timeout: TAVILY_DEFAULTS.providerTimeoutSeconds, include_images: false, include_favicon: false, include_usage: true }),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (error) {
    if (timeout.aborted || (error instanceof Error && error.name === "TimeoutError")) throw new TavilyError("Tavily did not respond in time.", "timeout");
    throw new TavilyError("Tavily could not be reached.", "transport");
  }
  if (!response.ok) throw httpError(response.status);
  let parsed: z.infer<typeof responseSchema>;
  try { parsed = responseSchema.parse(await response.json()); } catch { throw new TavilyError("Tavily returned an unexpected response format.", "response_shape", response.status); }
  if ((parsed.failed_results?.length ?? 0) > 0 || parsed.results.length !== urls.length) throw new TavilyError("Tavily could not extract every requested page.", "failed_url", response.status);
  const credits = parsed.usage?.credits ?? null;
  return parsed.results.map((result, index) => {
    if (!allowedUrl(result.url, allowlist)) throw new TavilyError("Tavily returned a page outside the allowlist.", "off_allowlist", response.status);
    const chunks = (result.raw_content ?? "").split(CHUNK_SEPARATOR).map((chunk) => chunk.trim()).filter(Boolean);
    if (chunks.length === 0) throw new TavilyError("Tavily returned an empty page.", "failed_url", response.status);
    return { url: result.url, chunks, requestId: parsed.request_id ?? null, credits: index === 0 ? credits : 0, responseTimeSeconds: parsed.response_time ?? null, httpStatus: response.status };
  });
}
