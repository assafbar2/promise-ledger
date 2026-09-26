# Scope: Promise Ledger

September 13, 2026 · Hackathon builder mode · Best Apps and Agents

## Problem and audience

An enterprise CSM preparing a customer update has three different versions of reality: what was promised, what engineering completed, and what the customer can actually use. A closed ticket can produce a premature delivery email. Another summarization dashboard does not resolve that contradiction.

The unit of work is a source-backed customer commitment, not a chat session or generic health score. The concrete job is: **Can I truthfully say this promise was delivered?**

## The memorable demo

Engineering closes the audit-export ticket. Promise Ledger finds that Northstar's entitlement is disabled, displays both sources, and prepares an honest correction for human review. Switch to evidence of a successful customer test: the verdict changes, and old draft approvals are invalidated. The status changes because reality changed, not because someone rewrote a summary.

## Alternatives and decision

| Approach | Strength | Why selected or rejected |
| --- | --- | --- |
| Minimal promise extractor | Fastest path from notes to a list | Cannot catch the engineering/customer mismatch |
| Full connected CS platform | CRM, support, product telemetry, persistent review | Too much integration work before proving the distinctive workflow |
| Evidence workbench | One account, three evidence families, one compelling contradiction | Selected: complete, demonstrable workflow with a clear path to live model evaluation |

This follows the earlier selected Promise Ledger proposal. No independent multi-agent review was performed.

## Implemented first slice

- One fictional account; six synthetic documents and six records (five commitments, one discussion).
- Exact source quotes, owners, dates, account checks and conservative delivery verdicts.
- Separate built, enabled and customer-verified checks; stale data never proves delivery.
- Searchable ledger, inspectable source library, review queue, editable drafts and exports.
- Three scenarios: disabled entitlement, successful acceptance and stale evidence.
- Server-side NVIDIA Nemotron-on-Nebius adapter with strict output validation and explicit failures.
- Deterministic tests and evaluation, plus a separate credential-gated live evaluation harness.
- September 26: four fictional sample accounts with their own evidence packs; bring-your-own evidence (paste or `.txt`/`.md`/`.csv`/`.eml`) with human confirmation of extracted facts before the rules decide; browser-saved workspaces; a first-run tour.
- September 26: a visible three-model Nemotron pipeline (Nano triage, Super extraction, Ultra narrative after the rules decide) with a streaming agent trace, per-claim citation guardrails, labelled template fallbacks, and a pluggable evidence-provider interface.

## Deliberate exclusions

No real CRM/support connectors, binary or URL uploads (bring-your-own evidence is capped plain text), tenant authentication, server-side records, background monitoring, outbound sending, or production compliance audit. No live AI result, customer adoption, saved revenue or measured time savings is claimed. Real customer data is out of scope for this prototype.

## Acceptance criteria

1. Engineering completion plus disabled customer entitlement yields a delivery gap.
2. Only fresh, account-specific built + enabled + acceptance evidence can prove delivery.
3. Tentative ideas do not become invented owners or deadlines.
4. Every accepted model citation exists verbatim in an authorized source.
5. Failed live inference never silently substitutes a reference result.
6. No draft is sent; edits and new evidence runs clear local approval.
7. Synthetic data, snapshot time, inference mode and browser-only storage stay visible.
8. No model can change a verdict; every model-written claim cites exact quotes from that commitment's evidence, introduces no new date or promise, or falls back to a labelled template.
9. A full pipeline counts as one rate-limited live run and cannot exceed its per-run worst-case budget.
10. Facts proposed from user-supplied text change a verdict only after a person confirms them, and every quote is re-checked on the server.

## Next unknowns

Live Nemotron extraction quality, cancellation/supersession semantics, appropriate evidence freshness in real workflows, and the actual CSM value of the intervention all need measurement. Winning is the goal, not a guaranteed outcome.
