# Design system: editorial evidence workbench

## Visual direction

Quiet authority, not a futuristic AI command center. The interface should feel like a careful CSM's working document: readable, attributable and reviewable. The evidence trail is the visual story; no generated illustration or stock imagery is necessary.

| Element | Choice |
| --- | --- |
| Sidebar | Deep evergreen `#182d2a` |
| Canvas | Warm paper `#f7f8f5` |
| Primary text | Ink `#202c2b` |
| Primary action | Forest `#275b49` |
| Selection | Pale sage |
| Delivery gap | Restrained amber plus a text label and icon |
| Typography | Geist UI; Georgia italic editorial accent |
| Icons | Existing Lucide set |

## Composition

Sidebar → product-specific headline → explicit demo controls → computed summary counts → contradiction banner → ledger/evidence split workbench. The evidence brief progresses from verdict to built/enabled/verified checks, exact quotations, recommended next action and human-reviewed draft.

No fabricated money-at-risk metrics, fake connector badges, animated pretend reasoning, or generic floating chatbot. A closed ticket does not earn a green delivered badge.

## Agent pipeline panel

The live agent view sits above the metrics on the ledger. It shows four numbered step cards in a row (Triage, Extract, Decide, Explain): each has a status pill, the model name, latency, tokens and cost, and one plain sentence about what happened. Below them sit two feeds: cited quotes, each with an exact-match check, and verdicts plus guardrail results. Every value on screen comes from a real event. Live token counts are marked "≈ … streaming" until the provider reports usage.

- Running is pale sage with a soft ring; done is white; a fallback is restrained amber with the reason in words; failed uses the existing error tone. Status is always text plus icon, never colour alone.
- Reference mode uses a dashed border and a Georgia-italic heading, "Replayed reference trace · no AI calls". Its engine chips read "Reference fixture" or "Template drafts", and its pacing is labelled illustrative.
- Model-written text always carries its origin ("Written by Nemotron 3 Ultra after the rules decided…" or "Template draft. <reason>"). Claims expand to their exact quotes, and source chips open the source library.
- Motion is limited to a status pulse and a short fade-in for new quotes, both removed under reduced motion. Step status changes are announced through a polite live region; the quote feed is not announced.

## Interaction contract

- Record selection updates the evidence brief; citations lead to full source documents.
- Filters change the list, never the facts.
- A scenario change requires an explicit evidence run before changing results.
- Rerunning evidence invalidates previous draft approvals.
- Editing an approved draft clears approval.
- A failed live run leaves the previous results visible and identifies the failure.
- Export exists; sending does not. Workspaces persist in this browser only, which is labelled in the sidebar, the gallery and the footer. They can be exported, deleted or cleared.
- Switching accounts is one click and never runs a model. It restores that workspace's last result, or the account's reference result.
- Bring-your-own evidence runs in three numbered steps: add, extract, confirm. Sources lock while their extraction is under review; editing them clears the proposal. Every proposed fact starts unconfirmed, corrections are marked "corrected", and rules run only on confirmed facts. The evidence brief notes "Confirmed by you…" and names the corrected fields.

## Accounts, bring-your-own evidence and the tour

The gallery uses the same white cards as the ledger. Each shows the account's serif initial, industry, a one-sentence situation, and its headline verdict badge in the existing verdict colours. The bring-your-own card is dashed, like reference mode, because it starts empty. Fact confirmation uses Yes / No / Unknown segmented buttons (sage, amber, grey, always with a text label) and an explicit "I checked this against the quote" checkbox beside the exact quote. Text addressed to an AI system gets a restrained amber note that says it stays data. The tour is a sage highlight ring over a dimmed page with a small card: five steps, Back/Next/Skip, Escape to close, arrow keys to move, and no animation under reduced motion.

## Responsive and accessibility intent

The workbench stacks below 980px, mobile navigation becomes horizontal, and mobile metrics become a 2×2 grid. Pipeline step cards go from four columns to two below 1180px and to one below 680px. Native labeled controls, skip navigation, focus styles, status/alert regions, text verdicts and reduced-motion handling are implemented. Browser interaction, keyboard, contrast and assistive-technology audits remain release gates; no WCAG conformance claim is made.

A bespoke social card was omitted because image generation was unavailable; no unrelated fallback image is used.
