# First live NVIDIA-on-Nebius evaluation

Completed September 19, 2026, at 15:10:13 PDT (22:10:13 UTC).

## What actually ran

- Provider: Nebius Token Factory, standard public chat-completions endpoint.
- Requested and reported model: `nvidia/nemotron-3-super-120b-a12b` on all 40 calls.
- One sequential invocation, development first and frozen held-out second. No automatic retries or prompt changes.
- Start: `2026-09-19T22:07:59.629Z`; finish: `2026-09-19T22:10:13.248Z`; elapsed: 133.619 seconds.
- Prompt: `commitment-extraction-v2`; SHA-256 `23f36efaff180ed0eb41d726e2f5c6be0f7004afb3c777f4354b132db560192d`.
- Held-out fingerprint: `041ae0b492484492d391ab9d5b8261cec2743dca57eda4253d6176254721b265`, unchanged from the frozen manifest.

## Observed results, not a general model-quality claim

| Measure | Development | Frozen held-out |
| --- | ---: | ---: |
| Executed / planned | 8 / 8 | 32 / 32 |
| Exact-set matches | 7 | 32 |
| Mismatches | 1 | 0 |
| Provider or validation errors | 0 | 0 |
| Grounding rejections | 0 | 0 |
| Median request latency | 3.627 seconds | 3.557 seconds |
| p95 request latency | 4.519 seconds | 7.454 seconds |
| Maximum request latency | 4.519 seconds | 8.584 seconds |
| Reported input tokens | 3,565 | 14,584 |
| Reported output tokens | 4,287 | 17,581 |

Across all 40 requests: 18,149 input tokens, 21,868 output tokens, median 3.614 seconds and p95 5.048 seconds. Each request has an actual model ID, completion/run ID, HTTP request ID, HTTP status, elapsed time and token usage in the saved JSON reports. No errors were omitted. The command returned exit code 1 because of the development mismatch, not because execution stopped early.

These are small, assistant-authored synthetic sets, not independent customer data or an external benchmark. A perfect match on this particular held-out set does not establish real-world accuracy, general reliability, security, or readiness for deployment. Latencies are a single sequential sample, not a load test.

## Development mismatch retained

`dev-conditional` expected a tentative `audit-export` item with no owner or due date. Its source explicitly says delivery is conditional on security approval and "This is not a commitment." The model returned an empty set. That is a missed tentative item under the current labeling policy, not a fabricated promise. The expected label, model response and prompt were not changed after observing the result.

Before another iteration, clarify the product's handling of explicitly noncommittal possibilities using development-only examples. Do not tune against this now-observed holdout. Use a newly frozen, preferably independently authored set for subsequent confirmation.

## Cost and safeguards

- Cash budget remains **$0**. No top-up, paid rollover, subscription, dedicated endpoint or paid hosting was enabled.
- Pre-run console: $1.00 trial credit, 29 days remaining, $0.00 paid account balance, **Stop usage after trial** active.
- Verified standard rates: $0.30 per million input tokens and $0.90 per million output tokens; Batch discounts were not used.
- Shared invocation ceiling: $0.50. Conservative per-request reservation: $0.319973; unused reservation released only against valid model/usage evidence.
- Total usage-based credit estimate: **$0.025144**, rounded upward per call. This is approximately 2.51 cents of trial credit, not a card charge or finalized provider invoice. The held-out report's budget is cumulative across both suites; do not add it to the development budget.
- A refreshed post-run console still displayed $1.00 trial credit and $0.00 account balance, with **Stop usage after trial** active. The displayed credit had not yet reconciled with token usage, so the exact settled remaining credit is not independently confirmed. Recheck before any further inference.
- The 1,048,576-token reservation bound is deliberately conservative. Nebius displayed 256K; the exact server context integer was not verified. This is not a claim that the endpoint supports a 1 Mi-token context.

## Evidence files

- [Development report](runs/2026-09-19T22-07-59-629Z/development.json)
- [Frozen held-out report](runs/2026-09-19T22-07-59-629Z/held-out.json)
- [Pre-run account/model verification](provider-verification-2026-09-19.json)

Earlier zero-execution reports remain preserved as historical blocked attempts; they are not live evidence.

## Credential and release status

The dedicated provider key is stored only in ignored `.env.local`, with owner-only permissions (0600), alongside a distinct demo token. The owner pasted the key into chat, so it must be treated as exposed; rotation is recommended. One-time display does not establish expiration, and expiration has not been verified. No secret value is included in this report. Revocation/replacement needs owner confirmation.

The local homepage returned HTTP 200 and `/api/status` reported live configuration available after the run; neither check dispatched inference. The repository remains private. These reports and documentation changes are local and uncommitted. Public deployment, final Devpost submission, Builder Program enrollment and additional promotional credits are not complete.
