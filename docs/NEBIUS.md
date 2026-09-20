# Live NVIDIA Nemotron integration

## Honest current state

As of September 19, 2026, the first real evaluation is complete on `nvidia/nemotron-3-super-120b-a12b`: 7/8 development and 32/32 frozen held-out exact matches, with all 40 actual traces saved and no provider/validation errors. These synthetic cases do not establish general model quality. See `evaluation/LIVE-RESULTS-2026-09-19.md`. The approved `promise-ledger-evaluation` key is stored in ignored `.env.local` with mode 0600; the demo-access token is separate. The profile was submitted with zero data retention selected, and the owner completed billing verification.

The owner later pasted the provider key into chat. Treat it as exposed and rotate it after owner confirmation. One-time display does not mean one-time use or establish an expiry; the actual expiry is unverified. Never copy the secret into reports, source, browser inputs or commits.

## Setup

Billing verification and approved dedicated-key creation are complete. The assistant did not enter or inspect the owner's card or address. After explicit owner approval, **Stop usage when the trial ends** was saved and verified; it remained active after the evaluation. Do not switch to paid usage. The local evaluation guard permits at most $0.50 per invocation from freshly verified free credit. The first run used an estimated $0.025144 of trial credit. No top-up, paid rollover or dedicated compute was enabled.

### Evaluation budget verification

Record these non-secret values in the ignored local environment only after verifying them against the actual account and exact requested model. Do not guess rates or context size. The example environment leaves verification values blank deliberately.

| Variable | Required evidence |
| --- | --- |
| `NEBIUS_EVAL_NO_PAID_ROLLOVER` | `true` only after checking the provider's saved stop-usage preference |
| `NEBIUS_EVAL_PRICE_MODEL` | Exact model ID matching `NEBIUS_MODEL` |
| `NEBIUS_EVAL_BUDGET_USD` | Positive invocation budget, at most `0.50` and 90% of available free credit |
| `NEBIUS_EVAL_FREE_CREDIT_USD` | Actual remaining free credit, not an advertised or pending award |
| `NEBIUS_EVAL_INPUT_USD_PER_MILLION` | Current uncached input-token price for this model |
| `NEBIUS_EVAL_OUTPUT_USD_PER_MILLION` | Current output-token price for this model |
| `NEBIUS_EVAL_CONTEXT_TOKENS` | Verified full context limit, or an explicitly documented conservative upper bound |
| `NEBIUS_EVAL_VERIFIED_AT` | ISO timestamp of those checks, no older than 15 minutes |

The guard reserves the full context plus the adapter's capped output before each request, then reconciles against provider token usage. Missing or inconsistent usage, unexpected models, exceeded bounds and stale verification stop subsequent requests. The same budget is shared by both suites. Reports record conservative cost accounting and its assumptions; these are not billed invoices. This is a per-invocation evaluation safeguard, not an account-wide or lifetime cap. Reverify balance for every new invocation and after credit redemption. The web app relies on the provider's saved stop-usage protection; this local runner guard does not wrap the app's live endpoint.

Devpost hackathon registration is complete per the owner's September 19, 2026 confirmation; it does not establish Token Factory API access. The optional Builder Program at https://dev.nebius.com/builders is separate, and enrollment remains unconfirmed.

### Hackathon credits

**Zero-cash constraint:** follow `COST_POLICY.md`. Paid rollover was initially enabled, but the owner approved changing it and **Stop usage when the trial ends is now saved and verified**. It states that projects/API keys stop at trial end and the card is never charged. Recheck this safeguard after redeeming promotional credits, rather than assuming it remains effective.

The official event resources page advertises $25 in Token Factory credits. Its Nebius promo-code form is open with the event activation code prefilled. The form requires first name, last name, email, job title and company name; phone and company website are optional. The owner must supply/confirm company name and job title and approve sharing the enrollment details before this separate form is filled and submitted. Marketing options remain unchecked. Hackathon and Builder Program credits have not been requested or applied. The verified $1.00 balance is trial credit, not evidence of either program enrollment or its credit award.

- Official API quickstart: https://docs.tokenfactory.nebius.com/quickstart
- Mandatory billing setup and automatic charging: https://docs.tokenfactory.nebius.com/other-capabilities/billing-new
- Official hackathon credit-request link: https://nebiusglobalaihackathon.devpost.com/resources

For a fresh checkout, copy `.env.example` to `.env.local` and provide the following. Do not overwrite an existing configured local file:

```dotenv
NEBIUS_API_KEY=your-token-factory-key
NEBIUS_MODEL=nvidia/nemotron-3-super-120b-a12b
DEMO_ACCESS_TOKEN=a-random-private-token-at-least-24-characters
```

The model ID was verified through authenticated model listing and all 40 live responses on September 19, 2026. Do not replace the demo token with the provider key. Add replacement credentials directly to `.env.local` in a local editor or secret manager, not chat or a browser input. Restart `npm run dev` if needed, open Demo controls, select the live engine and enter only the **private demo token**. Each live app request also consumes credit; the CLI evaluation guard does not cover the app.

## Request contract

`lib/nebius.ts` calls `https://api.tokenfactory.nebius.com/v1/chat/completions` with server-side Bearer authentication and structured JSON output. It sends only the synthetic sources. The request has a 60-second timeout, bounded output tokens, and no automatic retry. The model receives no tools, API key, or private-demo token in its prompt.

Successful runs report actual provider model, run ID and usage when supplied. Truncation, refusal, invalid JSON, wrong model, missing citation, ungrounded owner/date, rate limiting or transport failure produces an explicit error. Live mode never silently falls back to reference fixtures.

## Evaluation

```bash
npm run eval
npm run eval:live
npm run eval:development
npm run eval:held-out
```

`eval` measures 18 deterministic rule cases, not AI accuracy. `eval:live` runs both the eight-case development set and the separate, frozen 32-case held-out set. The two additional commands run one set only. Real inference requires a provider key and consumes API credits. Calls are sequential, bounded to one request per case, and never automatically retried. Authentication, rate-limit or transport failures stop the remaining calls.

Each run writes timestamped reports under `docs/evaluation/runs/` and convenience `development-latest.json` / `held-out-latest.json` files. Reports checkpoint after every case and retain actual provider model, run ID, request-header ID when supplied, elapsed time, token usage and sanitized errors. Invalid model responses keep their usage/trace rather than disappearing. Missing credentials produce explicitly blocked reports with zero executed cases, null accuracy and no invented latency or IDs.

The entire predicted commitment set is scored, including extra commitments; correctly guessing one feature cannot conceal false positives. Overall exact match includes executed errors. Feature/field metrics are separately labeled as applying only to accepted outputs. Synthetic sets do not establish real-world accuracy.

The held-out set is hashed in `evals/held-out-manifest.json` before any live run. It contains distinct wording and categories including cancellation, supersession, cross-account contamination, customer demands, relative dates, fabricated role instructions and misleading engineering fields. The runner rejects changes to this set unless it is explicitly versioned. Do not tune the prompt after inspecting its results; use development cases for iteration and a fresh holdout for another evaluation. These assistant-authored synthetic examples are not an independent external benchmark.

Before hosting, configure secrets through the host, verify runtime environment bindings, and add identity-based access and durable quotas. The prototype's shared token is not production authentication.

Primary documentation: https://docs.tokenfactory.nebius.com/ . Model availability and API features must be confirmed against the current account and official docs before the first paid run.
