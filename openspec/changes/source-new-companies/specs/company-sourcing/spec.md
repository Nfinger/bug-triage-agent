# company-sourcing Specification

## ADDED Requirements

### Requirement: Scheduled sourcing run
A Cloudflare Cron Trigger SHALL dispatch one `Sourcing` run per weekday, before the day's prospecting run, with a date-keyed conversation ID and idempotency key so a duplicate fire is a no-op. `SOURCING_ENABLED` SHALL gate scheduled runs. A token-guarded manual endpoint SHALL start a one-off sourcing run under a unique manual run id, reusing the prospecting manual-run token.

#### Scenario: Daily fire
- **WHEN** the sourcing cron fires on a weekday
- **THEN** one sourcing run dispatches, and a second fire the same day is absorbed

#### Scenario: Disabled
- **WHEN** `SOURCING_ENABLED=false`
- **THEN** the fire logs and returns without dispatching

#### Scenario: Manual one-off
- **WHEN** an operator calls the sourcing manual endpoint with the correct bearer token
- **THEN** a run dispatches under a unique manual run id and the response reports the outcome

### Requirement: Category rotation in code
Each run SHALL receive a focus category selected deterministically from the run date over the ICP's business categories, so consecutive runs cover different segments. The agent MAY also record finds outside the focus category, but its research SHALL start from the assigned focus.

#### Scenario: Rotation is deterministic
- **WHEN** two dispatches occur for the same run date
- **THEN** both carry the same focus category

#### Scenario: Consecutive days differ
- **WHEN** runs fire on consecutive weekdays
- **THEN** their focus categories differ until the rotation wraps

### Requirement: Bounded web research per run
Sourcing research SHALL use the existing read-only fetch and search tools under a per-run budget (fetches and searches), with the same URL-safety refusals. Page text remains untrusted data.

#### Scenario: Run budget exhausted
- **WHEN** the sourcing run exceeds its fetch or search budget
- **THEN** the tools return `ok: false` and the agent proceeds to record what it has

### Requirement: Guarded company creation
A `create_company` tool SHALL create at most `SOURCING_MAX_COMPANIES` companies per run. Each creation SHALL require, enforced in code: a normalized domain not already present in HubSpot (deduped by domain search); that the company's own site was fetched this run; a Maine location evidenced by that site; an industry from the ICP list; and a name. Created companies SHALL be marked `agent_sourced` with the run date, and a note SHALL record the source URLs. The tool SHALL refuse excluded and free-mail domains. No tool SHALL delete or modify existing companies.

#### Scenario: Duplicate domain refused
- **WHEN** a company with the candidate's domain already exists in HubSpot
- **THEN** creation is refused and the existing company is reported instead

#### Scenario: Unfetched site refused
- **WHEN** the candidate's own site was not fetched this run
- **THEN** creation is refused — only businesses whose site the run actually read can be added

#### Scenario: Per-run cap
- **WHEN** the run has already created `SOURCING_MAX_COMPANIES` companies
- **THEN** further creations are refused

#### Scenario: Provenance recorded
- **WHEN** a company is created
- **THEN** it carries the agent-sourced marker and run date, and a note lists the URLs the find came from

### Requirement: Custom properties ensured at fire time
The sourcing dispatcher SHALL ensure the custom company properties it writes exist in the portal, creating them idempotently when absent, so a fresh portal needs no manual setup step.

#### Scenario: Property missing
- **WHEN** the portal lacks `agent_sourced` at fire time
- **THEN** the dispatcher creates it and the run proceeds

### Requirement: Run summary posted to Slack
Each sourcing run SHALL post one Slack summary listing companies created (name, domain, category, source), candidates skipped with reasons (duplicate, out-of-state, no domain), and budget spent. A run that creates nothing SHALL say so and why.

#### Scenario: Successful run summary
- **WHEN** a sourcing run completes
- **THEN** a single Slack message lists creations with links and skips with reasons
