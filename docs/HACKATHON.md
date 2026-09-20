# Hackathon strategy and checklist

Rechecked September 20, 2026 by opening the official rules and event overview, including the submission, testing-access and judging sections. This is not a memory-only checklist.

**Nebius × NVIDIA Global AI Hackathon · Best Apps and Agents**

Deadline: **October 30, 2026, 10:00 a.m. PDT / 17:00 UTC**.

- Event: https://nebiusglobalaihackathon.devpost.com/
- Rules: https://nebiusglobalaihackathon.devpost.com/rules

## Submission requirements

| Required item | What we need to provide |
| --- | --- |
| Working application | A functional application using at least one NVIDIA open-source model on Nebius Token Factory or Nebius AI Cloud. A runtime call to the Token Factory inference API qualifies; the whole website need not be hosted on Nebius. |
| Track | Best Apps and Agents; Nemotron on Token Factory is the relevant integration. Serverless Endpoints and Jobs are encouraged, not required. |
| Working testing link | A URL to a working demo, hosted app or runnable test build. The Physical AI exception does not apply to this project. |
| Project description | Explain what we built, why, its features and functionality, and how it works. |
| Public source | A public GitHub, GitLab or Bitbucket repository with all necessary source/assets, an open-source license and README setup/run instructions. Explain where NVIDIA models and Nebius services are used. Keep provider credentials out of the repository and test build. |
| Public YouTube video | Demonstrate the actual functioning app. Aim below three minutes: the overview permits three minutes or shorter, while the rules say less than three. The overview also asks for audio explaining the Nebius and NVIDIA integration. Use only media/marks we are authorized to use. |
| Technology feedback | Provide feedback on the Nebius and NVIDIA tools/models/services actually used. Do not invent experience with services we did not use. |
| Conditional disclosures | If a project predates the submission period, explain its significant in-period changes. City-award eligibility needs actual attendance at an eligible IRL event. |
| Language | English materials, or English translations of descriptions, video and testing instructions. |

Complete every required field on the Devpost submission form by **October 30, 2026, at 10 a.m. Pacific**. Registration alone is not submission.

### Testing access: a video alone is not enough

Section 4 requires working testing access even though judges may choose to evaluate only the description, images and video. Private websites are allowed if the testing instructions include login credentials. Do not confuse those judge credentials with the provider API key.

Access must be free and unrestricted for organizer/judge evaluation until the judging period ends: **December 15, 2026, at 12 p.m. Pacific**. Judging runs December 1–15. A localhost-only URL on the owner's laptop is not a usable judge-access link. A downloadable test build is permitted, but must actually be runnable with clear instructions and an authorized way to exercise the required model integration.

### Hosting choice

Vercel is not specified or required. A hosted browser demo is a convenience recommendation for this project, not an eligibility rule. Our current build uses Sites/Vinext and Cloudflare Worker tooling; moving it to Vercel would require compatibility work, not just changing a URL. A functioning test build is also an allowed route. No hosting provider has been selected or deployed as part of this rules review.

Any chosen route must preserve the $0 cash policy and judge access. Do not assume that a trial lasting through development covers December judging, or that judges should provide their own paid provider account.

### Optional, not entry requirements

- Customer interviews, pilots, customer adoption, measured ROI and a larger independent evaluation study.
- CRM integrations, a database, multi-tenant identity or production-grade persistent audit storage for this synthetic-data prototype.
- Vercel, Nebius Serverless deployment, Builder Program membership or any particular frontend/database package.

These are separate from running a working, safe demo and meeting the mandated NVIDIA/Nebius integration. Optional user feedback can strengthen the impact story; it is not a release gate.

## Compete on the actual judging dimensions

| Dimension | Demonstration | Evidence still needed |
| --- | --- | --- |
| Technological implementation | Extraction, grounded citations and independent availability policy; 40 real NVIDIA-on-Nebius evaluation calls recorded | Working judge-access route and complete live-workflow demonstration |
| Design | Inspect contradiction, review correction, export | Browser/keyboard/contrast QA |
| Potential impact | A concrete CSM mistake prevented | A credible, specific problem and demonstrated solution; CSM feedback is optional, with no invented ROI |
| Quality of idea | Built ≠ enabled ≠ customer-verified | Compare against naive ticket-status summarization |

## Registration

**Registered — confirmed by the owner on September 19, 2026.** The owner supplied this Devpost submission-management URL: https://devpost.com/submit-to/30790-nebius-x-nvidia-global-ai-hackathon/manage/submissions

Signed-in Devpost account: `assafbar`. The owner confirmed registration on September 19; the live overview independently displayed registered status on September 20. No registration form was submitted in this review. Nebius Builder Program enrollment remains unconfirmed. Token Factory sign-in, approved zero-data-retention profile setup, owner-completed billing verification, approved dedicated-key creation and first real model evaluation are complete. The 40-case evaluation used an estimated $0.025144 of trial credit with paid rollover disabled; see `evaluation/LIVE-RESULTS-2026-09-19.md`. The separate $25 hackathon credit form remains unsubmitted. Final project submission remains pending.

## Release checklist

- [x] Project directory and private GitHub repository `assafbar2/promise-ledger` created.
- [x] Initial scope, design, implementation, tests and documentation prepared.
- [x] Complete Devpost registration (owner-confirmed September 19, 2026).
- [x] Owner authorized the initial code commit and push to the private repository.
- [x] Configure Nebius and an available NVIDIA Nemotron model.
- [x] Capture successful live inference and actual model/run/usage evidence.
- [x] Prepare a distinct 32-case synthetic holdout, frozen before the first real model run.
- [x] Execute all eight development examples and the frozen 32-case holdout; retain the one development mismatch.
- [ ] Optional: seek independent CSM feedback or a fresh evaluation set; this is not a submission requirement.
- [ ] Resolve inherited dependency findings before internet exposure.
- [ ] Complete browser interaction, keyboard, mobile and contrast checks.
- [ ] Provide a judge-accessible working demo or runnable test-build URL; verify clean-session access or supplied judge credentials through the end of judging.
- [ ] Record/upload the public video and write honest technology feedback.
- [ ] Obtain explicit approval to change repository visibility to public.
- [ ] Submit and verify Devpost confirmation before the deadline.

## Suggested checkpoints (not scheduled)

First live evaluation completed September 19. Next: targeted safety fixes and a complete walkthrough; then a zero-cash judge-access route, source release approval, video and submission text. October 23: proposed feature freeze. October 28: proposed early submission buffer. Lightweight CSM feedback can run if convenient, but is not a prerequisite. Do not build a connector platform before finishing the entry.

## Verification sources

- [Official rules, section 1](https://nebiusglobalaihackathon.devpost.com/rules#1-dates-and-timing): submission and judging dates.
- [Official rules, section 4](https://nebiusglobalaihackathon.devpost.com/rules#4-how-to-enter): runtime integration, submission artifacts and Testing access.
- [Official rules, section 6](https://nebiusglobalaihackathon.devpost.com/rules#6-judges-criteria): technology, design, potential impact and idea quality, equally weighted.
- [Event overview, What to Submit](https://nebiusglobalaihackathon.devpost.com/): public YouTube video and audio covering how Nebius/NVIDIA are used.
