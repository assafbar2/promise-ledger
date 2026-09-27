# Crashing-scenario Ultra briefs — September 27, 2026

Production QA saw a live Northstar **Enabled, but crashing** run in which all five Ultra briefs fell back to templates. The first failed schema validation at `explanation.citations.sourceId`, and the other four were "not returned by the model". Verdicts were correct. Earlier production runs of that scenario accepted 4/5 and 5/5 briefs.

## Cause

The failure was **not reproduced live**: the one reproduction call returned 5/5 accepted briefs. The cause below comes from the evidence and the code, not from the failing output, which the app does not keep.

- The runtime source **is** in the allowed citation set. The runtime issue `RT-7755979867-audit-export` is part of PL-101's evidence, and Ultra cited it correctly in the reproduction.
- It is the **only source in any sample account and scenario that contains double quotes**: `title="AuditExportError: …"; culprit="audit-export.run"`. The prompt asks Ultra to copy quotes exactly and to prefer `validatedQuotes`, and for PL-101 that is the full 330-character Sentry line. Inside a JSON string every `"` must be escaped as `\"`. Under provider JSON mode, one missed escape ends the string early and the rest of the output derails. That matches the symptom: a schema failure inside brief 1's citations, followed by the remaining briefs missing, as if they were nested or lost.
- `validateBriefs` already judged top-level briefs one at a time. However, it only looked at the top level, so briefs knocked out of place by a slip counted as "not returned".

## Fix

- **Ultra never sees a double quote in cited text.** The narrative input replaces `"` with `'` in source text and validated quotes (`citableText`). The replacement is one character for one, so offsets are unchanged. A citation in that form is resolved back to the **exact** original excerpt before acceptance, so the UI and later checks see real source text. Verbatim copies with escapes still pass, and invented text still fails.
- **One bad brief never drops the rest.** After top-level briefs, `validateBriefs` also looks for brief-shaped objects nested anywhere in the output. It validates each on its own, with the same strict rules. A top-level brief is never replaced by a nested copy. Output with no brief at all is still rejected as a whole.
- **`NEBIUS_STREAM=false` works for Nano.** Non-streamed answers that Token Factory returns in `message.reasoning` with null content are used only when the request set `reasoning_effort: "none"`. Otherwise the result is still rejected as incomplete.
- **Evaluation.** The development pipeline set now includes `dev-northstar-crashing`: the app's crashing scenario with the recorded Sentry and public-claim responses. Errored cases keep the last model output, and cases with a rejected brief keep Ultra's raw output. `eval:pipeline` gained `--only=` and `--repeat=` flags for scratch diagnosis only. Tests cover all of this with mocked providers.

The fix has not been checked against the live model. The next full development run will be the first live check.

## Calls and spend

All calls went through the evaluation guard, used development data only, and had catalog pricing re-read immediately before each run. Costs are estimates at catalog rates, not invoices. None of these calls counts toward the app's lifetime spend cap.

| When (UTC) | What | Calls | Tokens (in / out) | Estimated cost |
| --- | --- | ---: | ---: | ---: |
| 02:40:51 | Crashing case, first pass: Nano, then Super. Super's extraction failed grounding, so Ultra was not called. | 2 | 2,114 / 2,350 | $0.002266 |
| 02:41:04 | Second pass of the same run, stopped by hand to stay within the 6-call limit. Its calls were not checkpointed. | ≤ 3, unrecorded | unknown | ≤ $0.049577 (per-case worst case) |
| 02:42:35 | One Ultra call on the exact crashing brief input: **5/5 accepted** | 1 | 2,713 / 2,346 | $0.009751 |

Confirmed: 3 calls, **$0.012017**. Upper bound including the unrecorded calls: 6 calls, **$0.061594**, within the $0.20 budget.

The pass at 02:40:51 also hit a Super **grounding rejection** on the crashing pack (3 routed sources). Together with held-out `hold-18`, that is two grounding rejections on multi-feature sources since prompt v3. The raw outputs were not kept, which the harness now fixes. Watch this in the next development run before drawing conclusions.
