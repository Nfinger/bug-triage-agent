# Design: Manual Prospecting Run

## Context

The prospecting agent is cron-dispatched with a date-keyed idempotency id (`prospecting-YYYY-MM-DD`), and skips stamp a 30-day cooldown (`last_prospected_at`). Retrying a company same-day therefore needs (a) a run id that isn't the consumed daily key and (b) the cooldown cleared. Prod secrets aren't available locally, so the trigger must live in the deployed worker.

## Goals / Non-Goals

**Goals:** an operator can start one prospecting run on demand and un-cooldown specific companies, with a single secret, no new attack surface when unconfigured.
**Non-Goals:** changing the cron path, its idempotency, or any outreach guardrail; a general admin API.

## Decisions

1. **Route in the Hono app (`/schedules/prospecting/run`), not a new channel.** It's one operator action, not an event source; `src/app.ts` stays the explicit route map (house rule).
2. **Unique manual run id, daily key untouched.** `dispatchProspecting(firedAt, { runId })` — the manual id is `prospecting-<date>-manual-<ts>`. The cron path continues to pass no runId and keeps its absorb-duplicates behavior. Contact-level protections (eligibility re-check, ledger, contact cooldown) are unchanged, so a manual run cannot double-email anyone.
3. **Cooldown reset is explicit and per-domain.** The request must name domains; nothing is reset implicitly. Clearing `last_prospected_at` also bumps `hs_lastmodifieddate`, which keeps the company inside the selector's recently-modified search window.
4. **Fail-closed auth.** No `PROSPECTING_MANUAL_TOKEN` secret → 404 (route effectively absent). Token compared via SHA-256 digests to avoid a timing oracle. The token gates dispatching real CRM work, so it is a secret, not a var.
5. **`dispatchProspecting` returns `{ dispatched, selected, considered }`** so the endpoint (and logs) can say whether anything actually ran; `scheduled()` ignores the return value.

## Risks / Trade-offs

- [Manual runs bypass same-day idempotency] → That is the feature; the id prefix makes manual runs auditable, and company/contact cooldowns still bound outreach.
- [Second run writes a second same-day note on companies] → Acceptable; notes are the audit trail.
- [Endpoint abuse if token leaks] → Worst case is extra draft-mode runs and cooldown resets; rotate by replacing the secret.

## Migration Plan

Deploy via CI (push to main); set `PROSPECTING_MANUAL_TOKEN` with `wrangler secret put`. Rollback: delete the secret (route 404s) or revert the commit.

## Open Questions

None.
