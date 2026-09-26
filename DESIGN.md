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

## Colour tokens and themes

Every colour outside the evergreen sidebar is a semantic token in `app/globals.css`: surfaces (`--bg`, `--surface`, `--surface-2…4`), lines, three text levels, the forest accent, and warn (amber, delivery gap), caution (gold, needs verification), danger and info families, each with text, background and line values. Light is the default. Dark mode follows the operating system until the person picks a theme with the toggle in the top bar or landing navigation; the choice is stored in the browser and applied before first paint. The dark palette is deep evergreen, not grey, with the same hue families.

Every text token meets WCAG AA (4.5:1) against every surface token in both themes, as do the fixed sidebar and landing-band colours. Status never relies on colour alone.

## Type scale

The workbench body is 13–15 px, with secondary text at 12 px and uppercase labels at 10.5–11 px with letter spacing; nothing on screen is smaller than 9 px (the sidebar tagline). The landing page runs larger: 16 px body, 18–19 px leads, and headings up to 68 px, always with the Georgia-italic accent on the second phrase.

## Landing page

`/` introduces the product; the workbench is at `/app`, one click from every section (“Try it live”). The order is problem, approach, how it works, guardrails, NVIDIA Nemotron on Nebius Token Factory, then the four sample accounts, which deep-link into the workbench (`/app?account=…`). The hero visual is a coded evidence brief, not a screenshot or illustration, so it stays sharp in both themes. Every quote on it comes from the Northstar fixture. The “How it works” band reuses the sidebar evergreen. A caution-toned note states plainly that the data is synthetic and what leaves the browser. Third-party tools are named in text only; no vendor logos are used.

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

The workbench stacks below 980px, mobile navigation becomes horizontal, and mobile metrics become a 2×2 grid. Pipeline step cards go from four columns to two below 1180px and to one below 680px. The landing page goes to one column below 720px. Native labeled controls, skip navigation, a 3 px focus ring in the `--focus` token, `aria-current` on the active section, labelled button groups, status/alert regions, `aria-busy` while a check runs, text verdicts and reduced-motion handling are implemented. Colour contrast is checked token by token; a full assistive-technology audit has not been done, so no WCAG conformance claim is made.

## Social card and icons

`public/og.png` (1200×630) is the Open Graph and Twitter card: the headline beside the Northstar evidence brief, on evergreen. `public/favicon.svg` is the Layers mark in mint on evergreen, with `favicon.ico` and `apple-touch-icon.png` fallbacks.
