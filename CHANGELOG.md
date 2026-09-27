# Changelog

## Unreleased — September 27, 2026

### Pipeline evaluation

- **`npm run eval:pipeline`** evaluates the whole Nano → Super → rules → Ultra pipeline per case, on the development set plus the Northstar demo pack and on the frozen held-out set. It scores exact-set extraction and Ultra brief acceptance, and records Nano's routing. Results from September 27: 9/9 development and 31/32 held-out exact matches, 26/26 briefs accepted, 203 calls, about $0.178. See [the report](docs/evaluation/PIPELINE-EVAL-2026-09-27.md).
- The evaluation budget guard takes verified per-model prices (`NEBIUS_EVAL_PRICES`), a per-case reservation plan, and a guarded `fetch` that reconciles JSON and streamed usage.
- Extraction prompt `commitment-extraction-v3`: a tentative idea that shares a source with firm commitments is kept as its own tentative record. Tuned on development inputs only.
- `npm run eval` no longer rewrites `docs/evaluation/reference-report.json` on a clean checkout. `eval:live` and `eval:pipeline` write blocked and partial runs to the ignored `outputs/evaluation/runs/`, and only a complete run updates `*-latest.json`.
- Known issue: `NEBIUS_STREAM=false` makes Nano triage fall back to all sources, because Token Factory returns its non-streamed answer in `message.reasoning`.


### Bring-your-own evidence, sample accounts, workspaces and tour

- **Bring-your-own evidence** as a new `user-supplied` evidence provider. Paste text or drop `.txt`, `.md`, `.csv` or `.eml` files: up to 8 sources, 6,000 bytes each and 10,000 total, measured as JSON-encoded UTF-8. Text only, no URL is ever fetched, hidden and control characters are stripped, and text addressed to an AI is flagged. Nemotron 3 Super proposes commitments **and** availability facts with exact quotes (prompt `byo-commitments-and-facts-v1`), and ungrounded items are dropped and reported. The person confirms or corrects each fact before the unchanged deterministic rules decide. Unconfirmed facts are ignored, and the server re-checks every quote. Reference mode uses a no-AI pattern matcher.
- **One run, one budget:** a live BYO extraction reserves one live run. The decide step (rules plus Ultra) presents an HMAC-signed, source-bound, single-use, 30-minute continuation instead of a second run, and gets only what is left of `LIVE_RUN_BUDGET_USD`. Caps are enforced before any reservation, and a test proves the worst case stays at $0.0496.
- **Sample account gallery:** Harbor Health (healthcare), Ridgeway Freight (logistics) and Lumen Credit Union (banking) join Northstar. Each has its own synthetic pack, reference commitments and curated facts, and one click loads its reference result. Together they produce all seven verdicts. Requests take an `account`. Prompts, allowed features, next steps, drafts and the access guardrail use the account's name. `crashing` stays Northstar-only.
- **Workspaces persist in the browser** (localStorage, validated on load, size-bounded), with export all, delete one and clear all.
- **First-run guided tour:** five steps, about 20 seconds, keyboard accessible, and reopenable from the sidebar.
- Pipeline: new `proposal` event; step engines `pattern` and `confirmed`; `Analysis.account` and `Analysis.byo`; `ProductFact.confirmation`; `reconcile(…, runtime, accountName)`; triage and extraction accept open feature slugs for user-supplied evidence. The registry's default provider list is account-scoped (`providersFor`).
- Live check on September 26: 6 real calls, 18,091 tokens, about $0.018. See [the BYO live check](docs/evaluation/BYO-LIVE-2026-09-26.md).

### Public-claim check (Tavily)

- Adds the `tavily-public-claim` evidence provider. Live runs fetch the fictional vendor's public changelog (`/changelog`, served by the app) with a basic Tavily Extract call. Reference runs replay a genuine recorded Tavily response for that page (labelled "Recorded Tavily response") with no live call.
- Claims are detected deterministically and accepted only as exact quotes of the fetched text, never Tavily's generated answers. The allowlist is re-checked on returned URLs, and failures show "Public claim not checked" with no fixture fallback.
- A public GA claim never changes a verdict. It adds a "Publicly GA ≠ usable by this customer" note and guardrail check when the account can't use the feature, and public-claim sources are kept out of the narrative model's inputs.
- UI: the agent view now shows external provider outcomes (reusing `ProviderStatus`). The evidence trail shows a "Public claim, not customer evidence" card with the Tavily request ID, the draft editor warns on conflicts, and public-claim source cards reuse `SourceOrigin` and are labelled as not customer evidence.
- Cost guards: 6-hour cache, `TAVILY_DAILY_LIMIT` (default 20, fail closed), free plan with pay-as-you-go off. New env vars: `TAVILY_API_KEY`, `TAVILY_ALLOWED_DOMAINS`, `TAVILY_CLAIM_URLS`, `TAVILY_DAILY_LIMIT`.
- `EvidenceError` moves to `lib/evidence/errors.ts`, still re-exported by the registry, so providers can import it without an import cycle.

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
