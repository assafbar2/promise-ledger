# Promise Ledger — handoff

## Bottom line — September 20, 2026

**The workbench, Vercel build, and recording script are ready. The hackathon entry is not yet submission-ready.**

The owner authorized cleanup, consolidation, private-source push, and Vercel deployment under **Promise Ledger**. The Vercel project is `promise-ledger`, on the verified Hobby account. First publication verification is in progress; see [deployment and access](DEPLOYMENT.md) for the URL and current state. No paid upgrade, add-on, or other-project billing change is authorized.

The hosted release is reference-only: no provider credentials are configured. It must not be described as live AI. The exposed Nebius key remains local and ignored; never upload it.

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

These tests do not establish model accuracy, complete browser accessibility, or full live UI success. Prior browser verification covered local loading and the reference evidence-check action; broader keyboard, mobile, and contrast QA remains incomplete.

## Real model evidence already saved

September 19: all **40 actual requests** completed using `nvidia/nemotron-3-super-120b-a12b`. Development: **7/8 exact matches, one mismatch, no errors**. Frozen held-out: **32/32 exact matches, no errors**. Actual latency, usage, request/run/model IDs, and status are saved in [the report](evaluation/LIVE-RESULTS-2026-09-19.md).

Combined median latency was 3.614 seconds; estimated credit consumption was $0.025144, not a finalized invoice. These are small assistant-authored synthetic examples, not independent production-quality evidence. Preserve the tentative-item mismatch and do not tune against the observed held-out set.

## Next, in order

1. **Safe live access:** obtain approval to rotate the exposed credential. Reverify free credit, rates, and **Stop usage after trial** before any inference. Existing credit verification is stale; the console had not reconciled the first run. The CLI's $0.50 invocation guard does not protect the app endpoint or establish an account-wide cap.
2. **Recording rehearsal:** verify both complete six-document live scenarios and approval/export interactions on the build being filmed. Save genuine UI-run provenance. Never substitute reference footage for live AI.
3. **Produce the video:** record actual app footage and narration, synchronize to the [final script](DEMO-SCRIPT.md), caption it, and keep the exported video under three minutes. Get authorization before the public upload.
4. **Complete judge access:** establish no-cost live testing through December 15, 2026, at noon Pacific. Vercel is not required by the event, and a video alone is insufficient. Current Nebius trial credit does not cover the judging period.
5. **Finish submission:** obtain public-repository authorization, publish licensed source and setup instructions, add honest technology feedback, submit on Devpost, and verify confirmation before October 30, 2026, at 10 a.m. Pacific.

Devpost registration is confirmed. Separate Builder Program enrollment and extra $25 credit are not confirmed; their forms still need owner-supplied company/job details and submission approval. Do not invent those details.

Customer interviews and additional independent evaluation are optional impact-strengthening work, not entry requirements. Do not expand into a CRM platform or claim adoption, ROI, time savings, or production accuracy. No background reminder is scheduled.

## Authorization and privacy

The repository remains private. The September 20 request authorizes consolidating and pushing the current work and publishing the app to Vercel; it does not authorize making the repository public, spending money, or submitting personal registration declarations. Local credentials remain ignored with permissions 0600. The current source archive is regenerated from committed files only.
