# Sentry runtime-error evidence

Sentry is the fourth evidence family, after conversations, engineering records and availability snapshots. It answers one question: **is the feature enabled for this customer, but failing for them at runtime?** Errors can lower a verdict. The absence of errors never raises one, because a quiet error feed is not proof of delivery.

## Rule

In `reconcile()`, after the stale-evidence and "delivery gap" checks and before "verified delivered":

> If the feature is built **and** enabled for the customer, and a Sentry issue tagged `customer:<account>` and `feature:<feature>` is unresolved, has a matching event within 72 hours of the fetch, and was last seen **after** the availability/acceptance snapshot, the verdict is **needs verification**. The reason reads, for example: "Enabled for Northstar, but failing at runtime (14 events, 3 users)."

- A disabled or unbuilt feature keeps its verdict. Errors never soften "delivery gap".
- No matching issue means the rule does not apply. Every other rule decides as before.
- If Sentry fails (bad token, rate limit, timeout, misconfiguration), the run continues without runtime evidence. The provider report and the run notice say "Sentry unavailable: …". Live runs never fall back to the recording.
- Several issues add up their events. Users are reported as "at least" the largest single-issue count, since users can overlap across issues.

## Evidence and grounding

`lib/sentry/runtime.ts` builds each Runtime source only from Sentry API field values, as `key=value` pairs. Titles are JSON-quoted, so they cannot inject extra fields.

```text
issue=PROMISE-LEDGER-DEMO-2; title="AuditExportError: export job failed: …"; culprit="audit-export.run"; level=error; status=unresolved; count=14; userCount=3; firstSeen=…; lastSeen=…; customer=northstar; feature=audit-export
```

- Counts come from the issue's `filtered` block, which Sentry scopes to the tag query, so they belong to this customer and feature only.
- The `runtimeErrors` signal quotes the whole source text, and the registry and the rule both check `source.text.includes(quote)`.
- Stack frames, event payloads and user fields are never read into a source, so no model sees them.
- The source keeps the issue permalink, which needs an owner sign-in to open. It also keeps the latest event ID and the fetch time.
- The account and feature IDs must match `^[a-z0-9][a-z0-9-]{0,63}$`, so they are exact tag filters: no spaces, quotes or wildcards. The newest matching event is then read to confirm both tag values verbatim.

## API calls (read-only)

A live run makes one call per ledger feature, plus one per matching issue. Results are cached for 10 minutes per server instance, and requests time out after 8 seconds with no retries.

1. `GET {SENTRY_API_BASE}/api/0/organizations/{org}/issues/?project={SENTRY_PROJECT}&query=is:unresolved customer:{account} feature:{feature}&statsPeriod=72h&sort=date&limit=3`
2. `GET {SENTRY_API_BASE}/api/0/organizations/{org}/issues/{issueId}/events/?query=customer:{account} feature:{feature}&statsPeriod=72h&per_page=1`

The token needs only **Issue & Event: Read** (`event:read`). Seeding also reads `GET /api/0/projects/{org}/{project}/` as a safety check, which needs `project:read`.

## Modes and scenarios

Sentry evidence belongs to one scenario, Northstar's **"Enabled, but crashing"** (`crashing`). Its facts are identical to `enabled`, so the only difference is the runtime evidence.

| Run | Sentry |
| --- | --- |
| `blocked`, `enabled`, `stale` (live or reference) | Off. No Sentry call, so "Enabled + customer verified" still ends at verified delivered |
| Live `crashing` | Reads the live API. If the `SENTRY_*` read variables are missing or wrong, the provider report says "Sentry unavailable: …" rather than showing a clean result |
| Reference `crashing` | Replays `lib/sentry/recorded-runtime.json` through the same parser, labelled "Recorded response · captured 2026-09-26" |
| Bring-your-own evidence and the other sample accounts | Off. They offer no `crashing` scenario |

Why not every live scenario: the demo project is re-seeded daily, so its errors are always fresh. Applied everywhere, they would turn every enabled feature into "needs verification" and hide the "evidence changed, so now it is verified" story.

The recording is aged against its own capture time, not the demo clock. `npm run sentry:check -- --record` refreshes it, and saves only schema fields, with event tags narrowed to `customer` and `feature`.

## Environment

| Variable | Where | Purpose |
| --- | --- | --- |
| `SENTRY_READ_TOKEN` | Vercel + `.env.local` | Internal-integration token, Issue & Event: Read (+ Project: Read) |
| `SENTRY_ORG` | Vercel + `.env.local` | Organization slug, e.g. `self-swl` |
| `SENTRY_PROJECT` | Vercel + `.env.local` | **Numeric** project ID of `promise-ledger-demo` |
| `SENTRY_API_BASE` | Vercel + `.env.local` | Region host, e.g. `https://us.sentry.io` |
| `SENTRY_SEED_DSN` | Vercel (sensitive) + `.env.local` | Ingest DSN used only for seeding |
| `CRON_SECRET` | Vercel (sensitive) | At least 16 characters; Vercel sends it as the cron bearer token |

The names deliberately avoid `SENTRY_AUTH_TOKEN` and `SENTRY_DSN`, which Sentry tooling reads automatically. No Sentry SDK is installed.

## Seeding the demo project

The free Developer-plan project `promise-ledger-demo` holds synthetic issues only. There is one headline issue, Northstar audit export (14 events, 3 users), and three decoys: Globex audit export, Initech SAML, and a Northstar feature outside the ledger.

```bash
npm run seed:sentry                 # sends only scenarios not seen in 24 h
npm run seed:sentry -- --dry-run    # read-only
npm run seed:sentry -- --force      # ignore freshness (same 6-hour window still skipped)
npm run sentry:check                # what the provider sees right now
```

- **Fixed fingerprints:** one issue per scenario, permanently.
- **Deterministic event IDs per 6-hour window:** Sentry drops repeats, and planning skips scenarios already seen in the current window.
- **Cap:** at most 60 events per run.
- **Safety check:** seeding refuses to send unless `SENTRY_PROJECT` and the DSN both resolve to `promise-ledger-demo`.

**Unattended freshness:** `vercel.json` schedules `GET /api/cron/seed-sentry` daily at 06:17 UTC; Hobby fires it within that hour. The route behaves as follows:

- without `CRON_SECRET` it returns 503;
- a wrong bearer token gets 401 before any Sentry call;
- missing seed variables return 200 "skipped";
- a failed Sentry read returns 502 and sends nothing;
- anything seen in the last 20 hours is skipped.

At most 32 events a day is about 1,000 a month of the free 5,000. Two missed days still leave issues inside the 72-hour window, which covers the October recording and December judging. Daily sends also keep the data inside Sentry's 30-day retention.

## Cost

$0. The Developer plan has no card on file. Events over quota are rejected rather than billed, and the read API is not metered.

## Limits

- Tag conventions (`customer`, `feature`) are this demo's contract. Real use needs an agreed account and feature mapping.
- The cache is per server instance, not shared.
- The Sentry name appears in code and docs as nominative use only. The video uses "error-monitoring provider" unless Sentry gives written permission.
