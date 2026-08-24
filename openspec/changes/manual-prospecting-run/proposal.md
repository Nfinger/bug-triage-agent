# Manual Prospecting Run

## Why

There is no way to trigger a one-off prospecting run in prod: the cron is the only entry point, the local script needs env vars that exist only as prod secrets, and the date-keyed idempotency absorbs any same-day retry. Concretely: Point Lookout Resort was skipped on 2026-08-24 for lack of a contact, the new contact-discovery behavior is deployed, but nothing can retry the company today — the 2026-08-24 run id is consumed and the skip stamped a 30-day cooldown on the company.

## What Changes

- Add a token-guarded HTTP endpoint (`POST /schedules/prospecting/run`) that dispatches a one-off prospecting run with a unique manual run id, bypassing the same-day idempotency key on purpose (the daily key still protects the cron path).
- The endpoint accepts an optional `resetDomains` list: each named company's `last_prospected_at` is cleared so the selector can pick it again.
- The endpoint is disabled unless a new secret (`PROSPECTING_MANUAL_TOKEN`) is configured; requests without the bearer token get 404/401. **BREAKING** (spec-level): the prospecting agent is no longer strictly "no HTTP route" — it gains one operator-only route.
- `dispatchProspecting` returns a small result (dispatched, selected, considered) so callers can report what happened.
- New `Crm` helpers: find a company by exact domain; clear the cooldown stamp.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `prospecting-schedule`: "Daily cron-dispatched run" loses the blanket no-HTTP-route clause (replaced by: no unauthenticated route); "Manual trigger for verification" gains the HTTP one-off with unique run id and optional cooldown reset.

## Impact

- `src/schedules/prospecting.ts` (options + return value), new `src/schedules/prospecting-manual.ts`, `src/app.ts` (mount route), `src/prospecting/config.ts` (token), `src/prospecting/crm.ts` (two helpers), `tests/manual-run.test.mjs`.
- New prod secret `PROSPECTING_MANUAL_TOKEN`. No schema or cron changes.
