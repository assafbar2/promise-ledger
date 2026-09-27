# Crashing-scenario extraction failures — September 27, 2026

After [the crashing-brief fix](CRASHING-BRIEFS-2026-09-27.md) shipped, a production check ran the Northstar **Enabled, but crashing** pack twice. One run was clean. In the other, Super's extraction failed with "Model output failed source validation", and the whole run fell back. This was reproduced and fixed on development data only: the app's own demo pack, with the recorded Sentry and public-claim responses.

## Result

| Crashing pack, live, full pipeline | Runs that completed | Exact extraction | Ultra briefs accepted |
| --- | ---: | ---: | ---: |
| Before, as deployed (Ultra off, 8 runs) | **4 / 8** | 4 / 8 | — |
| Speaker-label repair and per-commitment grounding (10 runs) | 10 / 10 | 9 / 10 | 48 / 49 |
| Plus source re-attribution, final code (6 runs) | **6 / 6** | **6 / 6** | 29 / 30 |
| Blocked pack regression check, final code (2 runs) | 2 / 2 | 2 / 2 | 10 / 10 |

After the fix, all 16 crashing runs completed, and 15 of 16 extracted exactly the six labelled items, including the tentative dashboard. The one miss came before the final change, and its recorded output now grounds fully in a test. Ultra rejected 2 of 79 briefs, both for writing a date its citations did not contain (`2026-09-16` and `2026-09-13`, the as-of date). The guardrail sent each of those two briefs to its template and kept the others. This is a small sample of one synthetic pack, not a reliability guarantee.

## Cause

The runtime (`RT-…`) and public-claim (`PUB-01`) sources were **not** the problem: Nano routed them to the rules in every run, and Super read only SRC-01, SRC-04 and SRC-06. Those are the same sources as the blocked pack, so the blocked pack had the same exposure.

All four failing outputs were byte-identical. Super returned the right six items but quoted four meeting lines without their speaker label, for example `"I will make audit log export available to Northstar by 2026-09-14."` instead of `"Maya Chen: I will …"`. The owner then was not inside the quote. The rule that an owner must appear in the cited evidence rejected those four, and one failing item rejected the entire extraction. A later run showed a second, rarer slip: SAML's exact quote cited to SRC-04 when it is in SRC-06.

## Fix

- **Speaker label.** When the owner is not in any quote, and the cited source contains exactly `${owner}: ` right before a quote, that label is added to the quote. The quote is still exact source text, and the owner-in-quote rule is applied unchanged. A different speaker is never attributed. The same repair applies to bring-your-own extraction.
- **Source re-attribution.** If a quote is not in its named source but is exact text of **exactly one** source in the same account, the citation moves there. Ambiguous or absent text, and other accounts' sources, are left alone and fail as before.
- **Per-commitment grounding.** An ungrounded commitment is dropped and shown as a `Dropped: …` check, and the step detail counts it; the rest of the run continues. The extraction still fails as a whole if the envelope is malformed or nothing is grounded. Reference commitments and user-confirmed commitments are still validated all-or-nothing.
- **Provider evidence never reaches Super.** Runtime and public-claim sources go straight to the rules, including on triage fallback. Otherwise a fallback would have sent Super the Sentry line (with its double quotes) and the changelog's "EU data residency is planned".
- **Evaluation.** Each case records dropped commitments and keeps Super's raw output whenever it is not a clean pass. Both recorded failing outputs are test fixtures (`tests/helpers/recorded-extraction.ts`).

## Calls and spend

These calls went through the evaluation guard, used development data only, and had catalog prices re-read before each invocation. They are not counted by the app's lifetime spend cap. Costs are estimates at catalog rates, not invoices.

| Invocation (UTC) | Calls (Nano / Super / Ultra) | Tokens in / out | Estimated cost |
| --- | ---: | ---: | ---: |
| 02:51 reproduction, Ultra off, 8 runs | 16 (8 / 8 / 0) | 16,912 / 20,718 | $0.019821 |
| 02:58 first fix, 10 runs | 30 (10 / 10 / 10) | 48,021 / 44,251 | $0.108825 |
| 03:02 final code, 6 runs | 18 (6 / 6 / 6) | 28,994 / 29,292 | $0.071065 |
| 03:04 blocked pack, final code, 2 runs | 6 (2 / 2 / 2) | 7,953 / 8,505 | $0.019581 |
| **Total** | **70 (26 / 26 / 18)** | **101,880 / 102,766** | **$0.219292** |

The total is within the $0.30 budget, and no call had uncertain usage.
