# account-research Delta

## ADDED Requirements

### Requirement: Contact-discovery research
When a selected company has no eligible contacts, the system SHALL grant that company a bonus research allowance (additional fetches and searches) in code — the grant is deterministic, happens at most once per company per run, and is not requestable by the model. The agent SHALL direct discovery research at finding a named person in a target persona: people-oriented pages on the company site (team, about, staff, leadership, contact — including links observed on already-fetched pages and common well-known paths) and people-focused web searches (company name with persona titles, press releases, announcements). When a page fetch fails, the agent SHALL try a reasonable alternate URL for the same information rather than abandoning discovery while budget remains.

#### Scenario: Discovery bonus granted once
- **WHEN** listing eligible contacts for a selected company returns no one
- **THEN** the company's research allowance is increased by the discovery bonus, exactly once per run, regardless of how many times the list is re-requested

#### Scenario: No bonus when contacts exist
- **WHEN** listing eligible contacts for a selected company returns at least one contact
- **THEN** no discovery bonus is granted and the standard research budget applies

#### Scenario: Discovery directed at people pages
- **WHEN** a company has no eligible contacts and discovery budget remains
- **THEN** the agent fetches people-oriented pages and runs people-focused searches before concluding no contact can be found

## MODIFIED Requirements

### Requirement: Research is bounded per account
Each account SHALL be limited to a fixed number of successful fetches and searches per run, and each fetched page SHALL be size-capped. A fetch that fails (HTTP error status or network failure) SHALL NOT consume the fetch budget, but total fetch attempts per account SHALL be bounded by a separate attempt cap so retries cannot loop. Private, loopback, and non-HTTP(S) URLs SHALL be refused.

#### Scenario: Per-account budget exhausted
- **WHEN** the agent exceeds the fetch or search budget for an account
- **THEN** the tool returns `ok: false` explaining the budget is spent and the agent proceeds with what it has

#### Scenario: Failed fetch does not consume budget
- **WHEN** a page fetch returns an HTTP error or fails at the network level
- **THEN** the fetch budget is not decremented, the failure counts toward the attempt cap, and the agent may try an alternate URL

#### Scenario: Attempt cap reached
- **WHEN** total fetch attempts (successes plus failures) for an account reach the attempt cap
- **THEN** further fetches for that account return `ok: false` explaining the cap is reached

#### Scenario: Internal address refused
- **WHEN** the agent requests a URL resolving to a private network or localhost
- **THEN** the tool refuses without making a request
