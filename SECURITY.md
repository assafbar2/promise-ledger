# Security boundaries

Intended use: **synthetic-data hackathon demo**, including an open, rate-limited public live mode. Not for production use or real customer records.

## Implemented

- Server-side secrets only. They are ignored locally and stored as Sensitive Production variables on Vercel. The provider key never reaches the browser, the prompt, or error bodies.
- Open live mode with no token (owner decision, September 26, 2026), protected before any provider call by:
  - a per-connection hourly limit, with IPv6 counted per /64;
  - a shared UTC-day cap;
  - an optional owner token (`DEMO_ACCESS_TOKEN`, compared in constant time) that skips only the per-IP limit and has its own daily cap. A wrong token is rejected with 401.
- The client IP comes from Vercel's platform-set `x-real-ip` / `x-forwarded-for`, which Vercel overwrites to prevent spoofing. Local or other hosts may not protect these headers. Addresses are stored only as truncated HMAC-SHA-256 hashes.
- Counters live in the free Upstash Redis store when configured, and fail closed (503 for live) if it is unreachable. Otherwise they fall back to per-instance memory, which is weaker. A Vercel WAF rate-limit rule is the recommended edge backstop. Nebius **Stop usage after trial** is the $0 guarantee. See [limits](docs/DEPLOYMENT.md#open-live-mode--limits).
- Strict JSON input, same-origin checks, and small request-size limits: 2 KB, or 96 KB for bring-your-own requests.
- Sample accounts are server-owned synthetic packs; the request can only name one by ID.
- Bring-your-own evidence (September 26) is untrusted text: strict schema, at most 8 sources, 6,000 bytes each and 10,000 total, checked before any live run is reserved. Text is normalized, with control, zero-width and bidi-override characters removed. It is passed to models only as JSON data under `untrustedSources`, never in a system prompt. No URL is ever fetched. `.eml` attachments are ignored, and files are read in the browser. Text addressed to an AI system is flagged deterministically (and by triage) but never trusted. The provider cannot supply facts. Model-proposed facts reach the rules only after a person confirms them, and the server re-checks every quote. A live decide step needs an HMAC-signed, source-bound, single-use, 30-minute continuation, so one BYO flow is one live run. The pasted text is sent to Nebius only for that run and is otherwise stored only in the user's browser.
- Untrusted model output: schema, known feature IDs, unique records, exact account-scoped quotes and grounded owners/dates.
- Multi-model pipeline guardrails (September 26): triage can only narrow what extraction reads, and a recall guard always forwards sources with commitment language. The narrative model runs after the verdicts are fixed and has no verdict field. Every claim must cite exact quotes from that commitment's own evidence. New dates, timeframes and customer-facing promises are rejected, as are delivery or access claims that contradict the facts, and links, addresses and placeholders. A failing brief falls back to a labelled template. See [architecture](docs/ARCHITECTURE.md#guardrails).
- Public-claim check (Tavily): server-chosen HTTPS URLs on an exact-host allowlist, re-checked on the returned URL; only public URLs are sent to Tavily; generated answers are never requested; claims must be exact quotes of the fetched text; a public claim cannot supply facts or change a verdict; a 6-hour cache and a fail-closed global daily cap bound usage. See [public-claim check](docs/TAVILY.md).
- Evidence providers are validated by one registry: account scope, unique IDs, size caps, HTTPS URLs, facts only from curated providers, signals citing exact quotes, and no recorded fixtures in live runs.
- Per-run spending guard: each paid call reserves its worst case before dispatch (`LIVE_RUN_BUDGET_USD`, default $0.05); one rate-limit reservation covers a whole pipeline; a 70-second run deadline applies.
- LLM cannot alter trusted product facts, invoke tools or send communications.
- Bounded inference timeouts; no automatic paid retries or secret-bearing provider error output. Client disconnects abort in-flight provider calls.
- Source text rendered as text; no injected HTML.
- Noncacheable API results; edits/new evidence invalidate local approvals.

## Release gates

Open live mode is acceptable only because inputs are either fixed synthetic packs or small, capped, untrusted pastes whose output is schema-bound, and spending is bounded twice: by the app's durable lifetime spend cap ($40 on the hosted app, below the applied promotional credit) and by the provider's **Stop usage after trial** setting while the trial lasts. Users should not paste real customer or personal data into the hosted demo. IP limits can be evaded by attackers with many addresses; the daily cap bounds credit use in that case, but it can also lock out judges for the rest of the UTC day. The owner token is a convenience bypass, not tenant authorization.

**Key rotation, accepted risk:** the Nebius key was pasted into chat on September 19. By owner decision on September 26 it is not rotated. Anyone holding it could spend its free credits outside this app, and the app's limits cannot prevent that. Reassess if credits drop unexpectedly. Before any real-data use, add authenticated identities, per-user quotas, persistent reviewer attribution and retention controls. The current log is stored in the user's browser only, not as an immutable compliance audit.

Exact quotations do not guarantee semantic correctness, and a model-written draft that passes every guardrail can still mislead. Human edits to a draft are not re-checked; test negation, cancellation, source authority and contradictions. Real telemetry needs authorized account mapping and validated timestamps.

September 20's cleanup removes unused database/authentication starter code, patches Vinext's `image-size` dependency to 2.0.4, and disables the unused Worker image endpoint. A full npm audit reports zero advisories (rechecked September 27), not a blanket security guarantee. Production QA on September 27 covered Chrome on desktop and at 390 px, keyboard use, and axe contrast checks with no violations; Firefox and Safari are not yet tested. No blanket security or WCAG claim is made.

Do not add real sending as a cosmetic button or treat approval of a draft as permission to contact a customer. No email/CRM sending capability exists in this build.

## Secret hygiene

Keep `.env.local`, API keys, access tokens and customer records out of Git and screenshots. Only the empty `.env.example` is shareable. On September 27 the full public history (all branches and PR head refs) and the production JavaScript were scanned for Nebius, Tavily, Vercel, Upstash and Sentry key patterns and Sentry DSNs; only test placeholders and lockfile integrity hashes matched. Report sensitive findings privately to the repository owner, never by posting secrets in a public issue.
