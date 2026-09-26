# Promise Ledger — Vercel deployment

## Identity and access

- Project: **promise-ledger**, in the owner's existing **Hobby** workspace, verified September 20, 2026.
- Assigned production domain: **https://promise-ledger-chi.vercel.app**. Vercel assigned the suffix; the project and product names remain Promise Ledger.
- Repository: `assafbar2/promise-ledger`, **private**; its `main` branch is connected to this project.
- Publication state: **production deployment succeeded September 20, 2026**. Anonymous HTTP verification passed at 22:59 UTC (3:59 p.m. Pacific): homepage, six static assets, status, all three reference scenarios, live-disabled failure, and cross-origin rejection. See the [saved smoke report](DEPLOYMENT-SMOKE-2026-09-20.json).
- No plan upgrade, paid add-on, database, storage service, custom-domain purchase, or change to other projects is part of this release.

Share **https://promise-ledger-chi.vercel.app**, which was tested without cookies and does not require a Vercel login. The generated team/branch deployment aliases redirect to Vercel authentication; do not use those as the demo link. Existing preview protection was preserved.

Since September 26, `/` is the landing page and the workbench is at **https://promise-ledger-chi.vercel.app/app**; `/app?account=<id>` opens a sample account directly. Share the root for context or `/app` to go straight to the product.

## Hosted functionality

The September 20 production release is a **reference-only synthetic demo**: no Nebius key is configured on Vercel, and `/api/status` reports `liveConfigured: false`. Run evidence checks, switch among three scenarios, inspect original sources, prepare/edit/approve drafts, and export. Refreshing clears session state. Nothing sends to a customer.

From this change onward the code supports **open, rate-limited live mode**. Owner decisions, September 26, 2026: judges must be able to run live Nemotron **without a token**, protected by rate limits, and the existing Nebius key is **not rotated**. Live mode becomes the default engine as soon as the owner sets the Vercel variables below and redeploys. Until then the hosted app stays reference-only. Do not present it as hosted live AI before `/api/status` reports `liveConfigured: true` and a real live run has been checked.

## Open live mode — limits

| Layer | What it limits | Default | Needs owner setup | Strength |
| --- | --- | --- | --- | --- |
| App per-IP limit | Anonymous live runs per connection per clock hour. IPv6 counted per /64. | 5 | No | Durable with Upstash; per instance without it |
| App daily cap | All anonymous live runs per UTC day | 30 | No | Durable with Upstash; per instance without it |
| Owner token | Optional `DEMO_ACCESS_TOKEN` bypass: skips the per-IP limit and uses its own daily cap | 40 per day | Optional | Same store as above |
| Upstash Redis (free) | Shares the two counters and the spend ledger across all Vercel instances and regions | Off | **Required for live mode** | Durable. Fails closed: if missing or unreachable, live returns 503 |
| Lifetime spend cap | Cumulative estimated Nebius spend of all live runs, public and owner-token | $30 (`LIVE_SPEND_CAP_USD`) | Set to verified credit − margin | Durable in Upstash only; no in-memory fallback |
| Vercel WAF rate-limit rule | All `POST` requests to `/api/analyze` and `/api/pipeline` per IP, stopped at the edge before the function runs | Off | Recommended | Durable per region, enforced by the platform |
| Nebius **Stop usage after trial** | Cash spend during the trial | Active since September 19 | Recheck | $0 guarantee only until the trial ends: promo credits then need paid usage, which has no hard stop |

A live run is counted when it is attempted, before the provider call, so failed runs still count. Reference mode is never limited by the app. Limited live requests return HTTP 429 with `Retry-After` (or 503 when open mode is paused or the store is unreachable), a friendly message, and `fallback: "reference"`. The UI then offers a one-click **Run reference check**. Setting `LIVE_RUNS_PER_DAY=0` pauses open live mode without removing the key; the owner token keeps working.

Why this design: the WAF rule is free on Hobby and stops floods at the edge, but Hobby allows only one rate-limit rule, windows of at most 10 minutes, and counters per region, so it cannot enforce a daily cap. Upstash's free plan (256 MB, 500K commands per month, no card) holds both counters durably over plain HTTPS `fetch`, so no npm dependency is added. Each allowed anonymous run uses four Redis commands, and a request blocked by an instance's in-memory counter uses none. In-memory counters are always active as the no-setup fallback. They are weaker: every warm function instance has its own counts, and a cold start resets them. The Nebius stop-usage setting still keeps spending at $0 in that case, but credits could drain faster.

**Credit budget.** One live evidence check is a three-model pipeline (Nano triage, Super extraction, Ultra narrative) and counts as **one** run against the limits above. Its hard ceiling is **$0.0496**, enforced by `LIVE_RUN_BUDGET_USD` (default $0.05). Four measured runs on September 26 cost an estimated $0.0084–$0.0095 each. Worst case at the defaults: 30 public runs per day ≈ $1.49, plus 40 owner runs ≈ $1.98. Typical is about $0.67 per day if every run is used. Set `LIVE_RUNS_PER_DAY` to at most *verified remaining free credit ÷ (days until December 15 × $0.05)* after checking the console, or set `NEBIUS_NARRATIVE_MODEL=off` to cut the ceiling to about $0.012. See the [cost policy](COST_POLICY.md#per-run-budget-for-the-live-pipeline). If credits run out, live runs fail explicitly and reference mode keeps working; nothing is charged while **Stop usage after trial** is active.

## Owner setup for open live mode

Do these in order. Each step is $0 on Hobby. **Stop** if any screen asks for a payment method, shows a paid plan preselected, or shows a price other than $0.

1. **Nebius check** (Token Factory console): confirm **Stop usage after trial** is still active, and note the remaining free credit and its expiry. Do not top up or enable paid rollover.
2. **Upstash Redis, free** (required: without it the spend cap keeps live mode off). Vercel dashboard → project **promise-ledger** → **Storage** → **Create Database** → **Upstash** / **Upstash for Redis** → plan **Free** → primary region **Washington, D.C. (us-east-1)**, next to the function → name `promise-ledger-limits` → **Create**. Then **Connect Project** → **promise-ledger** → environment **Production** → keep the default `KV` prefix → **Connect**. Confirm that **Settings → Environment Variables** now lists `KV_REST_API_URL` and `KV_REST_API_TOKEN`. The app also reads `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`; a custom prefix is not read. The other variables the integration adds are unused.
3. **Environment variables.** **Settings → Environment Variables**, scope **Production** only, marked **Sensitive**:
   - Required: `NEBIUS_API_KEY`, `NEBIUS_MODEL` (`nvidia/nemotron-3-super-120b-a12b`).
   - Created by step 2: `KV_REST_API_URL`, `KV_REST_API_TOKEN`.
   - Optional pipeline settings, all with tested defaults, so leave them unset unless changing behaviour: `NEBIUS_TRIAGE_MODEL`, `NEBIUS_NARRATIVE_MODEL` (`off` disables a step), `NEBIUS_TRIAGE_REASONING_EFFORT`, `NEBIUS_NARRATIVE_REASONING_EFFORT`, `NEBIUS_STREAM`, `LIVE_RUN_BUDGET_USD`. See [Nebius setup](NEBIUS.md#multi-model-pipeline--september-26-2026).
   - Public-claim check ([details](TAVILY.md)): `TAVILY_API_KEY` (free Researcher development key, pay-as-you-go off), `TAVILY_ALLOWED_DOMAINS=promise-ledger-chi.vercel.app`, `TAVILY_CLAIM_URLS=https://promise-ledger-chi.vercel.app/changelog`, `TAVILY_DAILY_LIMIT=20`. Without the key, live runs show "Public claim not checked" and everything else works.
   - Spend cap: `LIVE_SPEND_CAP_USD`, the verified remaining Nebius credit minus at least 10% (default 30). Optional: `LIVE_SPEND_LEDGER` (default `1`). See [owner controls](#lifetime-spend-cap--owner-controls).
   - Optional: `DEMO_ACCESS_TOKEN` (random, at least 24 characters, owner bypass for recording), `LIVE_RUNS_PER_DAY` (default 30; see the credit budget above; `0` pauses open live mode), `LIVE_RUNS_PER_IP_PER_HOUR` (default 5), `LIVE_TOKEN_RUNS_PER_DAY` (default 40).
   - Optional, Sentry runtime evidence: `SENTRY_READ_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` (numeric ID), `SENTRY_API_BASE`. Daily demo re-seed by Vercel Cron (`/api/cron/seed-sentry`, scheduled in `vercel.json`): `SENTRY_SEED_DSN` and `CRON_SECRET` (at least 16 characters). Without them Sentry evidence and the cron stay off. See [Sentry runtime evidence](SENTRY.md#environment).
   - Enter values in the dashboard only, never in chat, Git or build settings. Leave `DEMO_ACCESS_TOKEN` unset if no bypass is wanted.
4. **Vercel WAF rule** (recommended). Project → **Firewall** → **Configure** → **+ New Rule**. Name: `Limit analysis API`. If **Request Path** starts with `/api/` **and** **Method** equals `POST`, then **Rate Limit**: **Fixed Window**, **60 s**, **10** requests, key **IP**, action **Default (429)**. Hobby includes one rate-limit rule and 1,000,000 allowed requests. Stop if the pricing dialog shows any charge. Select **Save Rule** → **Review Changes** → **Publish**. The condition covers both `/api/pipeline`, which the UI uses since September 26, and `/api/analyze`. `/api/status` is a GET and is not counted. **If the rule was created earlier with "equals `/api/analyze`", edit it:** it no longer covers the UI's requests. The rule cannot see the request body, so it also counts reference runs; 10 per minute is ample for a person. The UI turns the platform's 429 into a friendly message.
5. **Redeploy** production: **Deployments** → latest production deployment → **Redeploy**. Environment variables apply only to new deployments.
6. **Verify** without Vercel cookies. `https://promise-ledger-chi.vercel.app/api/status` must show `"liveConfigured": true` and `"liveAccess": {"open": true, …, "durableLimits": true}`; `durableLimits` is `false` if step 2 was skipped. `"spend"` must show `"durable": true`, `"available": true` and the intended `capUsd`. It also lists the three pipeline models under `"pipeline"`. Then run one live evidence check in the UI and confirm the Agent pipeline panel shows all four steps finishing, and the footer shows the Nemotron extraction model. Record the date and result in [status](STATUS.md).

To turn live mode off quickly, set `LIVE_RUNS_PER_DAY=0` and redeploy, set `LIVE_SPEND_CAP_USD=0` (closes owner-token runs too), or remove `NEBIUS_API_KEY` and redeploy.

## Lifetime spend cap — owner controls

The [cost policy](COST_POLICY.md#lifetime-live-spend-cap) explains why this cap exists. Every live run reserves `LIVE_RUN_BUDGET_USD` in Upstash before any Nebius call and is then settled to its estimated cost. Rate limits are checked first, so throttled requests never touch the ledger. Each live run adds two Redis commands, and each `/api/status` read (one per page load) adds one.

`/api/status` → `spend` (non-secret, `null` when live isn't configured): `capUsd`, `spentUsd`, `remainingUsd`, `runReserveUsd`, `ledger`, `durable` (the ledger was read just now), and `available` (at least one more worst-case run fits). `spentUsd` includes reservations for runs in progress.

**Without durable storage** (no `KV_REST_API_URL`/`KV_REST_API_TOKEN`, or the store errors or times out), every live request, including owner-token requests, returns HTTP 503 with `code: "live_spend_unavailable"` and `fallback: "reference"` before any Nebius call. `/api/status` shows `spend.durable: false` and `spend.available: false`, and the UI keeps the engine on the labelled reference replay. Reference mode is unaffected. When the cap is reached, the code is `live_spend_cap` instead.

Owner-only changes (Vercel **Settings → Environment Variables**, Production, then **Redeploy**):

- **Adjust the cap.** Change `LIVE_SPEND_CAP_USD`. Spend already recorded is kept, so raising the cap reopens live mode and lowering it below `spentUsd` closes it at once. `0` closes live mode for everyone.
- **Reset after a verified top-up or new credit.** Check the Nebius console balance first. Set `LIVE_SPEND_LEDGER` to a new name (for example `2026-10-18`) **and** set `LIVE_SPEND_CAP_USD` to that verified remaining credit minus a margin. The new ledger starts at $0, and the old key `promise-ledger:spend:v1:<old name>` stays in Upstash for audit. Never reset without also lowering the cap to the newly verified balance.
- **Inspect or correct directly.** In the Upstash console, key `promise-ledger:spend:v1:<ledger>` holds recorded spend in integer **microdollars** (`9100` = $0.0091). Editing it takes effect without a redeploy. Only the owner has Upstash and Vercel access; the app has no reset endpoint.

Never put provider keys in chat, browser inputs, Git, build arguments, recordings, or client code. The evaluation CLI budget does not protect the app's endpoint; the limits above do.

## Build and release

```bash
npm ci
npm run check
npm run eval
npm run test:vercel
```

The existing local/Worker scripts remain unchanged. `build:vercel` selects the pinned Nitro adapter and writes Vercel Build Output API files to `.vercel/output`. `test:vercel` exercises the compiled function, all three reference scenarios, the runtime live-mode gate, and fail-closed live/cross-origin access.

The Vercel branch bundles Tailwind's CSS dependency in the RSC/SSR environments: otherwise the adapter externalizes it and Vite tries to read a module name as a filesystem path. The function has a 75-second execution limit. The pipeline has a 70-second deadline and gives each provider call a timeout that fits inside it. Neither is a spending cap.

`vercel.json` specifies the dedicated build command and no Next.js framework preset. `.vercelignore` excludes every local environment file, dependencies, previous outputs, and scratch work. CLI linking can append a Vercel OIDC token to ignored `.env.local`; preserve permissions 0600. No local environment file may be uploaded.

Before publication, run tests, a full dependency audit, source/bundle secret scans, and an upload preview. After publication, test the production URL without Vercel cookies, reference API results, static assets, and `/api/status`. Once live variables are set, also check one live run and one limited response. Keep GitHub private until the owner separately authorizes public source.

## Recording and submission boundary

The [recording script](DEMO-SCRIPT.md) contains 300 spoken words, targeting 2:45 with pauses. Live footage and narration will be captured and synchronized separately; no video is recorded or uploaded by this deployment work.

The final entry needs real NVIDIA-on-Nebius use as well as working test access. A video alone is insufficient. Judges must not need the owner's Vercel login. Free live access must last through December 15, 2026, at noon Pacific; current trial credits do not establish that future availability.
