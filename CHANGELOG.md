# Changelog

## Unreleased — September 26, 2026

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
