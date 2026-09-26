# Promise Ledger

**What you promised. What shipped. What your customer can actually use.**

An evidence-first customer-success workbench for the Nebius × NVIDIA Global AI Hackathon, Best Apps and Agents track.

Engineering closes an audit-export ticket, but Northstar's feature flag is still off. Promise Ledger exposes the gap, shows the original promise and conflicting evidence, and prepares an accurate customer update for human review. Nothing sends automatically.

Under the hood, a visible **three-model NVIDIA Nemotron pipeline on Nebius Token Factory** does the work. Nano triages the sources and Super extracts commitments with exact quotes. Deterministic rules then decide every verdict, and only after that does Ultra explain why the evidence disagrees, draft a situation-specific customer update, and nudge the owner. Every model-written claim must cite exact source text, and server-side guardrails reject new dates, new promises and verdict changes. A live agent view streams each step, model, latency, token count and cited quote as it happens.

> **Status:** the synthetic workbench and Vercel build are implemented. The first hosted release is reference-only: no provider key is deployed and no inference credits are consumed. Real NVIDIA-on-Nebius evaluation completed separately on September 19, 2026: 7/8 development and 32/32 frozen held-out exact matches, with no provider/validation errors. These synthetic cases do not establish real-world model quality. See [the measured results](docs/evaluation/LIVE-RESULTS-2026-09-19.md), [deployment and access](docs/DEPLOYMENT.md), and [current handoff](docs/STATUS.md). The hackathon submission is not complete.

## Goal

Help a customer-success manager answer: **“Can I truthfully tell this customer we delivered what we promised?”**

Our hackathon goal is a strong, distinctive Best Apps and Agents entry, with **$0 out-of-pocket spending**. The distinction is simple: engineering finished does not mean this customer can use the feature. Promise Ledger makes that difference visible and helps a human prepare an accurate update.

## Current scope

One fictional account, a fixed synthetic evidence pack and three scenarios: customer access disabled, successful customer acceptance, and stale evidence. Nemotron 3 Nano routes sources, Nemotron 3 Super extracts commitments, separate rules check built, enabled and customer-verified facts, and Nemotron 3 Ultra writes grounded explanations and drafts. The workbench connects the agent trace, ledger, exact source quotes, evidence review, editable drafts and exports.

This is not a full customer-success platform. There are no live CRM/support connectors, arbitrary customer uploads, persistent records, multi-customer tenancy, background monitoring or outbound sending. Evidence comes through a pluggable provider interface. Only the synthetic pack is registered today; Tavily public-claim, Sentry runtime-error and pasted-evidence providers are planned. In reference mode, and whenever a model draft fails a guardrail, the customer update is a clearly labelled template. These exclusions are deliberate, not missing hackathon requirements.

## Run locally

Requires Node.js 22.13 or later and npm.

```bash
npm ci
npm run dev
```

Open the exact local URL printed by the server. No credentials are needed for the reference workflow. Select **Run evidence check**; change the scenario to see the same promise become verified or lose its proof when evidence becomes stale.

## Working features

Try the hosted reference demo: **https://promise-ledger-chi.vercel.app**. The Vercel project is **promise-ledger**, on the owner's verified Hobby account; the homepage and all three reference scenarios passed anonymous HTTP checks on September 20. See [deployment and access](docs/DEPLOYMENT.md). The repository remains private. The code now supports **open live mode**: anyone can run live Nemotron extraction with no token, limited to 5 runs per connection per hour and 30 per UTC day overall, and reference mode stays available as a fallback. It turns on once the owner sets the Vercel variables in the [owner setup](docs/DEPLOYMENT.md#owner-setup-for-open-live-mode) and redeploys. Until then the hosted app is reference-only. By owner decision on September 26 the existing Nebius key is not rotated; the accepted risk is recorded in [security](SECURITY.md).

- Live agent view: four step cards (Triage, Extract, Decide, Explain) with model, status, latency, tokens and cost, plus cited quotes checked against their sources as they stream in, verdicts and guardrail results. Reference mode replays the same trace, clearly labelled, with no AI calls.
- "Why the evidence disagrees" explanations, situation-specific customer updates and internal owner nudges written by Nemotron 3 Ultra after the rules decide. Each claim expands to its exact quotes, and any brief that fails a guardrail falls back to a template labelled with the reason.
- Searchable, filterable commitment ledger with owners, dates and seven conservative verdicts.
- Exact source quotations and separate customer-specific built, enabled and verified checks.
- Six synthetic source documents and three replayable evidence scenarios.
- Public-claim check with a runtime Tavily Extract call: the fictional vendor's [public changelog](https://promise-ledger-chi.vercel.app/changelog) says audit log export is generally available, and Promise Ledger shows that beside Northstar's disabled entitlement as "Publicly GA ≠ usable by this customer". Exact quotes only, and it never changes a verdict. See [public-claim check](docs/TAVILY.md).
- Editable customer drafts, explicit local review and export.
- Source library and exportable session activity.
- Source validation and server-side Nebius integration with explicit failure handling.
- Open, rate-limited live mode: per-IP hourly and shared daily caps, durable with free Upstash Redis, and friendly limit messages with one-click reference fallback. A full pipeline counts as one run, and a per-run budget caps its worst-case cost at $0.05. A durable lifetime spend cap (default $30) reserves each run's worst case before any Nebius call and turns live mode off, in favour of the reference replay, once the cap is reached or can't be verified.
- Pluggable evidence providers with one validating registry (account scope, exact-quote facts and signals, no fixtures in live runs).
- Sentry runtime errors as a fourth evidence family: "enabled, but crashing for this customer" lowers a verdict to needs verification, while no errors never proves delivery. Live mode reads the API; the labelled reference scenario "Enabled, but crashing" replays a recorded response. See [Sentry runtime evidence](docs/SENTRY.md).

Northstar and everyone in its evidence pack are fictional. The snapshot is fixed to September 13, 2026. Reviews and activity live in memory: refreshing clears them, so export first. No real CRM, support or telemetry service is connected.

## NVIDIA Nemotron on Nebius

Follow [live setup](docs/NEBIUS.md). Provide a real Nebius key and an available NVIDIA Nemotron model ID in ignored `.env.local`, then restart the server. Live mode becomes the default with no token, within the rate limits. `DEMO_ACCESS_TOKEN` is optional and gives the owner higher limits. Never put the Nebius API key in the browser.

On Vercel, the owner sets these variables, names only: `NEBIUS_API_KEY` and `NEBIUS_MODEL` (required; `NEBIUS_MODEL` stays the Super extraction model); `KV_REST_API_URL` and `KV_REST_API_TOKEN` (created by the free Upstash integration; required for live mode, because the spend cap fails closed without them); `LIVE_SPEND_CAP_USD` (lifetime cap, default 30) and `LIVE_SPEND_LEDGER` (see [spend cap controls](docs/DEPLOYMENT.md#lifetime-spend-cap--owner-controls)); `DEMO_ACCESS_TOKEN`, `LIVE_RUNS_PER_DAY`, `LIVE_RUNS_PER_IP_PER_HOUR` and `LIVE_TOKEN_RUNS_PER_DAY` (optional); `TAVILY_API_KEY`, `TAVILY_ALLOWED_DOMAINS`, `TAVILY_CLAIM_URLS` and `TAVILY_DAILY_LIMIT` for the [public-claim check](docs/TAVILY.md). The pipeline works with its tested defaults. Optional overrides are `NEBIUS_TRIAGE_MODEL`, `NEBIUS_NARRATIVE_MODEL`, `NEBIUS_TRIAGE_REASONING_EFFORT`, `NEBIUS_NARRATIVE_REASONING_EFFORT`, `NEBIUS_STREAM` and `LIVE_RUN_BUDGET_USD`; see [Nebius setup](docs/NEBIUS.md#multi-model-pipeline--september-26-2026). See [owner setup](docs/DEPLOYMENT.md#owner-setup-for-open-live-mode) for the exact steps, including the Vercel WAF rule.

Models extract, route and explain; a separate policy determines delivery from customer-specific facts. Successful live responses expose real model/run provenance, usage and estimated cost per step. A failed extraction never silently substitutes a reference fixture; a failed triage or narrative step falls back visibly.

| Step | Model ID (default) | Verified |
| --- | --- | --- |
| Triage | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B` | Public catalog and live calls, September 26 |
| Extract | `nvidia/nemotron-3-super-120b-a12b` | Live evaluation September 19; live calls September 26 |
| Explain | `nvidia/Nemotron-3-Ultra-550b-a55b` | Public catalog and live calls, September 26 |

On September 26, four live pipeline runs with the shipped settings took 16–20 seconds and cost an estimated $0.008–$0.010 each, against a $0.0496 hard ceiling. In the final run all five Ultra briefs passed the guardrails; in earlier runs, rejected briefs fell back to labelled templates. See [the live pipeline check](docs/evaluation/PIPELINE-LIVE-2026-09-26.md). That is a smoke test, not an accuracy result.

The first live evaluation used `nvidia/nemotron-3-super-120b-a12b`. Nebius Token Factory supplies the inference API, so this prototype did not need us to provision or operate a GPU server. The web interface does not need to be hosted on Nebius: a runtime Token Factory inference call satisfies that part of the event's platform requirement. See the [verified submission checklist](docs/HACKATHON.md).

## Validate

```bash
npm run typecheck
npm run lint
npm test
npm run eval
npm run test:render
npm run test:vercel
npm run check
# Optional, billed: one live pipeline run (up to three Nemotron calls), no retries
npm run smoke:live -- --scenario=blocked --confirm
```

`test:render` builds and checks the Worker output and API routes. `eval` measures 18 deterministic rule cases, not model quality. `eval:live` runs eight development examples and a separate frozen 32-case held-out set, recording actual latency, usage, IDs and failures. It requires a Nebius key and consumes API credits. The held-out cases are assistant-authored synthetic examples, not an independent external benchmark. Without credentials the runner writes a blocked report, never a fabricated score.

## Readiness — updated September 26, 2026

| Area | Last verified state |
| --- | --- |
| Local product | Core workbench implemented; browser loading and reference evidence check verified September 19 |
| Engineering checks | September 26: 133 automated tests (pipeline, guardrails, streaming, budget, evidence registry, service), 3 Worker production tests and 6 Vercel production tests passed; type checking, lint and both builds passed |
| Live pipeline | September 26: 20 real calls across Nano, Super and Ultra while tuning; four full runs with shipped settings at 16–20 s and about $0.009 each ([report](docs/evaluation/PIPELINE-LIVE-2026-09-26.md)) |
| Real model execution | 40 requests completed; 7/8 development and 32/32 frozen held-out exact matches, one missed tentative item, no provider/validation errors |
| Model evidence | Actual latency, model/run/request IDs and usage saved; synthetic results are not independent real-world validation |
| Cost | First run's estimated trial-credit consumption: $0.025144; paid rollover was verified disabled September 19; recheck before further inference |
| Dependencies | September 20 cleanup removes unused database/auth starter code and patches the affected image parser; full npm audit reports zero advisories, not a blanket security guarantee. See the [dependency review](docs/DEPENDENCY-REVIEW-2026-09-20.md) |
| Registration and release | Registered on Devpost; consolidated source pushed to private `main`; Vercel reference demo deployed and anonymously checked; recording script ready, but video capture and final submission remain pending |

**Ready:** workbench, tested Vercel build, first measured NVIDIA-on-Nebius evaluation, and recording script. **Not ready:** hosted live inference, captured video, the complete submission package, and free live testing access through judging.

## Next for submission

1. Complete the [owner setup](docs/DEPLOYMENT.md#owner-setup-for-open-live-mode) for open live mode. No key rotation is needed, by owner decision on September 26. Reverify free credit, and rehearse the complete six-document live flow. Dependency cleanup is complete; the remaining work is focused on recording and safe AI access, not a production CRM.
2. Provide a working demo or runnable test-build URL and clear testing instructions. A hosted browser demo is our preferred convenience, not the only permitted format; Vercel is not required. Maintain free judge access through December 15, 2026, at 12 p.m. Pacific, using only verified free resources.
3. Record the [walkthrough script](docs/DEMO-SCRIPT.md), publish the video publicly on YouTube, and finish the project description and honest technology feedback.
4. With owner approval, publish the current licensed source and setup instructions, then complete and verify the Devpost submission before October 30, 2026, at 10 a.m. Pacific.

Customer-success interviews and further independent evaluation are **optional ways to strengthen the impact story**, not submission prerequisites. Do not delay the entry to build connectors or a broad research program. Do not turn the existing synthetic evaluation into a claim of general model accuracy.

## Documentation

- [Product scope](docs/SCOPE.md)
- [Design system](DESIGN.md)
- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [Hackathon strategy and release checklist](docs/HACKATHON.md)
- [Recording script and shot list](docs/DEMO-SCRIPT.md)
- [Vercel deployment and access](docs/DEPLOYMENT.md)
- [Nebius setup and evaluation](docs/NEBIUS.md)
- [Sentry runtime evidence, seeding and cron](docs/SENTRY.md)
- [Public-claim check (Tavily)](docs/TAVILY.md)
- [Dependency review and hackathon relevance](docs/DEPENDENCY-REVIEW-2026-09-20.md)
- [Security boundaries](SECURITY.md)
- [Current status](docs/STATUS.md)

React, TypeScript, Zod and Lucide sit on the Sites/Vinext structure. Local and Worker builds are preserved; the Vercel build uses the Nitro adapter. Product UI is in `app/page.tsx`, evidence logic in `lib/`, tests in `tests/`, and model development examples in `evals/`. Unused database and authentication starter examples have been removed; no database is provisioned.

## Repository and release

Repository: `assafbar2/promise-ledger`, private and linked to this working directory. On September 20 the owner authorized consolidating the work, pushing it, and deploying Promise Ledger to Vercel. Private status does not meet the hackathon's public-code requirement; ask before changing visibility.

The hosted reference preview is available, but the final submission still needs qualifying live testing access, public licensed source and a public YouTube video. The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) allow a working demo, hosted app or runnable test-build URL; they do not require Vercel. Judges may choose not to test, but working access remains required. Actual NVIDIA-on-Nebius execution is documented in the live evaluation report. Do not submit the reference-only workflow as live AI.

## License

MIT; see [LICENSE](LICENSE). The repository remains private until publication is authorized.
