# Live pipeline evaluation — September 27, 2026

The first accuracy evaluation of the **full three-model pipeline**. Each case goes through Nemotron 3 Nano triage, Nemotron 3 Super extraction, the deterministic rules, and Nemotron 3 Ultra briefs, exactly as in the app. It ran once on the development set and then once on the frozen held-out set, in a single guarded invocation (`npm run eval:pipeline`). The cases are **synthetic and assistant-authored**. The held-out set was frozen on September 19 and had already been observed once, by the extraction-only evaluation. These results say how the pipeline behaves on these cases. They do not establish real-world accuracy.

## Headline

| Measure | Development (9 cases) | Frozen held-out (32 cases) |
| --- | ---: | ---: |
| Exact-set extraction matches | **9 / 9** | **31 / 32** (96.9%) |
| Mismatches | 0 | 0 |
| Errors (grounding rejections) | 0 | 1 (`hold-18`) |
| Ultra briefs accepted by the guardrails | **10 / 10** | **16 / 16** |
| Nano triage validated (no fallback) | 9 / 9 | 31 / 31 recorded (`hold-18` not recorded) |
| Recall guard kept a source triage had skipped | 2 | 3 |
| Conversation sources triage kept from extraction | 0 | 2 (both correctly empty cases) |
| End-to-end latency per case, p50 / max | 6.4 s / 14.4 s | 5.2 s / 8.0 s |
| Calls (Nano / Super / Ultra) | 9 / 9 / 6 | 32 / 32 / 15 |
| Estimated cost (guard, catalog rates) | $0.024223 | $0.049426 |

*Exact match* means the pipeline's final commitment set (feature, intent, owner, due date), after triage routing and Super extraction, equals the expected set exactly. Extra, missing or wrong items all count as misses. Errors count against the rate. *Brief acceptance* means Ultra's draft passed every deterministic guardrail: exact citations, no new dates or promises, and the verdict unchanged. It is not a human quality review. Ultra is called only when the rules produce at least one **committed** item, so empty and tentative-only cases make no Ultra call.

Accepted-output metrics for the other 31 held-out cases were perfect: feature precision 1.0, recall 1.0, and field accuracy 1.0.

## Misses and caveats

- **`hold-18` (multiple features in one source) failed source validation.** Super's output for "Leila Marin … SAML SSO … by 2026-10-02. Owen Hart … SCIM provisioning … by 2026-10-07" did not pass the grounding check, which requires exact quotes and owners and dates present in the quotes. The run rejected it rather than accept ungrounded output, so the case scores as an error. This case passed in the September 19 extraction-only run with prompt v2. One sample can't tell whether prompt v3, routing or run-to-run variance caused it. The harness did not keep that case's per-step usage; its Nano and Super calls are included in the guard totals below. After the run, the harness was changed so errored cases keep the steps and usage they reached.
- **Two held-out conversation sources never reached Super.** Nano labelled `hold-10` (irrelevant meeting) as `other` and `hold-17` (misleading engineering fields) as `delivery-evidence`, and the recall guard did not keep them. Both expected an empty set, so the outcome is correct, but through routing, not through Super. Triage labels were noisy in other ways too. For example, the demo pack's SAML confirmation was labelled `delivery-evidence` and was kept only by the recall guard.
- **Tentative items.** The demo pack's "custom dashboard" discussion and the held-out tentative cases (`hold-05`, `-06`, `-07`, `-16`, `-28`, `-31`) all passed in this run. Before prompt v3, the development measurement below showed Super dropping the dashboard item in 4 of 4 isolated calls.
- **Brief acceptance has limits.** 26 of 26 accepted briefs show the guardrails found nothing to reject. They do not show the briefs were good. The verdict mix Ultra saw was blocked 12, on-track 7, verify 4, verified 2 and overdue 1, driven by the fixed availability snapshot described below.
- **Small, synthetic, assistant-authored.** Both sets and the availability snapshot were written by an AI assistant. The held-out set is now observed for the second time. Any further claim needs a new, preferably independently authored, held-out set.

## What ran

- **Cases.** Development: the eight September 19 extraction examples (dataset SHA-256 `54bef1bb…cb92b8`, unchanged) plus the app's own Northstar demo pack in its blocked scenario (six sources, six hand-labelled commitments). Held-out: the 32 frozen cases. The runner checked their fingerprint `041ae0b4…b265` against `evals/held-out-manifest.json` before any call.
- **Evidence per case.** Each case's own sources, unchanged, plus one fixed curated availability snapshot (`EVAL-DELIVERY`, kind Availability, observed 15 minutes before the case's as-of time). It holds audit-export built but off, EU residency and usage report not built, SCIM enabled but unverified, and SAML verified. There is no dashboard record. The rules read facts only from it. The demo pack uses its own facts. The as-of time is `2026-09-13T17:00Z` for development and `2026-09-19T17:00Z` for held-out.
- **Pipeline.** The unmodified `executePipeline` in live mode with an evaluation-only evidence override, streaming as the app does, and the shipped defaults: Nano and Ultra with `reasoning_effort: "none"`, Super with its default reasoning, a $0.05 per-case run budget and a 70-second deadline. There were no retries.
- **Prompts.** Triage `source-triage-v1`, extraction **`commitment-extraction-v3`** (SHA-256 `224ac6e9…22d5`), and narrative `evidence-narrative-v1`.
- **Models, requested and reported.** `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/nemotron-3-super-120b-a12b` and `nvidia/Nemotron-3-Ultra-550b-a55b`, on `api.tokenfactory.nebius.com`.
- **Timing.** The final invocation started at `2026-09-27T02:27:51Z`, finished development at 02:28:52 and held-out at 02:31:24.

## Development-only iteration before the final run

No held-out result was inspected or used before the final run. The held-out case texts were read while building the harness, but no prompt wording was taken from them.

1. **Baseline, prompt v2, non-streaming (scratch).** 9/9 matches and 10/10 briefs, but Nano triage fell back in 9/9 cases. Cause: without streaming, Token Factory returns Nano's answer (at `reasoning_effort: "none"`) in `message.reasoning` with `content: null`. The adapter correctly rejects that as incomplete, and routing falls back to all sources. The app streams by default and is unaffected. At the time, **setting `NEBIUS_STREAM=false` silently disabled triage**; that was fixed later the same day ([crashing briefs](CRASHING-BRIEFS-2026-09-27.md)). The pipeline evaluation now streams, and the guard reconciles usage from the stream's final usage chunk.
2. **Baseline, prompt v2, streaming (scratch).** 9/9 matches, 10/10 briefs, and triage validated 9/9.
3. **Tentative-item measurement.** Four repeats of Super-only extraction on three development inputs: the demo pack's routed conversation sources, `dev-conditional` and `dev-tentative`.

| Prompt | Pack dashboard kept | `dev-conditional` tentative | `dev-tentative` |
| --- | ---: | ---: | ---: |
| v2 (September 19) | 0/4 | 4/4 | 4/4 |
| **v3 (shipped)** | **4/4** | 3/4 | 4/4 |
| v3 variant: "conditional possibility … not a commitment" | 1/4 | 4/4 | 4/4 |
| v3 variant: both clauses | 3/4 | 3/4 | 4/4 |

Four repeats are noisy, so iteration stopped at the best-scoring development variant rather than chase noise. Prompt v3 adds two sentences: tentative records belong in the same array, and when a source mixes firm commitments with an idea still under discussion, the idea is its own tentative record. A note that no commitment, owner or date was agreed makes an idea tentative instead of removing it.

## Spend — everything this work sent to Nebius

These CLI calls go straight to Nebius. They are **not** counted by the app's durable lifetime spend cap ([`LIVE_SPEND_CAP_USD`](../COST_POLICY.md#lifetime-live-spend-cap)), so subtract them from the credit figure the cap is based on. Every call went through the evaluation guard. Costs are the guard's usage-based estimates at catalog rates, rounded up to a microdollar per call. They are not invoices. No call had uncertain usage.

| Invocation (UTC, Sep 27) | Calls (Nano/Super/Ultra) | Input tokens | Output tokens | Estimated cost |
| --- | ---: | ---: | ---: | ---: |
| 02:12 dev baseline, non-streaming (scratch) | 24 (9/9/6) | 17,604 | 12,149 | $0.025536 |
| 02:17 Nano debug probes, same triage input | 4 (4/0/0) | 1,880 | 340 | $0.000196 |
| 02:19 dev baseline, streaming (scratch) | 24 (9/9/6) | 15,892 | 10,965 | $0.023557 |
| 02:21–02:27 tentative measurements, 4 × 12 | 48 (0/48/0) | 28,868 | 51,624 | $0.055143 |
| **02:27 final: development, then held-out** | **103 (41/41/21)** | **62,515** | **34,819** | **$0.073649** |
| **Total** | **203 (63/107/33)** | **126,759** | **109,897** | **$0.178081** |

Tokens per model over all calls: Nano 31,270 in and 5,658 out; Super 60,285 in and 91,067 out (much of it reasoning); Ultra 35,204 in and 13,172 out. Total estimated spend was $0.178 of the $1.50 allowed for this work. Each invocation's guard budget was at most $0.50.

**Verification.** Before every invocation the public catalog (`https://tokenfactory.nebius.com/api/public/models_info`) was re-read and checked automatically. It showed Nano $0.06/$0.24 per million input/output tokens with a 262,144-token context, Super $0.30/$0.90 with 262,144, and Ultra $1/$3 with 1,048,576. The guard verification timestamp was set from that check: `2026-09-27T02:27:50Z` for the final run. The $50 promotional credit and the active trial (until about October 18) are the owner's statement, not an independent console check by this run.

## Evidence files

- [Development report](runs/2026-09-27T02-27-51-059Z/pipeline-development.json), also [`pipeline-development-latest.json`](pipeline-development-latest.json)
- [Frozen held-out report](runs/2026-09-27T02-27-51-059Z/pipeline-held-out.json), also [`pipeline-held-out-latest.json`](pipeline-held-out-latest.json)

Each case records expected and actual sets, Nano's validated labels and the routing rebuilt from them, per-step status, model, latency, usage and cost, and each brief's verdict, acceptance or fallback reason and customer-update text. The scratch and tuning runs stay in the ignored `outputs/` directory. The September 19 extraction-only reports (`development-latest.json`, `held-out-latest.json`) were not rerun and are unchanged.
