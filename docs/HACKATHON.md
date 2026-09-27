# Hackathon strategy and checklist

Rechecked September 27, 2026 by opening the official rules and event overview, including the submission, testing-access and judging sections; no requirement changed since the September 20 check. This is not a memory-only checklist.

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
| Bonus: Best Use of Tavily | Open to eligible submissions that make a functional, runtime call to the Tavily API. Each project can win one overall or track award plus one bonus award. |

Complete every required field on the Devpost submission form by **October 30, 2026, at 10 a.m. Pacific**. Registration alone is not submission.

### Testing access: a video alone is not enough

Section 4 requires working testing access even though judges may choose to evaluate only the description, images and video. Private websites are allowed if the testing instructions include login credentials. Do not confuse those judge credentials with the provider API key.

Access must be free and unrestricted for organizer/judge evaluation until the judging period ends: **December 15, 2026, at 12 p.m. Pacific**. Judging runs December 1–15. A localhost-only URL on the owner's laptop is not a usable judge-access link. A downloadable test build is permitted, but must actually be runnable with clear instructions and an authorized way to exercise the required model integration.

### Hosting choice

Vercel is not specified or required; a runtime Token Factory call is what satisfies the platform rule. The app is hosted on Vercel at https://promise-ledger-chi.vercel.app with open, rate-limited live mode, so judges need no login, token or provider account. Access must stay free through December 15; the Token Factory trial ends around October 18, so the owner still has to confirm how live inference stays funded after it.

### Optional, not entry requirements

- Customer interviews, pilots, customer adoption, measured ROI and a larger independent evaluation study.
- CRM integrations, a database, multi-tenant identity or production-grade persistent audit storage for this synthetic-data prototype.
- Vercel, Nebius Serverless deployment, Builder Program membership or any particular frontend/database package.

These are separate from running a working, safe demo and meeting the mandated NVIDIA/Nebius integration. Optional user feedback can strengthen the impact story; it is not a release gate.

## Compete on the actual judging dimensions

| Dimension | Demonstration | Evidence still needed |
| --- | --- | --- |
| Technological implementation | Three-model Nemotron pipeline on Token Factory with a streaming agent view, guardrails, deterministic rules, Tavily and Sentry evidence; full-pipeline evaluation of 9/9 and 31/32 exact matches | A new, independently authored held-out set before further accuracy claims |
| Design | Landing page, guided tour, four sample accounts, bring-your-own evidence, dark mode; production QA with axe on September 27 | Firefox and Safari checks |
| Potential impact | A concrete CSM mistake prevented | CSM feedback is optional; no invented ROI |
| Quality of idea | Built ≠ enabled ≠ customer-verified; public GA ≠ usable by this customer | — |

## Registration

**Registered — confirmed by the owner on September 19, 2026.** The owner supplied this Devpost submission-management URL: https://devpost.com/submit-to/30790-nebius-x-nvidia-global-ai-hackathon/manage/submissions

Signed-in Devpost account: `assafbar`. The owner confirmed registration on September 19; the live overview independently displayed registered status on September 20. No registration form was submitted in this review. Nebius Builder Program enrollment remains unconfirmed. Token Factory sign-in, approved zero-data-retention profile setup, owner-completed billing verification, approved dedicated-key creation and first real model evaluation are complete. The 40-case evaluation used an estimated $0.025144 of trial credit with paid rollover disabled; see `evaluation/LIVE-RESULTS-2026-09-19.md`. $50 of promotional Token Factory credit was applied on September 27, 2026, and the app's lifetime spend cap is set to $40 below it. Final project submission remains pending.

## Release checklist

- [x] GitHub repository `assafbar2/promise-ledger` created, then made public with the owner's approval; MIT license detected in the About section.
- [x] Initial scope, design, implementation, tests and documentation prepared.
- [x] Complete Devpost registration (owner-confirmed September 19, 2026).
- [x] Configure Nebius and available NVIDIA Nemotron models (Nano, Super, Ultra).
- [x] Capture successful live inference and actual model/run/usage evidence.
- [x] Prepare a distinct 32-case synthetic holdout, frozen before the first real model run.
- [x] Evaluate extraction (September 19) and the full pipeline (September 27) on the development and frozen held-out sets.
- [x] Resolve inherited dependency findings before internet exposure (September 20; see the [dependency review](DEPENDENCY-REVIEW-2026-09-20.md)).
- [x] Hosted judge access with no login: open, rate-limited live mode, verified by an anonymous live run on September 27.
- [x] README with setup, run instructions, NVIDIA model use, where Token Factory accelerated the workflow, and other services.
- [x] No secrets in the public git history or production JavaScript (scanned September 27).
- [x] Browser interaction, keyboard, mobile and contrast checks in Chrome (production QA, September 27).
- [ ] Firefox and Safari checks.
- [ ] Keep live access free and working through December 15, 2026, noon Pacific, past the Token Factory trial end around October 18.
- [ ] Upload the final video to YouTube as Public (under 3:00) and paste the description, testing instructions and technology feedback into Devpost.
- [ ] Submit and verify Devpost confirmation before the deadline.
- [ ] Optional: independent CSM feedback or a fresh, independently authored evaluation set; not a submission requirement.

## Suggested checkpoints (not scheduled)

October 15: decide how live inference stays funded after the trial. October 23: proposed feature freeze. October 28: proposed early submission buffer. Do not build a connector platform before finishing the entry.

## Verification sources

- [Official rules](https://nebiusglobalaihackathon.devpost.com/rules): section 1 for submission and judging dates, section 4 for runtime integration, submission artifacts and testing access, section 6 for the equally weighted criteria (technology, design, potential impact, idea quality), and section 8 for the Tavily bonus.
- [Event overview, What to Submit](https://nebiusglobalaihackathon.devpost.com/): public YouTube video and audio covering how Nebius/NVIDIA are used.
