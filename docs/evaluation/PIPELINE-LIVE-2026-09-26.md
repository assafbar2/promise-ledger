# Live pipeline check — September 26, 2026

A small smoke test of the three-model pipeline against real Nebius Token Factory endpoints, on the $1 trial credit. **This is not an accuracy evaluation.** It confirms model IDs, streaming, JSON behaviour, latency and cost on the synthetic Northstar pack, and it drove the default settings below. The September 19 extraction evaluation remains the only accuracy measurement and was not rerun (`eval:live` would overwrite it).

## Calls

20 real chat completions: 8 to Nano, 5 to Super, 7 to Ultra. No automatic retries. Reported usage totalled 22,395 input and 33,898 output tokens. One Nano call timed out without reporting usage (at most about 3,800 tokens). Estimated consumption is about **$0.092** of trial credit at catalog rates; the two truncated Ultra tuning calls account for $0.047 of it. This is not an invoice.

| # | What | Result |
| --- | --- | --- |
| 1 | Full run, blocked scenario, default reasoning | Nano timed out at 15 s (catalog: about 60 tokens/s, reasoning on). Triage fell back to all sources. The smoke script's own logging then crashed, so Super and Ultra were not called. |
| 2 | Nano probe, `reasoning_effort: "none"` | 3.9 s, 777 in / 312 out, valid JSON. The parameter is honoured. |
| 3–5 | Full run, Nano with no reasoning, Ultra with default reasoning | Nano 3.8 s. Super 8.9 s, 702 in / 1,934 out (1,390 reasoning), all quotes exact. Ultra hit the 7,000-token cap (4,832 reasoning), and all briefs fell back to labelled templates. |
| 6 | Nano probe with the tightened prompt | 3.6 s, 826 in / 203 out, compact JSON. Labels are noisy without reasoning (the entitlement snapshot came back as `other`). Routing is unaffected, and a deterministic backstop keeps customer tickets citable. |
| 7 | Ultra probe, `reasoning_effort: "low"` | Not honoured: 6,035 of 7,000 tokens were reasoning, and the output was truncated. |
| 8 | Ultra probe, `reasoning_effort: "none"` | 5.4 s, 1,754 in / 1,781 out. 4/5 briefs passed every guardrail; one exceeded the claim-count limit, which was then relaxed. |
| 9–11 | Full run, shipped defaults | 17.0 s, $0.0094. Six commitments extracted. 4/5 briefs accepted; SAML was rejected for citing the wrong source. |
| 12–14 | Browser UI run | 20.2 s, 7,598 tokens, $0.0093. 3/5 briefs accepted, 2 fell back with labelled reasons. |
| 15–17 | Browser UI run | 16.2 s, 7,227 tokens, $0.0095. 3/5 briefs accepted. Rejections: a 12-character minimum-quote violation, and a citation to a source outside the commitment's evidence. |
| 18–20 | Full run, with validated quotes added to Ultra's input | 17.3 s, $0.0084. Nano 4.1 s, Super 9.6 s (1,159 reasoning), Ultra 3.5 s, 2,309 in / 1,403 out. **5/5 briefs accepted.** |

## What this established

- Model IDs `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`, `nvidia/nemotron-3-super-120b-a12b` and `nvidia/Nemotron-3-Ultra-550b-a55b` all answered on the global endpoint `api.tokenfactory.nebius.com`, with the mixed-case Ultra ID accepted as written.
- `stream: true` with `stream_options.include_usage` works on all three and returns usage in the final chunk. `json_object` output parsed on all three.
- Reasoning tokens arrive as `reasoning_content`, count toward `max_tokens`, and are reported in `completion_tokens_details.reasoning_tokens`.
- `reasoning_effort: "none"` is honoured by Nano and Ultra; `"low"` was not honoured by Ultra. Hence the defaults: Nano and Ultra run with `"none"`, and Super keeps its September 19 settings, with reasoning on.
- The guardrails caught real model errors. Ultra repeatedly attributed the SAML promise to the wrong source until its input listed the validated quotes with their source IDs. Every rejected brief fell back to a clearly labelled template. No verdict changed.
- Super missed the tentative "custom dashboard" item in 4 of 5 runs, matching the tentative-item miss documented on September 19.

Five short runs on one synthetic account do not establish reliability or real-world quality.
