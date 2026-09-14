# Hackathon strategy and checklist

Verified September 13, 2026 on the official event and registration pages.

**Nebius × NVIDIA Global AI Hackathon · Best Apps and Agents**

Deadline: **October 30, 2026, 10:00 a.m. PDT / 17:00 UTC**.

- Event: https://nebiusglobalaihackathon.devpost.com/
- Rules: https://nebiusglobalaihackathon.devpost.com/rules

## Submission requirements

A working NVIDIA open-source model on Nebius, working demo URL, project description and chosen track, public licensed source with setup instructions, public YouTube video of three minutes or less with technology narration, and actual technology feedback. Recheck the official rules before submission.

The rules require the working project to remain freely accessible and unrestricted for testing through December 15, 2026. Plan hosted uptime and judge access accordingly; a developer-only private preview is not enough for judging.

## Compete on the actual judging dimensions

| Dimension | Demonstration | Evidence still needed |
| --- | --- | --- |
| Technological implementation | Extraction, grounded citations and independent availability policy | Real model run, measured latency/tokens, live evals |
| Design | Inspect contradiction, review correction, export | Browser/keyboard/contrast QA |
| Potential impact | A concrete CSM mistake prevented | Three CSM walkthroughs and observed outcomes; no invented ROI |
| Quality of idea | Built ≠ enabled ≠ customer-verified | Compare against naive ticket-status summarization |

## Registration

Signed-in Devpost account: `assafbar`. Registration was opened but **not submitted**. The form requires personal answers about Nebius Builder Program membership, previous use/awareness, NVIDIA awareness and eligibility/rules agreement. These were left to the user rather than guessed. No employer or profile changes were submitted. Verify the registration confirmation before checking this off.

## Release checklist

- [x] Project directory and private GitHub repository `assafbar2/promise-ledger` created.
- [x] Initial scope, design, implementation, tests and documentation prepared.
- [ ] Complete Devpost registration.
- [x] Owner authorized the initial code commit and push to the private repository.
- [ ] Configure Nebius and an available NVIDIA Nemotron model.
- [ ] Capture successful live inference and actual model/run/usage evidence.
- [ ] Run development evals, then an independent held-out set of at least 30 examples.
- [ ] Resolve inherited dependency findings before internet exposure.
- [ ] Complete browser interaction, keyboard, mobile and contrast checks.
- [ ] Publish a judge-accessible demo and verify signed-out access.
- [ ] Record/upload the public video and write honest technology feedback.
- [ ] Obtain explicit approval to change repository visibility to public.
- [ ] Submit and verify Devpost confirmation before the deadline.

## Suggested checkpoints (not scheduled)

September 14–16: real inference. September 17–20: ambiguous/cancelled/conditional extraction tests. September 21–27: CSM walkthroughs. October 1–15: judge demo and hardening. October 23: feature freeze. October 28: early submission buffer. Do not build a connector platform before proving the core workflow.
