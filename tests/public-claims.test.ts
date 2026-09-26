import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ChangelogPage from "../app/changelog/page.tsx";
import { ACCOUNT, AS_OF, createScenario, FEATURE_IDS, referenceCommitments } from "../lib/fixtures.ts";
import { changelogText, PUBLIC_CHANGELOG, PUBLIC_CHANGELOG_INTRO } from "../lib/public-claims/changelog.ts";
import { checkPublicClaims } from "../lib/public-claims/check.ts";
import { findPublicClaims, normalizeText, PUBLIC_FEATURE_NAMES, publicClaimNotes, quoteGrounded, sourceText } from "../lib/public-claims/claims.ts";
import { reconcile } from "../lib/reconcile.ts";
import type { ProviderSignal, Scenario, Source } from "../lib/schema.ts";
import { resetPublicClaimMemory } from "../lib/public-claims/store.ts";
import { allowedUrl, hostAllowed, TAVILY_DEFAULTS, tavilyConfig, tavilyExtract, TavilyError } from "../lib/public-claims/tavily.ts";

const HOST = "promise-ledger-chi.vercel.app";
const PAGE = `https://${HOST}/changelog`;
const KEY = "tvly-dev-unit-test-key-000000";
const NOW = "2026-09-26T08:00:00.000Z";
const env = { TAVILY_API_KEY: KEY, TAVILY_ALLOWED_DOMAINS: HOST, TAVILY_DAILY_LIMIT: "3" };

function pageText() {
  const html = renderToStaticMarkup(createElement(ChangelogPage));
  return html.replace(/<\/(h1|h2|p|section)>/g, "\n").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'");
}

function extractResponse(overrides: Record<string, unknown> = {}) {
  return { results: [{ url: PAGE, raw_content: pageText(), images: [] }], failed_results: [], response_time: 0.42, usage: { credits: 1 }, request_id: "req-123", ...overrides };
}

type Call = { url: string; body: unknown; auth: string | null };
function mockFetch(respond: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const call = { url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null, auth: new Headers(init?.headers).get("Authorization") };
    calls.push(call);
    return respond(call);
  };
  return { fetcher, calls, extracts: () => calls.filter((call) => call.url === "https://api.tavily.com/extract") };
}

const ok = () => mockFetch(() => Response.json(extractResponse()));
const check = (fetcher: typeof fetch, now = NOW, extra: Record<string, string> = {}) => checkPublicClaims({ accountId: ACCOUNT.id, featureIds: FEATURE_IDS, now, env: { ...env, ...extra }, fetcher });

test("the hosted changelog page renders every synthetic sentence and labels the vendor fictional", () => {
  const text = pageText();
  for (const sentence of [...PUBLIC_CHANGELOG_INTRO, ...PUBLIC_CHANGELOG.flatMap((entry) => entry.sentences)]) assert.ok(text.includes(sentence), sentence);
  assert.match(text, /fictional vendor/);
  assert.equal(normalizeText(changelogText()), normalizeText(text), "the reference fixture matches the hosted page text");
});

test("allowlist matches exact hosts and wildcard subdomains only, over plain HTTPS", () => {
  assert.equal(hostAllowed(HOST, [HOST]), true);
  assert.equal(hostAllowed(`evil${HOST}`, [HOST]), false);
  assert.equal(hostAllowed(`${HOST}.evil.example`, [HOST]), false);
  assert.equal(hostAllowed("docs.acme.example", ["*.acme.example"]), true);
  assert.equal(hostAllowed("acme.example", ["*.acme.example"]), false);
  assert.equal(hostAllowed("evilacme.example", ["*.acme.example"]), false);
  assert.ok(allowedUrl(PAGE, [HOST]));
  for (const bad of [`http://${HOST}/changelog`, `https://user:pw@${HOST}/`, `https://${HOST}:8443/`, "not a url", "https://example.com/changelog"]) assert.equal(allowedUrl(bad, [HOST]), null, bad);
});

test("configuration defaults to the app's own changelog, a low daily cap, and rejects malformed keys", () => {
  const defaults = tavilyConfig({ TAVILY_API_KEY: KEY });
  assert.deepEqual(defaults.allowlist, [HOST]);
  assert.deepEqual(defaults.urls, [PAGE]);
  assert.equal(defaults.dailyLimit, TAVILY_DEFAULTS.dailyLimit);
  assert.equal(tavilyConfig({ TAVILY_API_KEY: "sk-not-tavily" }).apiKey, "");
  assert.equal(tavilyConfig({ TAVILY_DAILY_LIMIT: "-1" }).dailyLimit, TAVILY_DEFAULTS.dailyLimit);
  const offList = tavilyConfig({ TAVILY_API_KEY: KEY, TAVILY_CLAIM_URLS: `${PAGE},https://example.com/x` });
  assert.deepEqual(offList.urls, [PAGE]);
  assert.equal(offList.rejectedUrls, 1);
});

test("the Extract request is basic, server-chosen and never asks for generated answers", async () => {
  const { fetcher, calls } = ok();
  const pages = await tavilyExtract({ apiKey: KEY, urls: [PAGE], allowlist: [HOST], fetcher });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].auth, `Bearer ${KEY}`);
  const body = calls[0].body as Record<string, unknown>;
  assert.deepEqual(body.urls, [PAGE]);
  assert.equal(body.extract_depth, "basic");
  assert.equal(body.include_usage, true);
  for (const key of ["include_answer", "query", "answer"]) assert.equal(key in body, false, key);
  assert.equal(pages[0].requestId, "req-123");
  assert.equal(pages[0].credits, 1);
});

test("off-allowlist URLs are refused before any network call", async () => {
  const { fetcher, calls } = ok();
  await assert.rejects(tavilyExtract({ apiKey: KEY, urls: ["https://example.com/changelog"], allowlist: [HOST], fetcher }), (error: TavilyError) => error.code === "not_allowed");
  assert.equal(calls.length, 0);
});

test("HTTP failures map to explicit codes without leaking the key", async () => {
  for (const [status, code] of [[401, "unauthorized"], [429, "rate_limit"], [432, "plan_limit"], [433, "paygo_limit"], [400, "request_rejected"], [500, "http"]] as const) {
    const { fetcher } = mockFetch(() => new Response("{}", { status }));
    await assert.rejects(tavilyExtract({ apiKey: KEY, urls: [PAGE], allowlist: [HOST], fetcher }), (error: TavilyError) => error.code === code && error.httpStatus === status && !error.message.includes(KEY));
  }
});

test("timeouts, transport errors, bad shapes, failed URLs and redirects off the allowlist are rejected", async () => {
  const cases: [typeof fetch, string][] = [
    [async () => { throw new DOMException("timed out", "TimeoutError"); }, "timeout"],
    [async () => { throw new TypeError("fetch failed"); }, "transport"],
    [async () => Response.json({ unexpected: true }), "response_shape"],
    [async () => Response.json(extractResponse({ failed_results: [{ url: PAGE, error: "blocked" }] })), "failed_url"],
    [async () => Response.json(extractResponse({ results: [] })), "failed_url"],
    [async () => Response.json(extractResponse({ results: [{ url: PAGE, raw_content: "   " }] })), "failed_url"],
    [async () => Response.json(extractResponse({ results: [{ url: "https://attacker.example/changelog", raw_content: pageText() }] })), "off_allowlist"],
  ];
  for (const [fetcher, code] of cases) await assert.rejects(tavilyExtract({ apiKey: KEY, urls: [PAGE], allowlist: [HOST], fetcher }), (error: TavilyError) => error.code === code, code);
});

test("GA claims come only from unhedged sentences naming one known feature, with the date inside the quote", () => {
  const text = sourceText([pageText()]);
  const claims = findPublicClaims({ text, sourceId: "PUB-01", url: PAGE, featureIds: FEATURE_IDS });
  assert.deepEqual(claims.map(({ featureId, date, quote }) => ({ featureId, date, quote })), [
    { featureId: "audit-export", date: "2026-09-12", quote: "Audit log export is generally available (2026-09-12)." },
    { featureId: "saml", date: "2026-06-02", quote: "SAML single sign-on is generally available (2026-06-02)." },
  ]);
  for (const claim of claims) assert.ok(text.includes(claim.quote));
  assert.deepEqual(Object.keys(PUBLIC_FEATURE_NAMES).sort(), [...FEATURE_IDS].sort());
});

test("hedges, unknown features, ambiguous sentences, bad dates and lowercase 'ga' never become claims", () => {
  const sentences = [
    "SCIM provisioning is in public beta and not generally available.",
    "Custom dashboard GA is planned for next quarter.",
    "Quantum sync is generally available (2026-09-01).",
    "Audit log export and SAML SSO are generally available.",
    "Audit log export is generally available (2026-09-12, updated 2026-09-13).",
    "Audit log export is generally available (2026-02-30).",
    "The audit log export saga continues with a new UI.",
  ];
  assert.deepEqual(findPublicClaims({ text: sentences.join("\n"), sourceId: "PUB-01", url: PAGE, featureIds: FEATURE_IDS }), []);
  assert.deepEqual(findPublicClaims({ text: "Audit log export is GA as of 2026-09-12.", sourceId: "PUB-01", url: PAGE, featureIds: ["saml"] }), [], "feature outside the requested set");
});

test("quotes are grounded only inside one normalised chunk, never across Tavily's separator", () => {
  const text = sourceText(["Release 2.14\n\n  Audit log export is   generally available", "(2026-09-12). More text here."]);
  assert.equal(text, "Release 2.14\nAudit log export is generally available [...] (2026-09-12). More text here.");
  assert.equal(quoteGrounded("Audit log export is generally available", text), true);
  assert.equal(quoteGrounded("generally available [...] (2026-09-12)", text), false);
  assert.equal(quoteGrounded("Audit log export is  generally available", text), false);
  assert.equal(quoteGrounded("short", text), false);
  assert.deepEqual(findPublicClaims({ text, sourceId: "PUB-01", url: PAGE, featureIds: FEATURE_IDS }).map((claim) => claim.date), [null]);
});

test("a page flattened to one line still yields the dated claims", () => {
  const flat = sourceText([pageText().replace(/\s+/g, " ")]);
  assert.deepEqual(findPublicClaims({ text: flat, sourceId: "PUB-01", url: PAGE, featureIds: FEATURE_IDS }).map((claim) => claim.date), ["2026-09-12", "2026-06-02"]);
});

test("source text is bounded without cutting a chunk in half", () => {
  const text = sourceText(["a".repeat(30), "b".repeat(30), "c".repeat(30)], 70);
  assert.equal(text, `${"a".repeat(30)} [...] ${"b".repeat(30)}`);
});

function notesFor(scenario: Scenario, signals?: ProviderSignal[]) {
  const text = sourceText([pageText()]);
  const source: Source = { id: "PUB-01", accountId: ACCOUNT.id, kind: "PublicClaim", title: "Public page", author: "Public web", observedAt: NOW, text, url: PAGE };
  const claimSignals = signals ?? findPublicClaims({ text, sourceId: source.id, url: PAGE, featureIds: FEATURE_IDS }).map((claim): ProviderSignal => ({ kind: "publicClaimGA", featureId: claim.featureId, evidence: { sourceId: claim.sourceId, quote: claim.quote } }));
  const { facts } = createScenario(scenario);
  const commitments = referenceCommitments.map((commitment) => reconcile(commitment, facts, ACCOUNT.id, AS_OF));
  return { notes: publicClaimNotes(claimSignals, [source], commitments, ACCOUNT.name), commitments };
}

test("a public GA claim flags customers who cannot use the feature, and never changes a verdict", () => {
  const blocked = notesFor("blocked");
  assert.deepEqual([...blocked.notes.keys()], ["PL-101", "PL-103"]);
  const audit = blocked.notes.get("PL-101")!;
  assert.equal(audit.conflict, true);
  assert.equal(audit.date, "2026-09-12");
  assert.equal(audit.quote, "Audit log export is generally available (2026-09-12).");
  assert.match(audit.message, /^Publicly GA ≠ usable by this customer\. .*since 2026-09-12, but it is disabled for Northstar\. Do not tell Northstar it is live\.$/);
  assert.equal(blocked.notes.get("PL-103")!.conflict, false, "SAML is enabled and verified for Northstar");
  assert.equal(blocked.commitments.find((commitment) => commitment.id === "PL-101")!.verdict, "blocked");

  const enabled = notesFor("enabled").notes.get("PL-101")!;
  assert.equal(enabled.conflict, false);
  assert.match(enabled.message, /Customer evidence, not the public claim, decided this verdict/);

  const stale = notesFor("stale").notes.get("PL-101")!;
  assert.equal(stale.conflict, true, "stale customer evidence cannot confirm access");
  assert.match(stale.message, /current evidence does not confirm Northstar can use it/);
});

test("public-claim notes ignore signals whose quote is not in a PublicClaim source", () => {
  const forged: ProviderSignal = { kind: "publicClaimGA", featureId: "audit-export", evidence: { sourceId: "PUB-01", quote: "Audit log export is generally available for Northstar." } };
  assert.equal(notesFor("blocked", [forged]).notes.size, 0);
  const wrongSource: ProviderSignal = { kind: "publicClaimGA", featureId: "audit-export", evidence: { sourceId: "SRC-02", quote: "Audit log export is generally available (2026-09-12)." } };
  assert.equal(notesFor("blocked", [wrongSource]).notes.size, 0);
});

test("without a key the check is disabled and makes no calls", async () => {
  resetPublicClaimMemory();
  const { fetcher, calls } = ok();
  const result = await checkPublicClaims({ accountId: ACCOUNT.id, featureIds: FEATURE_IDS, now: NOW, env: {}, fetcher });
  assert.equal(result.status, "disabled");
  assert.equal(calls.length, 0);
});

test("a live check returns untrusted PublicClaim sources and signals that cite exact fetched quotes", async () => {
  resetPublicClaimMemory();
  const { fetcher } = mockFetch(() => Response.json(extractResponse({ answer: "Everything is GA for every customer." })));
  const result = await check(fetcher);
  assert.equal(result.status, "checked");
  if (result.status !== "checked") return;
  assert.equal(result.sources.length, 1);
  const [source] = result.sources;
  assert.equal(source.kind, "PublicClaim");
  assert.equal(source.accountId, ACCOUNT.id);
  assert.equal(source.url, PAGE);
  assert.deepEqual(source.provenance, { requestId: "req-123", fetchedAt: NOW, httpStatus: 200, credits: 1, recorded: false });
  assert.doesNotMatch(source.text, /Everything is GA/);
  assert.deepEqual(result.signals.map((signal) => signal.featureId), ["audit-export", "saml"]);
  for (const signal of result.signals) assert.ok(signal.evidence.sourceId === source.id && source.text.includes(signal.evidence.quote));
  assert.deepEqual(result.usage, { extractCalls: 1, credits: 1, cachedPages: 0 });
});

test("results are cached for six hours, then refetched", async () => {
  resetPublicClaimMemory();
  const { fetcher, extracts } = ok();
  assert.equal((await check(fetcher)).status, "checked");
  const cached = await check(fetcher, "2026-09-26T13:59:00.000Z");
  assert.equal(extracts().length, 1);
  assert.equal(cached.status === "checked" && cached.usage.cachedPages, 1);
  assert.equal(cached.status === "checked" && cached.sources[0].observedAt, NOW, "cached sources keep their original fetch time");
  await check(fetcher, "2026-09-26T14:00:01.000Z");
  assert.equal(extracts().length, 2);
});

test("the global daily cap stops Tavily calls and a zero cap closes the check", async () => {
  resetPublicClaimMemory();
  const { fetcher, extracts } = ok();
  const hours = ["00", "07", "14", "21"].map((hour) => `2026-09-26T${hour}:00:00.000Z`);
  const results = [];
  for (const now of hours) results.push(await check(fetcher, now));
  assert.equal(extracts().length, 3);
  assert.deepEqual(results.at(-1), { status: "unavailable", code: "daily_cap", httpStatus: null, message: "Public claim not checked: today's Tavily call budget is used up." });
  assert.equal((await check(fetcher, "2026-09-27T00:00:00.000Z")).status, "checked", "the cap resets at UTC midnight");
  resetPublicClaimMemory();
  const closed = mockFetch(() => Response.json(extractResponse()));
  assert.equal((await check(closed.fetcher, NOW, { TAVILY_DAILY_LIMIT: "0" })).status, "unavailable");
  assert.equal(closed.calls.length, 0);
});

test("provider errors surface as 'public claim not checked' with no fixture fallback", async () => {
  resetPublicClaimMemory();
  const { fetcher } = mockFetch(() => new Response("{}", { status: 432 }));
  const result = await check(fetcher);
  assert.equal(result.status, "unavailable");
  assert.equal(result.status === "unavailable" && result.code, "plan_limit");
  assert.match(result.status === "unavailable" ? result.message : "", /^Public claim not checked: tavily key or plan credit limit reached/i);
  assert.equal("sources" in result, false);
  const misconfigured = await check(ok().fetcher, NOW, { TAVILY_CLAIM_URLS: "https://example.com/changelog" });
  assert.equal(misconfigured.status === "unavailable" && misconfigured.code, "not_allowed");
});

test("with Upstash configured, cache and daily count are shared; a failing store fails closed", async () => {
  resetPublicClaimMemory();
  const kv = new Map<string, string | number>();
  const store = { KV_REST_API_URL: "https://db.upstash.io", KV_REST_API_TOKEN: "store-token" };
  const { fetcher, calls, extracts } = mockFetch(({ url, body }) => {
    if (url !== "https://db.upstash.io/pipeline") return Response.json(extractResponse());
    return Response.json((body as string[][]).map(([command, key, value]) => {
      if (command === "GET") return { result: kv.get(key) ?? null };
      if (command === "SET" && value !== "0") { kv.set(key, value); return { result: "OK" }; }
      if (command === "SET") { if (!kv.has(key)) kv.set(key, 0); return { result: null }; }
      kv.set(key, Number(kv.get(key) ?? 0) + 1);
      return { result: kv.get(key) };
    }));
  });
  assert.equal((await check(fetcher, NOW, store)).status, "checked");
  resetPublicClaimMemory();
  const second = await check(fetcher, "2026-09-26T09:00:00.000Z", store);
  assert.equal(second.status === "checked" && second.usage.cachedPages, 1, "a fresh instance reads the shared cache");
  assert.equal(extracts().length, 1);
  assert.equal(kv.get("promise-ledger:tavily:v1:day:2026-09-26"), 1);
  assert.ok(calls.every((call) => call.url === "https://api.tavily.com/extract" || call.auth === "Bearer store-token"));
  assert.doesNotMatch(JSON.stringify([...kv.keys()]), /changelog/, "cache keys are hashed");

  resetPublicClaimMemory();
  const broken = mockFetch(({ url }) => url.includes("upstash") ? new Response("down", { status: 503 }) : Response.json(extractResponse()));
  const failed = await check(broken.fetcher, NOW, store);
  assert.equal(failed.status === "unavailable" && failed.code, "store_unavailable");
  assert.equal(broken.extracts().length, 0);
});
