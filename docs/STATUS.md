# Promise Ledger — handoff

## Update — September 26, 2026: multi-model agent pipeline (branch `cursor/nemotron-agent-pipeline-a002`, [PR #2](https://github.com/assafbar2/promise-ledger/pull/2), draft)

- Live mode is a visible pipeline: Nano triage, then Super extraction, then deterministic rules, then Ultra narrative. The live agent view streams each step, and reference mode replays it with a label. See [architecture](ARCHITECTURE.md).
- Guardrails keep models from changing verdicts or inventing dates or promises; failing briefs fall back to labelled templates. Evidence providers are pluggable.
- Checked: `npm run check` (133 tests plus 3 Worker tests) and `npm run test:vercel` (6 tests) pass. 20 real Token Factory calls on the trial credit (about $0.092 estimated); four full runs with shipped settings took 16–20 s at about $0.009 each ([report](evaluation/PIPELINE-LIVE-2026-09-26.md)). Browser check of live and reference modes, desktop and 390 px.
- **Owner actions after merge:** no new required variables; the defaults are tested. If the Vercel WAF rule exists, change its path condition to "starts with `/api/`" (the UI now posts to `/api/pipeline`). Recalculate `LIVE_RUNS_PER_DAY` with the new $0.05 per-run ceiling ([cost policy](COST_POLICY.md#per-run-budget-for-the-live-pipeline)). The key-after-trial question for Nebius support still decides whether live mode survives October 18.
- The video's live beat should now show the agent panel. The script narration still describes the single extraction call and needs an owner-approved revision.

## Update — September 26, 2026: open, rate-limited live mode

Owner decisions: judges must be able to use **live Nemotron mode with no token**, protected by rate limits; the existing Nebius key is **not rotated**; the zero-cash policy still applies.

Implemented on branch `cursor/open-rate-limited-live-mode-d733` ([PR #1](https://github.com/assafbar2/promise-ledger/pull/1)), not yet merged or deployed:

- Live mode no longer requires `DEMO_ACCESS_TOKEN`. The token is now an optional owner bypass with its own daily cap.
- The UI selects live mode by default when the server reports open live access. Reference mode stays one click away and is offered automatically whenever a live run is limited or fails.
- Anonymous live runs are limited to 5 per connection per hour and 30 per UTC day overall. With Upstash Redis on the free plan the counters are durable; without it they are in-memory per instance. The WAF rule is a recommended edge backstop. See [limits and owner setup](DEPLOYMENT.md#open-live-mode--limits).
- Tests: `npm run check` passes (91 unit and service tests, 3 Worker tests) and `npm run test:vercel` passes 5 tests, including the compiled live gate.

**Still required before judges see live mode:** the owner completes the [setup steps](DEPLOYMENT.md#owner-setup-for-open-live-mode): Nebius stop-usage check, Upstash free database, the Vercel variables `NEBIUS_API_KEY`, `NEBIUS_MODEL`, `KV_REST_API_URL` and `KV_REST_API_TOKEN` (optionally `DEMO_ACCESS_TOKEN`, `LIVE_RUNS_PER_DAY`, `LIVE_RUNS_PER_IP_PER_HOUR`, `LIVE_TOKEN_RUNS_PER_DAY`), the WAF rule, a redeploy, and verification. Credit through December 15 is still unfunded: the $1 trial ends around October 18.

**Accepted risk (no rotation):** the key was pasted into chat on September 19. Because it will not be rotated, anyone who obtained it could spend its credits outside this app, and the app's limits cannot prevent that. Nebius **Stop usage after trial** keeps cash spend at $0 either way. Store the key only as a Sensitive Production variable on Vercel.

## Bottom line — September 20, 2026

**The workbench, Vercel build, and recording script are ready. The hackathon entry is not yet submission-ready.**

The owner authorized cleanup, consolidation, private-source push, and Vercel deployment under **Promise Ledger**. The consolidated release is pushed to private `main` and deployed as `promise-ledger` on the verified Hobby account. **https://promise-ledger-chi.vercel.app** passed anonymous HTTP checks: homepage, six assets, all three reference scenarios, and API safety checks. See [deployment and access](DEPLOYMENT.md) and the [saved smoke report](DEPLOYMENT-SMOKE-2026-09-20.json). No paid upgrade, add-on, or other-project billing change was made.

The hosted release is reference-only: no provider credentials are configured. It must not be described as live AI. As of September 20 the Nebius key was local and ignored. After September 26 it may be added only as a Sensitive Production variable in the Vercel dashboard, per the owner setup; never commit it or paste it anywhere else.

## Implemented and checked

- One fictional customer, six synthetic documents, five commitments and one tentative discussion.
- Ledger, evidence trail, source library, review queue, session activity, and exports.
- Separate built/enabled/customer-verified rules and three replayable scenarios.
- Editable template drafts; local approval clears on edits or new analysis; no automatic sending.
- Server-side NVIDIA Nemotron extraction on Nebius, exact-source validation, and explicit failures.
- Vercel Nitro adapter without replacing the working local/Worker flow.
- Unused database/auth starter code removed; patched image parser; full npm audit reports zero advisories, not a general security guarantee.
- Recording script locked at 300 spoken words, with a 2:45 target, shot list, voice direction, and capture gates. No footage, audio, or video upload exists yet.

| September 20 check | Result |
| --- | --- |
| TypeScript and lint | Pass |
| Unit/service/provider/evaluation/budget tests | 73 passed |
| Compiled Worker tests | 3 passed |
| Compiled Vercel tests | 4 passed |
| Deterministic rule cases | 18/18 passed |
| Worker and Vercel builds | Pass |
| Full npm audit after cleanup | Zero advisories |
| Anonymous production smoke checks | 13 passed; zero provider calls |

These tests do not establish model accuracy, complete browser accessibility, or full live UI success. Prior browser verification covered local loading and the reference evidence-check action; broader keyboard, mobile, and contrast QA remains incomplete.

## Real model evidence already saved

September 19: all **40 actual requests** completed using `nvidia/nemotron-3-super-120b-a12b`. Development: **7/8 exact matches, one mismatch, no errors**. Frozen held-out: **32/32 exact matches, no errors**. Actual latency, usage, request/run/model IDs, and status are saved in [the report](evaluation/LIVE-RESULTS-2026-09-19.md).

Combined median latency was 3.614 seconds; estimated credit consumption was $0.025144, not a finalized invoice. These are small assistant-authored synthetic examples, not independent production-quality evidence. Preserve the tentative-item mismatch and do not tune against the observed held-out set.

## Next, in order

1. **Safe live access:** superseded September 26. The key is not rotated by owner decision, and open live mode is rate-limited in code; see the update above. Still reverify free credit, rates, and **Stop usage after trial** before enabling it. Existing credit verification is stale; the console had not reconciled the first run. The CLI's $0.50 invocation guard does not protect the app endpoint; the app's own per-IP and daily limits do.
2. **Recording rehearsal:** verify both complete six-document live scenarios and approval/export interactions on the build being filmed. Save genuine UI-run provenance. Never substitute reference footage for live AI.
3. **Produce the video:** record actual app footage and narration, synchronize to the [final script](DEMO-SCRIPT.md), caption it, and keep the exported video under three minutes. Get authorization before the public upload.
4. **Complete judge access:** the tokenless, rate-limited live mode is built. Enable it with the [owner setup](DEPLOYMENT.md#owner-setup-for-open-live-mode) and keep it funded at no cost through December 15, 2026, at noon Pacific. Vercel is not required by the event, and a video alone is insufficient. Current Nebius trial credit does not cover the judging period.
5. **Finish submission:** obtain public-repository authorization, publish licensed source and setup instructions, add honest technology feedback, submit on Devpost, and verify confirmation before October 30, 2026, at 10 a.m. Pacific.

Devpost registration is confirmed. Separate Builder Program enrollment and extra $25 credit are not confirmed; their forms still need owner-supplied company/job details and submission approval. Do not invent those details.

Customer interviews and additional independent evaluation are optional impact-strengthening work, not entry requirements. Do not expand into a CRM platform or claim adoption, ROI, time savings, or production accuracy. No background reminder is scheduled.

## Authorization and privacy

The repository remains private. The September 20 request authorizes consolidating and pushing the current work and publishing the app to Vercel; it does not authorize making the repository public, spending money, or submitting personal registration declarations. Local credentials remain ignored with permissions 0600. The current source archive is regenerated from committed files only.
