# Zero-cash project policy

Owner instruction, September 19, 2026: apply free credits as needed; the project must cost nothing out of pocket.

## Non-negotiable limits

- Cash budget: **$0** for the whole project, including inference, hosting, domains, subscriptions and other services.
- Use only verified, available free tiers or promotional/trial credits. Do not treat an advertised, requested or pending award as usable credit.
- No paid top-ups, paid rollover, card-funded usage, paid subscriptions or dedicated paid compute. Do not rely on a future refund or credit to offset a charge.
- Stop instead of spending when credits expire, are exhausted or cannot be verified. Never silently switch to a paid provider or service.
- Recheck pricing, available credit and the maximum possible request cost before real model work. A local evaluation budget is an additional guard, not a substitute for the provider's no-charge setting.
- Never infer missing personal or professional details for a credit application. Obtain the necessary answers and submission approval.

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
