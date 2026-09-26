# Changelog

## Unreleased — September 26, 2026

### Multi-model Nemotron agent pipeline

- Live mode now runs four steps. Nemotron 3 Nano triages and routes sources; Nemotron 3 Super extracts commitments, as before; deterministic rules decide verdicts; Nemotron 3 Ultra writes a why-the-evidence-disagrees explanation, a customer update and an internal owner nudge per commitment. Model IDs are configurable (`NEBIUS_TRIAGE_MODEL`, `NEBIUS_NARRATIVE_MODEL`, `off` to disable).
- Adds narrative guardrails: no verdict field; every claim cites exact quotes from that commitment's evidence; new dates, timeframes and customer-facing promises are rejected, as are delivery or access claims contradicting the facts, and links or placeholders. A failing brief falls back to a template labelled with the reason.
- Adds `POST /api/pipeline`, an NDJSON event stream. Provider calls stream with `include_usage`, and cited quotes surface and are checked while the model writes.
- Adds the live agent view: step cards with model, status, latency, tokens and cost; a cited-quote feed; verdicts and guardrail results. Reference mode replays the same trace, clearly labelled, with no AI calls.
- Adds a per-run worst-case budget (`LIVE_RUN_BUDGET_USD`, default $0.05; hard ceiling $0.0496 at defaults) and a 70-second run deadline. A full pipeline counts as one rate-limited run.
- Adds a pluggable `EvidenceProvider` interface with a validating registry; the synthetic pack is the first provider. `SourceKind` gains `PublicClaim`, `Runtime` and `UserSupplied`, and `Source` gains optional `url` and `provenance`.
- Tuned from 20 live calls: Nano and Ultra default to `reasoning_effort: "none"` (`NEBIUS_*_REASONING_EFFORT`), and prompts ask for compact JSON. Adds `npm run smoke:live` for one confirmed live run.
- Docs: the Vercel WAF rule must now match `POST /api/*` so it covers `/api/pipeline`.

- Opens live Nemotron mode to judges without a token. `DEMO_ACCESS_TOKEN` becomes an optional owner bypass with its own daily cap.
- Adds live-run limits: per-IP hourly and shared UTC-day caps, counted in free Upstash Redis when configured (failing closed if it is unreachable) and in memory otherwise.
- UI defaults to live mode when it is open, and offers a one-click reference fallback on limited or failed live runs.
- Documents the owner's zero-cash Vercel setup (environment variables, Upstash free plan, WAF rule) and the no-rotation decision.

## 0.1.1 — September 20, 2026

- Consolidates real NVIDIA-on-Nebius evaluation, trace recording, held-out cases, and credit-only safeguards.
- Adds a tested Vercel deployment target while preserving the local/Worker build.
- Removes unused database/authentication starter code and patches the vulnerable image parser; full npm audit reports zero advisories.
- Adds compiled Vercel reference/API safety tests and a Worker image-endpoint regression test.
- Replaces the walkthrough draft with a 300-word recording script, timed shot list, and honest live-capture gates.
- Updates scope, deployment, security, and submission documentation; keeps source private and hosted inference disabled until safe credentials and verified free credits are ready.

## 0.1.0 — September 13, 2026

- Initial Promise Ledger synthetic customer-success workbench and private repository.
