# Architecture and trust boundaries

The application has two build targets: the retained Sites/Cloudflare Worker flow for local development and a Vercel Node function packaged by the Nitro adapter. Hosting the web app on Vercel does not move NVIDIA inference away from Nebius or turn fixture results into model results. See [deployment and access](DEPLOYMENT.md).

```text
React workbench -> POST /api/pipeline {mode, scenario}     (NDJSON event stream; /api/analyze returns the same result as JSON)
  -> strict request and same-origin checks
  -> live only: optional owner token, ONE per-IP hourly + shared daily reservation for the whole pipeline
  -> evidence providers: synthetic pack (curated facts) + Tavily public-claim check (untrusted) -> validated sources, facts, signals
  -> 1 Triage   Nemotron 3 Nano   classify + route sources          optional; falls back to "all sources"
  -> 2 Extract  Nemotron 3 Super  commitments with exact quotes     required; failure stops the run
  -> 3 Decide   deterministic rules on curated facts -> verdicts    no model; public GA claims are attached beside them
  -> 4 Explain  Nemotron 3 Ultra  explanation, customer update, owner nudge per commitment
                -> server-side guardrails per brief -> accepted, or the labelled template draft
  -> evidence brief -> editable draft -> local review -> export
```

## Components

| Location | Responsibility |
| --- | --- |
| `app/page.tsx` | Ledger, sources, review queue, session log, exports; reads the event stream |
| `app/components/agent-trace.tsx` | Live agent view: step cards, streamed quotes, verdicts and guardrail results |
| `app/components/narrative.tsx` | Claims with exact-quote disclosures, origin label, internal nudge |
| `app/components/public-claim.tsx` | The public-claim card in the evidence trail and the draft warning |
| `app/changelog/page.tsx` | Synthetic public changelog of the fictional vendor, fetched by Tavily at runtime |
| `lib/schema.ts` | Request/output schemas and shared types, including `Narrative`, `StepSummary`, `ProviderSignal` |
| `lib/evidence/` | Evidence-provider interface, registry, the built-in synthetic pack and the Tavily public-claim provider |
| `lib/public-claims/` | Tavily Extract client, allowlist, 6-hour cache and daily cap, deterministic GA-claim grounding, public-claim notes |
| `lib/pipeline/run.ts` | Orchestrator: steps, budget, deadline, fallbacks, events |
| `lib/pipeline/triage.ts`, `narrative.ts` | Prompts, input builders, routing and template narratives |
| `lib/pipeline/guardrails.ts` | Validation of model-written briefs |
| `lib/pipeline/budget.ts`, `models.ts` | Per-run worst-case cost guard, model IDs, prices, caps |
| `lib/pipeline/events.ts`, `trace-state.ts`, `quotes.ts` | Event protocol, UI reducer, streamed-citation scanner |
| `lib/nebius.ts` | Token Factory chat client (streaming or not) and the extraction call |
| `lib/reconcile.ts` | Extraction grounding, the delivery policy and template wording |
| `lib/service.ts` | Access gate, JSON and streaming endpoints |
| `lib/live-limits.ts` | Live-run rate limits: per-IP hourly, shared daily, owner-token tier |

## Essential role of AI, and what it cannot do

Three NVIDIA Nemotron models each do one job. **Nano** labels every source and routes conversations to extraction while delivery records go straight to the rules. **Super** reads the routed conversations and extracts commitments with exact quotes, as it did in the September 19 evaluation. **Ultra** runs only after the deterministic policy has set every verdict. It explains why the evidence disagrees, drafts a situation-specific customer update, and writes an internal nudge to the owner.

No model can set a product fact, change a verdict, invoke tools, or send anything. Reference mode replays the same four steps with hand-labelled fixtures and template drafts, and the UI labels it "Replayed reference trace · no AI calls". It is not evidence that a model ran.

## Guardrails

| Step | Check | On failure |
| --- | --- | --- |
| Triage | Strict schema; every supplied source classified exactly once; known feature IDs only | Every source goes to extraction; step shows "Fallback used" |
| Triage routing | Triage can only narrow what extraction reads. A recall guard always forwards sources with explicit commitment language. | — |
| Extract | Strict schema, unique IDs/features, exact account-scoped quotes, owners and dates present in the quotes | Run stops with an explicit error and a reference-mode offer. No fixture is substituted. |
| Explain | No verdict field (strict schema). Each claim cites 1–4 exact quotes, only from that commitment's evidence sources. No date, weekday or timeframe unless the claim's own citations contain it. No new promises in the customer update ("will be enabled", "guarantee", …). No delivery or access claim that contradicts the verdict or facts. No links, addresses or placeholders. | That commitment alone falls back to its template draft, labelled with the exact reason (for example "attributes a quote to SRC-01 that actually comes from SRC-06") |
| Explain call | Provider error, timeout, truncation, invalid JSON | Every commitment uses its labelled template draft |

These checks prove quote presence and rule compliance, not semantic truth. A model could still quote accurately and imply something wrong, so human review stays mandatory. Edited drafts are not re-checked.

## Streaming

`POST /api/pipeline` returns `application/x-ndjson`: one `PipelineEvent` per line (`run`, `step`, `progress`, `quote`, `verdict`, `check`, then `result` or `error`). Validation, access and rate-limit failures still return ordinary JSON errors before the stream opens.

Provider calls use `stream: true` with `stream_options.include_usage`. As Super and Ultra write, a scanner finds complete `{sourceId, quote}` objects in the partial JSON and checks each against its source. The UI shows them with "Exact match" or "Not in source". Final acceptance still depends on validating the full output. `NEBIUS_STREAM=false` switches provider streaming off; step-level events still stream.

Reference runs stream immediately. The browser paces the events so the replay can be followed, and labels the timings as illustrative.

## Evidence providers

Evidence comes from providers registered in `lib/evidence/providers/index.ts`, one line each. The interface is in `lib/evidence/types.ts`:

```ts
interface EvidenceProvider {
  id: string; label: string;
  trust: "curated" | "untrusted";    // only curated providers may return ProductFacts
  kinds: readonly SourceKind[];       // e.g. ["PublicClaim"], ["Runtime"], ["UserSupplied"]
  required: boolean;                  // a required provider's failure fails the run
  timeoutMs: number;                  // enforced by the registry, which aborts context.signal
  enabled(env, { mode, scenario }): boolean; // env present + feature flag; cheap, no side effects
  fetch(ctx: { accountId, featureIds, scenario, mode, asOf, now, signal, env }):
    Promise<{ sources: Source[]; facts?: ProductFact[]; signals?: ProviderSignal[]; provenance?: { requestId?, httpStatus?, credits?, recorded } }>;
}
```

The registry (`collectEvidence`) validates everything before any model or rule sees it:

- source IDs must be unique across providers, account-scoped, of a declared kind, bounded in size (40 sources, 8,000 characters each), with valid timestamps and HTTPS URLs;
- facts are accepted only from curated providers, and every fact and signal must cite an exact quote from that provider's own sources;
- recorded fixtures (`provenance.recorded`) are allowed in reference runs only;
- optional provider failures appear in the run's provider report, and live runs never fall back to fixtures.

`Source` carries optional `providerId`, `url` and `provenance` (`requestId`, `fetchedAt`, `httpStatus`, `credits`, `recorded`).

**Adding a provider** (Tavily public-claim check, Sentry runtime errors, user-pasted evidence): add one file under `lib/evidence/providers/`, register it in `index.ts`, and add its env names to `.env.example`. Nothing in the pipeline changes. Untrusted sources become citable in extraction and narrative automatically. Triage labels `PublicClaim` and `Runtime` sources as delivery evidence and `UserSupplied` as customer signals. Signals (`publicClaimGA`, `runtimeErrors`) are typed and validated. `reconcile()` reads `runtimeErrors` (rule 5 below; see [Sentry runtime evidence](SENTRY.md)). `publicClaimGA` is read after the verdicts, never by `reconcile()` (see [public claims](#public-claims-beside-the-verdict)). Any other signal needs its own reviewed rule. The provider research is in the project's integration plan.

## Ordered verdict policy

1. Tentative discussion remains not a promise.
2. Missing customer-specific evidence means evidence needed.
3. Invalid, future-dated or older-than-72-hour availability means evidence needed.
4. Built + explicitly disabled means delivery gap.
5. Built + enabled, but an unresolved runtime-error issue for this customer and feature seen after the acceptance snapshot and within 72 hours, means needs verification. No errors changes nothing.
6. Built + enabled + customer acceptance, all true, means verified delivered.
7. Missing or inconsistent necessary signals mean evidence needed.
8. A past UTC deadline without verified delivery means overdue.
9. Built + enabled without acceptance means needs verification.
10. Other work before the deadline means in progress, not guaranteed success.

### Public claims beside the verdict

The `tavily-public-claim` provider fetches the vendor's public changelog with Tavily Extract in live runs, or replays a recorded Tavily response in reference runs. It is untrusted, so it cannot supply facts. After the rules decide, `publicClaimNotes()` attaches a note to each committed promise whose feature the page calls generally available. The note is a **conflict** ("Publicly GA ≠ usable by this customer … Do not tell Northstar it is live.") unless the account's own evidence shows the feature enabled and the verdict is not *evidence needed*. Conflicts add a guardrail check; verdicts are identical with or without the provider. Public-claim sources are excluded from the narrative model's inputs. Details: [public-claim check](TAVILY.md).

The demo clock is fixed at September 13, 2026, 17:00 UTC. Real connectors must replace it with current, validated observations. A newer successful acceptance snapshot may supersede an earlier support complaint; the older source remains inspectable.

## Cost and time bounds per run

Each paid call reserves its worst case before dispatch. The input bound is the request's UTF-8 bytes plus 512 tokens of chat-template overhead, since every token encodes at least one byte; the output bound is the call's `max_tokens`, which also counts reasoning tokens. Calls then settle to reported usage. Room for extraction is held from the start, so optional steps cannot starve it. An optional step that doesn't fit the per-run budget (`LIVE_RUN_BUDGET_USD`, default $0.05) is skipped and labelled. Usage above its bound stops all later paid calls. The whole run has a 70-second deadline inside Vercel's 75-second function limit. See the [cost policy](COST_POLICY.md#per-run-budget-for-the-live-pipeline).

## State and deployment

Reviews and audit events are React memory only. There is no database write, localStorage retention, email sender or CRM mutation. The app exposes three narrow routes: status, analysis (JSON) and pipeline (stream). Open live mode on the synthetic demo relies on the limits in `lib/live-limits.ts`, which are durable when the free Upstash store is configured; see [deployment](DEPLOYMENT.md#open-live-mode--limits). Real-data use would still need identity-aware access, retention policy, persistent reviewer attribution and security remediation.
