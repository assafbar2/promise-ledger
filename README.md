# Promise Ledger

**What you promised. What shipped. What your customer can actually use.**

An evidence-first customer-success workbench for the Nebius × NVIDIA Global AI Hackathon, Best Apps and Agents track.

Engineering closes an audit-export ticket, but Northstar's feature flag is still off. Promise Ledger exposes the gap, shows the original promise and conflicting evidence, and prepares an accurate customer update for human review. Nothing sends automatically.

> **Status:** the synthetic workbench and Vercel build are implemented. The first hosted release is reference-only: no provider key is deployed and no inference credits are consumed. Real NVIDIA-on-Nebius evaluation completed separately on September 19, 2026: 7/8 development and 32/32 frozen held-out exact matches, with no provider/validation errors. These synthetic cases do not establish real-world model quality. See [the measured results](docs/evaluation/LIVE-RESULTS-2026-09-19.md), [deployment and access](docs/DEPLOYMENT.md), and [current handoff](docs/STATUS.md). The hackathon submission is not complete.

## Goal

Help a customer-success manager answer: **“Can I truthfully tell this customer we delivered what we promised?”**

Our hackathon goal is a strong, distinctive Best Apps and Agents entry, with **$0 out-of-pocket spending**. The distinction is simple: engineering finished does not mean this customer can use the feature. Promise Ledger makes that difference visible and helps a human prepare an accurate update.

## Current scope

One fictional account, a fixed synthetic evidence pack and three scenarios: customer access disabled, successful customer acceptance, and stale evidence. NVIDIA Nemotron extracts commitments from conversations; separate rules check built, enabled and customer-verified facts. The workbench connects the ledger, exact source quotes, evidence review, editable drafts and exports.

This is not a full customer-success platform. There are no live CRM/support connectors, arbitrary customer uploads, persistent records, multi-customer tenancy, background monitoring or outbound sending. The customer-update wording is template-generated, not a second model call. These exclusions are deliberate, not missing hackathon requirements.

## Run locally

Requires Node.js 22.13 or later and npm.

```bash
npm ci
npm run dev
```

Open the exact local URL printed by the server. No credentials are needed for the reference workflow. Select **Run evidence check**; change the scenario to see the same promise become verified or lose its proof when evidence becomes stale.

## Working features

Try the hosted reference demo: **https://promise-ledger-chi.vercel.app**. The Vercel project is **promise-ledger**, on the owner's verified Hobby account; the homepage and all three reference scenarios passed anonymous HTTP checks on September 20. See [deployment and access](docs/DEPLOYMENT.md). The repository remains private. Live extraction stays disabled on Vercel until a rotated server-side key, separate access token, and verified free-credit protection are in place.

- Searchable, filterable commitment ledger with owners, dates and seven conservative verdicts.
- Exact source quotations and separate customer-specific built, enabled and verified checks.
- Six synthetic source documents and three replayable evidence scenarios.
- Editable customer drafts, explicit local review and export.
- Source library and exportable session activity.
- Source validation and server-side Nebius integration with explicit failure handling.

Northstar and everyone in its evidence pack are fictional. The snapshot is fixed to September 13, 2026. Reviews and activity live in memory: refreshing clears them, so export first. No real CRM, support or telemetry service is connected.

## NVIDIA Nemotron on Nebius

Follow [live setup](docs/NEBIUS.md). Provide a real Nebius key, an available NVIDIA Nemotron model ID and a separate private-demo access token in ignored `.env.local`. Restart the server and select live mode. Never put the Nebius API key in the browser.

The model extracts commitments; a separate policy determines delivery from customer-specific facts. Successful live responses expose real model/run provenance. Failures do not silently substitute a reference fixture.

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
```

`test:render` builds and checks the Worker output and API routes. `eval` measures 18 deterministic rule cases, not model quality. `eval:live` runs eight development examples and a separate frozen 32-case held-out set, recording actual latency, usage, IDs and failures. It requires a Nebius key and consumes API credits. The held-out cases are assistant-authored synthetic examples, not an independent external benchmark. Without credentials the runner writes a blocked report, never a fabricated score.

## Readiness — September 20, 2026

| Area | Last verified state |
| --- | --- |
| Local product | Core workbench implemented; browser loading and reference evidence check verified September 19 |
| Engineering checks | September 20: 73 automated tests, 3 Worker production tests, 4 Vercel production tests and 18 rule cases passed; type checking, lint and both builds passed |
| Real model execution | 40 requests completed; 7/8 development and 32/32 frozen held-out exact matches, one missed tentative item, no provider/validation errors |
| Model evidence | Actual latency, model/run/request IDs and usage saved; synthetic results are not independent real-world validation |
| Cost | First run's estimated trial-credit consumption: $0.025144; paid rollover was verified disabled September 19; recheck before further inference |
| Dependencies | September 20 cleanup removes unused database/auth starter code and patches the affected image parser; full npm audit reports zero advisories, not a blanket security guarantee. See the [dependency review](docs/DEPENDENCY-REVIEW-2026-09-20.md) |
| Registration and release | Registered on Devpost; consolidated source pushed to private `main`; Vercel reference demo deployed and anonymously checked; recording script ready, but video capture and final submission remain pending |

**Ready:** workbench, tested Vercel build, first measured NVIDIA-on-Nebius evaluation, and recording script. **Not ready:** hosted live inference, captured video, the complete submission package, and free live testing access through judging.

## Next for submission

1. Rotate the exposed provider credential with owner approval, reverify free credit, and rehearse the complete six-document live flow. Dependency cleanup is complete; the remaining work is focused on recording and safe AI access, not a production CRM.
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
- [Dependency review and hackathon relevance](docs/DEPENDENCY-REVIEW-2026-09-20.md)
- [Security boundaries](SECURITY.md)
- [Current status](docs/STATUS.md)

React, TypeScript, Zod and Lucide sit on the Sites/Vinext structure. Local and Worker builds are preserved; the Vercel build uses the Nitro adapter. Product UI is in `app/page.tsx`, evidence logic in `lib/`, tests in `tests/`, and model development examples in `evals/`. Unused database and authentication starter examples have been removed; no database is provisioned.

## Repository and release

Repository: `assafbar2/promise-ledger`, private and linked to this working directory. On September 20 the owner authorized consolidating the work, pushing it, and deploying Promise Ledger to Vercel. Private status does not meet the hackathon's public-code requirement; ask before changing visibility.

The hosted reference preview is available, but the final submission still needs qualifying live testing access, public licensed source and a public YouTube video. The [official rules](https://nebiusglobalaihackathon.devpost.com/rules) allow a working demo, hosted app or runnable test-build URL; they do not require Vercel. Judges may choose not to test, but working access remains required. Actual NVIDIA-on-Nebius execution is documented in the live evaluation report. Do not submit the reference-only workflow as live AI.

## License

MIT; see [LICENSE](LICENSE). The repository remains private until publication is authorized.
