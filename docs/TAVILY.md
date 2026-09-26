# Public-claim check (Tavily)

**Publicly GA ≠ usable by this customer.** The fictional vendor's public changelog says "Audit log export is generally available (2026-09-12).", yet Northstar's entitlement is off. Promise Ledger puts the vendor's public claim next to the customer-specific evidence, flags the conflict, and warns the drafter not to tell Northstar the feature is live. The public claim never changes a verdict.

## How it works

```text
live run, after the access gate and live-run limits
  -> tavily-public-claim provider (untrusted, optional, 10 s deadline)
     -> URLs from TAVILY_CLAIM_URLS, each checked against TAVILY_ALLOWED_DOMAINS
     -> 6-hour cache hit?  yes: reuse the fetched text   no: reserve one call against TAVILY_DAILY_LIMIT
     -> POST https://api.tavily.com/extract  {urls, extract_depth: "basic", format: "text", include_usage: true}
     -> returned result.url re-checked against the allowlist; failed_results checked even on HTTP 200
     -> PublicClaim source (url, request ID, fetch time, credits) + publicClaimGA signals
  -> registry validation -> rules decide verdicts from curated facts only
  -> public-claim note per committed promise: consistent, or conflict + guardrail check
```

- **Hosted page.** `app/changelog/page.tsx` serves a synthetic changelog for the fictional vendor "Acme Workspace" at [/changelog](https://promise-ledger-chi.vercel.app/changelog). It includes decoys that must not count: SCIM is "in public beta … not generally available yet", and EU data residency is "planned". Tavily fetches it live, so each live run makes a real runtime Tavily call unless the page is already cached.
- **Grounding.** Tavily's generated `answer` and `/research` output are never requested, and any extra response fields are dropped. A claim is one sentence of the returned text that names exactly one known feature (`PUBLIC_FEATURE_NAMES`), says "generally available" or an uppercase "GA", has no hedge or negation (beta, planned, not, coming soon, …), and contains at most one valid ISO date. The quote must be an exact substring of one whitespace-normalised chunk, never spanning Tavily's ` [...] ` separator. The registry then re-checks every signal's quote against the provider's own source.
- **Policy.** A public claim is untrusted evidence. It cannot contribute product facts, so it cannot move a verdict. It sets `publicClaim` on the commitment: a **conflict** when the feature is disabled, missing, stale or unconfirmed for the account, otherwise a consistent note saying customer evidence decided. Conflicts also appear as a guardrail check in the agent view ("PL-101: public GA claim ≠ customer access. Flagged for review; verdict unchanged"). The narrative model never sees public-claim sources, and its existing guardrails already reject delivery or access claims that contradict the verdict.
- **UI.** The agent view and source library list each external evidence provider (`ProviderStatus`) and what it supplied, or why it didn't ("Public claim not checked: …"). The evidence trail shows a "Public claim, not customer evidence" card with the exact quote, the Tavily request ID for live fetches, and a link to the page. The draft editor warns on conflicts. Source cards show whether the text was fetched live or is the reference fixture (`SourceOrigin`).
- **Reference mode** makes no Tavily call. It replays a genuine Tavily Extract response for `/changelog` (`lib/public-claims/recorded-changelog.json`, request `ec1cc9b8-cd2b-4e30-9ff9-689b1883b1c3`, captured September 26, 2026) through the same parser, allowlist and grounding as a live fetch. The UI labels it "Recorded Tavily response" with its capture time (`provenance.recorded: true`). The recording keeps only the URL, `raw_content`, `request_id`, `response_time`, `usage` and `failed_results`. A test fails if the hosted page drifts from the recording. Live runs never fall back to it. When Tavily is unconfigured, over its cap or failing, the provider reports "Public claim not checked: <reason>" and the run continues without a public claim.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `TAVILY_API_KEY` | — | Free Researcher development key (`tvly-…`). Without it, live runs report "not checked". |
| `TAVILY_ALLOWED_DOMAINS` | `promise-ledger-chi.vercel.app` | Comma-separated exact hosts; `*.example.com` matches subdomains only. HTTPS only, no userinfo or ports. |
| `TAVILY_CLAIM_URLS` | `https://promise-ledger-chi.vercel.app/changelog` | Up to 5 server-chosen pages. Any URL off the allowlist stops the check. Browsers never supply URLs. |
| `TAVILY_DAILY_LIMIT` | `20` | Global Extract calls per UTC day; `0` turns the check off. Cache hits don't count. |

The cache and daily counter use the same Upstash Redis store as the live-run limits when `KV_REST_API_URL` and `KV_REST_API_TOKEN` are set. A configured store that fails makes the check fail closed, so no Tavily call is made. Without Upstash the counters are per instance.

## Cost protection

See the [cost policy](COST_POLICY.md#tavily-public-claim-check). The free Researcher plan gives 1,000 credits a month, with pay-as-you-go off. A basic Extract costs 1 credit per 5 successful URLs, and failed URLs are free. At most one call is made per 6-hour cache window per instance, and there are at most 20 calls per day. Even at 1 credit per call, that is at most about 620 credits a month.

## Verify

```bash
# One real Extract call; prints only non-secret fields and key usage before and after
node --env-file-if-exists=.env.local --import tsx scripts/tavily-smoke.ts
node --env-file-if-exists=.env.local --import tsx scripts/tavily-smoke.ts --url=https://promise-ledger-chi.vercel.app/
# Re-record the reference response after changing the page
node --env-file-if-exists=.env.local --import tsx scripts/tavily-smoke.ts --record=lib/public-claims/recorded-changelog.json
```

**September 26, 2026:** one real Extract call against the production homepage, on the allowlisted host, returned HTTP 200 (request `22940fdc-a453-4350-855e-c21338f0de7a`) with line breaks preserved in `text` format and no claims, as expected. Tavily reported 0 credits, and the key and plan showed 0/1,000 used.

**Live confirmation, September 26, 2026, after deploy:** a real Extract call to the production `/changelog` returned HTTP 200 (request `2950878f-91b2-45da-aff6-c6a40791ab57`). It yielded exactly two claims, "Audit log export is generally available (2026-09-12)." and "SAML single sign-on is generally available (2026-06-02).", and none of the SCIM or EU-residency decoys. Tavily reported 0 credits. That run printed only a summary, so the reference recording comes from a second, identical call made to record it (request `ec1cc9b8-cd2b-4e30-9ff9-689b1883b1c3`, 0 credits). Afterwards the key and plan still showed 0/1,000 used.
