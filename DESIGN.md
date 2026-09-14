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

## Interaction contract

- Record selection updates the evidence brief; citations lead to full source documents.
- Filters change the list, never the facts.
- A scenario change requires an explicit evidence run before changing results.
- Rerunning evidence invalidates previous draft approvals.
- Editing an approved draft clears approval.
- A failed live run leaves the previous results visible and identifies the failure.
- Export exists; sending does not. Session state is lost on refresh and is labeled accordingly.

## Responsive and accessibility intent

The workbench stacks below 980px, mobile navigation becomes horizontal, and mobile metrics become a 2×2 grid. Native labeled controls, skip navigation, focus styles, status/alert regions, text verdicts and reduced-motion handling are implemented. Browser interaction, keyboard, contrast and assistive-technology audits remain release gates; no WCAG conformance claim is made.

A bespoke social card was omitted because image generation was unavailable; no unrelated fallback image is used.
