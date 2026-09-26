# Zero-cash project policy

Owner instruction, September 19, 2026: apply free credits as needed; the project must cost nothing out of pocket.

## Non-negotiable limits

- Cash budget: **$0** for the whole project, including inference, hosting, domains, subscriptions and other services.
- Use only verified, available free tiers or promotional/trial credits. Do not treat an advertised, requested or pending award as usable credit.
- No paid top-ups, paid rollover, card-funded usage, paid subscriptions or dedicated paid compute. Do not rely on a future refund or credit to offset a charge.
- Stop instead of spending when credits expire, are exhausted or cannot be verified. Never silently switch to a paid provider or service.
- Recheck pricing, available credit and the maximum possible request cost before real model work. A local evaluation budget is an additional guard, not a substitute for the provider's no-charge setting.
- Never infer missing personal or professional details for a credit application. Obtain the necessary answers and submission approval.

## Sentry — September 26, 2026

The demo org is on the free Developer plan (5,000 errors a month, 30-day retention, no card). The read token is read-only. Seeding sends at most 60 events per run and the daily cron at most 32 a day, about 1,000 a month. Events over quota are rejected, not billed. See [Sentry runtime evidence](SENTRY.md#cost).

## Nebius checkpoint — September 19, 2026

- Billing is active; the console shows **$1.00 trial credit**, **29 days remaining**, and **$0.00 account balance**.
- One owner-approved dedicated key is configured locally. The first evaluation made 40 real model requests; all usage is recorded in `evaluation/LIVE-RESULTS-2026-09-19.md`.
- The account's saved trial-end preference was **Continue with paid usage when the trial ends**. Its dialog says the linked card can be charged if the account balance goes negative.
- After explicit owner approval, **Stop usage when the trial ends was saved and verified**. The console now shows **Stop usage after trial**, and its post-trial banner says the account will stop usage by default.
- The saved alternative says projects and API keys stop working when the trial ends, new ones cannot be created, and the card is never charged. Do not switch back to paid usage.
- The $25 hackathon credit request and separate Builder Program enrollment remain unsubmitted. Neither award is part of the verified balance.

## Local evaluation guard

The evaluation runner now fails closed without a recent, explicitly recorded verification of free credit, the exact model's current prices/context limit and the provider's no-charge setting. Its maximum budget is $0.50 per invocation, shared across development and held-out cases, with at least 10% of verified credit left unused.

Before each request it reserves the full model context at the verified uncached input rate plus the adapter's maximum output allowance at the output rate. It then reconciles against reported token usage, rounding costs up to a microdollar. Missing/invalid usage, unexpected models, exceeded token bounds or uncertain failures retain conservative accounting and stop further requests. Grounding-rejected output still counts its reported usage. Requests blocked before dispatch are reported as not run, not as model failures or invented execution.

Verification must be no older than 15 minutes, including between requests. This metadata is a manual verification record, not an automatic provider balance query. Accounting is an estimate at the recorded rates, not a provider invoice. The guard covers the evaluation command only and is not an account-wide or lifetime spending limit; the provider's saved stop-usage setting remains the primary no-charge protection for both evaluations and the app.

Fresh verification metadata was populated for the September 19 first live invocation, with a non-secret record in `evaluation/provider-verification-2026-09-19.json`. Standard model rates were $0.30/$0.90 per million input/output tokens. The documented 1,048,576-token input reservation bound deliberately exceeds Nebius's displayed 256K context; the exact endpoint integer is unverified. Total rounded usage-based cost was $0.025144 of trial credit, not a provider invoice. A post-run console refresh still showed $1.00 trial credit and $0.00 account balance with stop-usage active, so the exact settled credit balance is not yet independently reconciled. Do not reuse the pre-run balance or expired verification for another invocation. Neither mocked tests nor this small synthetic evaluation establish general model quality.

## Verification before each live run

Recheck the saved stop-usage preference and available credit before recording fresh guard metadata. Do not run inference while paid rollover is enabled. If applying a promotional credit changes trial status or disables the no-charge safeguard, stop and verify equivalent provider protection before using the credit. Record actual redeemed credit and its expiry; do not assume an activation code is itself a redeemable promo code. A new evaluation process does not automatically know what an earlier process spent: reverify the actual balance, do not reuse an old credit figure.

## Per-run budget for the live pipeline

Added September 26, 2026. A live evidence check runs up to three paid calls: Nemotron 3 Nano triage, Nemotron 3 Super extraction, and Nemotron 3 Ultra narrative. The rate limiter counts the whole pipeline as **one** live run. Rates are from the public Token Factory catalog, checked September 26: Nano $0.06/$0.24, Super $0.30/$0.90, Ultra $1.00/$3.00 per million input/output tokens.

| Step | Input cap | Output cap (`max_tokens`, includes reasoning) | Worst case |
| --- | --- | --- | --- |
| Triage (Nano) | 16,000 bytes (≤ 16,512 tokens) | 3,000 | $0.001711 |
| Extract (Super) | 16,000 bytes (≤ 16,512 tokens) | 6,000 | $0.010354 |
| Explain (Ultra) | 16,000 bytes (≤ 16,512 tokens) | 7,000 | $0.037512 |
| **Hard ceiling per run** | | | **$0.049577** |

The input bound assumes each token encodes at least one UTF-8 byte, plus 512 tokens of chat-template overhead. `LIVE_RUN_BUDGET_USD` (default **$0.05**, maximum $0.50) enforces the ceiling at runtime. Each call reserves its worst case before dispatch and then settles to reported usage. Missing usage keeps the full reservation, and usage above a bound stops every later paid call. Unlisted model IDs are budgeted at the highest listed rate ($1/$3).

**Measured on September 26:** four full live runs with the shipped settings cost an estimated $0.0084–$0.0095 each, in 16–20 seconds. The input to the three calls totalled about 3,400–3,900 tokens, and the output 3,300–4,700 tokens. See [the live pipeline check](evaluation/PIPELINE-LIVE-2026-09-26.md).

**Daily exposure at the current defaults**, 30 public plus 40 owner-token runs: worst case 70 × $0.05 = **$3.47 per day**; typical 70 × $0.0095 ≈ **$0.67 per day**. Set `LIVE_RUNS_PER_DAY` to at most *verified remaining free credit ÷ (days of judge access left × $0.05)*. With about $50 of credit and 80 days left, that's about 12 runs per day in the worst case. Typical runs cost about a fifth of the ceiling, so actual consumption is much lower. Setting `NEBIUS_NARRATIVE_MODEL=off` removes Ultra: the ceiling drops to $0.012 and template drafts are shown instead. The provider's **Stop usage after trial** setting remains the $0 guarantee. These figures are estimates at catalog rates, not invoices.

## Tavily public-claim check

Added September 26, 2026. The check uses a free **Researcher** plan development key: 1,000 credits a month, no card, **pay-as-you-go off**. Without pay-as-you-go, Tavily answers HTTP 432 at the limit instead of charging, and the app then reports "Public claim not checked". Only public, server-chosen URLs are sent to Tavily, never customer data. Tavily's research and generated-answer features, which cost more credits, are never used.

| Guard | Setting |
| --- | --- |
| Call type | Basic Extract: 1 credit per 5 successful URLs; failed URLs are free |
| When it runs | Live runs only, after the access gate and the per-IP and daily live-run limits. Reference mode never calls Tavily. |
| Cache | 6 hours per URL, in Upstash when configured, otherwise per instance |
| Global cap | `TAVILY_DAILY_LIMIT`, default **20** Extract calls per UTC day. It fails closed if a configured store is unreachable, and `0` turns the check off. |
| Worst case | 20 calls × 1 credit × 31 days ≈ **620 credits a month**, under the free 1,000. With Upstash and one URL, about 4 calls a day. |
| Provider backstop | Recommended: set a per-key credit limit in the Tavily dashboard (for example 800 a month) so Tavily itself stops before the free quota is gone |

**Measured on September 26:** one real single-URL Extract call reported 0 credits. `/usage` showed 0 of 1,000 used for both the key and the plan, with no pay-as-you-go limit set. Development of this feature used 0 of its 30-credit allowance.
