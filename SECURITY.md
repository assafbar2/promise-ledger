# Security boundaries

Intended use: **local synthetic-data prototype**, not public production or real customer records.

## Implemented

- Server-side ignored secrets; separate live-demo access token.
- Strict JSON input, same-origin checks and small request-size limit.
- Server-owned synthetic inputs only; no arbitrary source/URL/account submission.
- Untrusted model output: schema, known feature IDs, unique records, exact account-scoped quotes and grounded owners/dates.
- LLM cannot alter trusted product facts, invoke tools or send communications.
- Bounded inference timeout; no automatic paid retries or secret-bearing provider error output.
- Source text rendered as text; no injected HTML.
- Noncacheable API results; edits/new evidence invalidate local approvals.

## Release gates

A shared token is not tenant authorization. Add authenticated identities, quotas, persistent reviewer attribution and retention controls before broad sharing. The current log is memory-only, not an immutable compliance audit.

Exact quotations do not guarantee semantic correctness; test negation, cancellation, source authority and contradictions. Real telemetry needs authorized account mapping and validated timestamps.

Triage inherited dependency findings before internet exposure; see `docs/STATUS.md`. Browser, keyboard and contrast testing remains pending. No blanket security or WCAG claim is made.

Do not add real sending as a cosmetic button or treat approval of a draft as permission to contact a customer. No email/CRM sending capability exists in this build.

## Secret hygiene

Keep `.env.local`, API keys, access tokens and customer records out of Git and screenshots. Only the empty `.env.example` is shareable. Report sensitive findings privately to the repository owner, never by posting secrets in a public issue.
