# Architecture and trust boundaries

The application has two build targets: the retained Sites/Cloudflare Worker flow for local development and a Vercel Node function packaged by the Nitro adapter. The Vercel reference release has no provider credentials. Hosting the web app on Vercel does not move NVIDIA inference away from Nebius or turn fixture results into model results. See [deployment and access](DEPLOYMENT.md).

```text
React workbench -> POST /api/analyze {mode, scenario}
  -> strict request and same-origin checks
  -> live only: optional owner token, per-IP hourly + shared daily limits (Upstash or memory)
  -> server-owned synthetic source pack
  -> reference labels OR NVIDIA Nemotron extraction on Nebius
  -> strict schema + exact account-scoped source validation
  -> deterministic customer-availability policy
  -> evidence brief -> editable draft -> local review -> export
```

## Components

| Location | Responsibility |
| --- | --- |
| `app/page.tsx` | Ledger, sources, review queue, session log and exports |
| `lib/schema.ts` | Request/output schemas and shared types |
| `lib/fixtures.ts` | Synthetic account, source pack, facts and scenarios |
| `lib/nebius.ts` | Server-side provider call and failure handling |
| `lib/reconcile.ts` | Grounding checks, delivery policy and template drafts |
| `lib/service.ts` | Input validation, live access gate and analysis assembly |
| `lib/live-limits.ts` | Live-run rate limits: per-IP hourly, shared daily, owner-token tier; Upstash REST or in-memory counters |
| `evals/`, `scripts/evaluate.ts` | Rule tests and separate live extraction evaluation |

## Essential role of AI

Nemotron interprets unstructured conversations and separates explicit commitments from tentative discussion. It cannot set trusted availability facts, invent source quotes, invoke tools or send messages. The reference demo intentionally bypasses extraction with hand-labeled records; it is not evidence that an NVIDIA model has run.

## Ordered verdict policy

1. Tentative discussion remains not a promise.
2. Missing customer-specific evidence means evidence needed.
3. Invalid, future-dated or older-than-72-hour availability means evidence needed.
4. Built + explicitly disabled means delivery gap.
5. Built + enabled + customer acceptance, all true, means verified delivered.
6. Missing or inconsistent necessary signals mean evidence needed.
7. A past UTC deadline without verified delivery means overdue.
8. Built + enabled without acceptance means needs verification.
9. Other work before the deadline means in progress, not guaranteed success.

The demo clock is fixed at September 13, 2026, 17:00 UTC. Real connectors must replace it with current, validated observations. A newer successful acceptance snapshot may supersede an earlier support complaint; the older source remains inspectable.

## Evidence validation

The server chooses documents; arbitrary browser uploads and URLs are rejected. Accepted records have known feature IDs, unique identifiers/features and exact quotes from the correct account. Non-null owners and dates must appear in the quotations. These checks prove quotation presence, not semantic correctness: the model could still misunderstand a negation. Human review and live evaluations remain necessary.

Product facts are curated server-side fixtures, not keyword matches or LLM assertions. Real telemetry requires authorization, account mapping and timestamp contracts before becoming trusted evidence.

## State and deployment

Reviews and audit events are React memory only. There is no database write, localStorage retention, email sender or CRM mutation. Bundled Sites/Vinext worker infrastructure is preserved; starter D1 examples are unused. The app exposes two narrow routes: status and analysis.

No hosting action completed: private Sites publishing tools were unavailable. A successful Worker build is not a live deployment. Open live mode on the synthetic demo relies on the limits in `lib/live-limits.ts`, which are durable when the free Upstash store is configured; see [deployment](DEPLOYMENT.md#open-live-mode--limits). Real-data use would still need identity-aware access, retention policy, persistent reviewer attribution and security remediation.
