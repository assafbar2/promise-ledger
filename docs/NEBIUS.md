# Live NVIDIA Nemotron integration

## Honest current state

The adapter is implemented but no Nebius credential or model was supplied. No real inference, model score, credit use or feedback is claimed. The reference demo needs no credentials.

## Setup

Finish registration and obtain Token Factory access. The registration page offers the optional Builder Program at https://dev.nebius.com/builders. No new account, credit request or paid resource was created here.

Copy `.env.example` to `.env.local` and provide:

```dotenv
NEBIUS_API_KEY=your-token-factory-key
NEBIUS_MODEL=the-exact-nvidia/Nemotron-id-available-in-your-account
DEMO_ACCESS_TOKEN=a-random-private-token-at-least-24-characters
```

The model placeholder is not a real model ID. Copy an available NVIDIA Nemotron ID from the current account instead of guessing. Restart `npm run dev`, open Demo controls, select the live engine and enter the **private demo token**, never the Nebius API key.

## Request contract

`lib/nebius.ts` calls `https://api.tokenfactory.nebius.com/v1/chat/completions` with server-side Bearer authentication and structured JSON output. It sends only the synthetic sources. The request has a 60-second timeout, bounded output tokens, and no automatic retry. The model receives no tools, API key, or private-demo token in its prompt.

Successful runs report actual provider model, run ID and usage when supplied. Truncation, refusal, invalid JSON, wrong model, missing citation, ungrounded owner/date, rate limiting or transport failure produces an explicit error. Live mode never silently falls back to reference fixtures.

## Evaluation

```bash
npm run eval
npm run eval:live
```

The first measures 18 deterministic rule cases, not AI accuracy. The second makes eight real development-set model calls, requires `.env.local`, consumes credits and writes `docs/evaluation/live-report.json`. Cases cover explicit/tentative/conditional promises, missing owners/dates, relative dates, ticket-only text and malicious document instructions.

These are development cases, not a held-out benchmark. Report misses and create an independent set before claiming accuracy. Measure unsupported citations, false delivery claims, extraction field precision/recall, refusal rate, latency and usage separately.

Before hosting, configure secrets through the host, verify runtime environment bindings, and add identity-based access and durable quotas. The prototype's shared token is not production authentication.

Primary documentation: https://docs.tokenfactory.nebius.com/ . Model availability and API features must be confirmed against the current account and official docs before the first paid run.
