# hubspot-crm-access Specification

## Purpose
TBD - created by archiving change add-prospecting-agent. Update Purpose after archive.
## Requirements
### Requirement: Portal fixed by configuration
All HubSpot access SHALL authenticate with a private-app access token from `HUBSPOT_ACCESS_TOKEN` and operate on the single portal that token belongs to. No tool SHALL accept a portal, token, or base URL from model input. Missing or blank configuration SHALL fail the run at startup with a clear error rather than at the first call.

#### Scenario: Token missing
- **WHEN** a prospecting run starts with `HUBSPOT_ACCESS_TOKEN` unset
- **THEN** the run fails before any agent step with an error naming the variable, and no outreach occurs

#### Scenario: Model names another portal
- **WHEN** the agent supplies any portal identifier or URL in a tool call
- **THEN** the tool ignores it and operates on the configured portal

### Requirement: Read access to CRM objects
The agent SHALL be able to read companies, contacts, deals, and their associations, plus engagement history (emails, notes, meetings, calls, tasks) and web-activity signals, through bounded read-only tools. Results SHALL be paginated with an explicit page cap and SHALL include the object IDs needed for subsequent writes.

#### Scenario: Company detail with associations
- **WHEN** the agent requests a company by ID
- **THEN** the tool returns its core properties (name, domain, industry, size, lifecycle stage, owner, last activity), associated contact IDs, and associated deal IDs

#### Scenario: Page cap respected
- **WHEN** a listing would return more objects than the configured page cap
- **THEN** the tool returns at most the cap and indicates that more exist

### Requirement: Bounded write access
Write tools SHALL be limited to: creating a contact, associating a contact with a company, creating a note on a company or contact, creating a task on a company, setting a fixed set of prospecting properties, and sending an email. No tool SHALL delete or merge objects, change ownership, or modify deals.

#### Scenario: Destructive operation unavailable
- **WHEN** the agent attempts any operation other than those listed
- **THEN** no such tool exists to call and nothing is changed in HubSpot

### Requirement: Rate limits and failures are surfaced
Tools SHALL retry HubSpot 429 responses with backoff up to a fixed attempt limit and SHALL return `ok: false` with the error on any other failure rather than throwing into the agent loop.

#### Scenario: Rate limited
- **WHEN** HubSpot returns 429
- **THEN** the tool waits per the `Retry-After` header (or a default backoff) and retries, up to the attempt limit

#### Scenario: Hard failure
- **WHEN** HubSpot returns a non-retryable error
- **THEN** the tool returns `ok: false` with a human-readable error and the agent reports it rather than assuming success

