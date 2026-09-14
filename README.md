# Promise Ledger

**What you promised. What shipped. What your customer can actually use.**

An evidence-first customer-success workbench for the Nebius × NVIDIA Global AI Hackathon, Best Apps and Agents track.

Engineering closes an audit-export ticket, but Northstar's feature flag is still off. Promise Ledger exposes the gap, shows the original promise and conflicting evidence, and prepares an accurate customer update for human review. Nothing sends automatically.

> **Status:** the first local implementation works. Its default is a labeled synthetic reference demo, not live AI. The real Nebius/Nemotron adapter is implemented but has not been exercised without credentials. Registration, hosted judge access and final submission remain pending. See [the handoff](docs/STATUS.md).

## Run locally

Requires Node.js 22.13 or later and npm.

```bash
npm ci
npm run dev
```

Open the exact local URL printed by the server. No credentials are needed for the reference workflow. Select **Run evidence check**; change the scenario to see the same promise become verified or lose its proof when evidence becomes stale.

## Working features

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

## Validate

```bash
npm run typecheck
npm run lint
npm test
npm run eval
npm run test:render
npm run check
```

`test:render` builds and checks the Worker output and API routes. `eval` measures 18 deterministic rule cases, not model quality. `eval:live` requires `.env.local`, makes eight real development-set calls and consumes API credits. It is not a held-out benchmark.

## Documentation

- [Product scope](docs/SCOPE.md)
- [Design system](DESIGN.md)
- [Architecture and trust boundaries](docs/ARCHITECTURE.md)
- [Hackathon strategy and release checklist](docs/HACKATHON.md)
- [Three-minute demo script](docs/DEMO-SCRIPT.md)
- [Nebius setup and evaluation](docs/NEBIUS.md)
- [Security boundaries](SECURITY.md)
- [Current status](docs/STATUS.md)

React, TypeScript, Zod and Lucide sit on the bundled Sites/Vinext Worker structure. Product UI is in `app/page.tsx`, evidence logic in `lib/`, tests in `tests/`, and model development examples in `evals/`. Starter database examples are not active storage.

## Repository and release

Repository: `assafbar2/promise-ledger`, private and linked to this working directory. The owner authorized the initial source commit and push to `main`. Private status does not meet the hackathon's public-code requirement; ask before changing visibility.

A working hosted demo, actual NVIDIA-on-Nebius execution and public video are still required. Local build success is not deployment. Do not submit the reference-only workflow as live AI.

## License

MIT; see [LICENSE](LICENSE). The repository remains private until publication is authorized.
