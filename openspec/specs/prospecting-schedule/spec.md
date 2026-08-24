# prospecting-schedule Specification

## Purpose
TBD - created by archiving change add-prospecting-agent. Update Purpose after archive.
## Requirements
### Requirement: Daily cron-dispatched run
A Cloudflare Cron Trigger SHALL dispatch one `Prospecting` run per day. The run's conversation ID and idempotency key SHALL both derive from the fire's UTC date so a duplicate fire for the same day is a no-op. The agent SHALL expose no unauthenticated HTTP route; the only HTTP entry point is the operator-only manual-run endpoint.

#### Scenario: Duplicate fire
- **WHEN** Cloudflare delivers the same day's trigger twice
- **THEN** only one run executes and the second dispatch is absorbed without error

#### Scenario: Two crons coexist
- **WHEN** the architecture-review cron and the prospecting cron both exist
- **THEN** `scheduled()` routes each fire to its own dispatcher by cron expression

### Requirement: Enable flag
`PROSPECTING_ENABLED` SHALL gate scheduled runs; when false a fire logs and returns without dispatching. An invalid value SHALL throw.

#### Scenario: Disabled
- **WHEN** `PROSPECTING_ENABLED=false`
- **THEN** the cron fire is a logged no-op

### Requirement: Run summary posted to Slack
At the end of each run the agent SHALL post one summary message to `SLACK_PROSPECTING_CHANNEL_ID` listing accounts selected with their score rationale, contacts emailed (or drafted) with HubSpot links, and accounts skipped with reasons. A failed run SHALL post a failure summary.

#### Scenario: Successful run summary
- **WHEN** a run completes
- **THEN** a single Slack message summarizes sent, drafted, and skipped outcomes with links

#### Scenario: Run failure
- **WHEN** the run aborts after selection
- **THEN** a Slack message reports the failure and how far the run got

### Requirement: Manual trigger for verification
Exporting the dispatcher SHALL allow a run to be started by hand for a given date (for example via a script), using the same idempotency so it cannot duplicate that day's scheduled run. Additionally, a token-guarded HTTP endpoint SHALL start a one-off run with a unique manual run id that deliberately bypasses the same-day key, and MAY first clear the prospecting cooldown of named companies so the selector can pick them again. The endpoint SHALL be absent (404) when its token is not configured and SHALL reject requests without the correct bearer token; the token comparison SHALL not short-circuit on length or content.

#### Scenario: Manual run for today
- **WHEN** an operator invokes the dispatcher for today after the cron already ran
- **THEN** no second run occurs

#### Scenario: One-off HTTP run after the daily run
- **WHEN** an operator calls the manual-run endpoint with the correct token after today's run already happened
- **THEN** a new run dispatches under a unique manual run id and reports whether it dispatched and how many companies were selected

#### Scenario: Cooldown reset by domain
- **WHEN** the manual-run request names company domains to reset
- **THEN** each matching company's `last_prospected_at` is cleared before selection, and the response reports per-domain success or failure

#### Scenario: Unauthorized request
- **WHEN** the endpoint is called with a missing or wrong token, or the token secret is not configured
- **THEN** no run dispatches and nothing about the run's existence is revealed beyond a 401 (or 404 when unconfigured)

