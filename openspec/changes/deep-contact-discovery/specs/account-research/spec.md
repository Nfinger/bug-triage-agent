# account-research Delta

## MODIFIED Requirements

### Requirement: Contact-discovery research
When a selected company has no eligible contacts, the system SHALL grant that company a bonus research allowance (additional fetches and searches) in code — the grant is deterministic, happens at most once per company per run, and is not requestable by the model. The agent SHALL direct discovery research at finding a named person in a target persona: people-oriented pages on the company site (team, about, staff, leadership, contact — including links observed on already-fetched pages and common well-known paths) and people-focused web searches (company name with persona titles, press releases, announcements). A named person with a title appearing in a web-search result snippet MAY be used as a discovery lead, recorded with the result URL, even when the page behind the result cannot be fetched; snippet content SHALL NOT be used as evidence for outreach claims. When a page fetch fails, the agent SHALL try a reasonable alternate URL for the same information rather than abandoning discovery while budget remains.

#### Scenario: Discovery bonus granted once
- **WHEN** listing eligible contacts for a selected company returns no one
- **THEN** the company's research allowance is increased by the discovery bonus, exactly once per run, regardless of how many times the list is re-requested

#### Scenario: No bonus when contacts exist
- **WHEN** listing eligible contacts for a selected company returns at least one contact
- **THEN** no discovery bonus is granted and the standard research budget applies

#### Scenario: Discovery directed at people pages
- **WHEN** a company has no eligible contacts and discovery budget remains
- **THEN** the agent fetches people-oriented pages and runs people-focused searches before concluding no contact can be found

#### Scenario: Snippet names a person on an unfetchable page
- **WHEN** a search result snippet names a person and title at the company but the result page cannot be fetched
- **THEN** the person is treated as a discovery lead (recorded with the result URL) for email lookup and for the skip record, but the snippet is not evidence for outreach claims

## ADDED Requirements

### Requirement: Provider email lookups
When an email-finder provider key is configured, the agent SHALL be able to look up email addresses for a selected company by domain, optionally narrowed by a person's name. Lookups SHALL be capped per company per run. Only results at or above the configured confidence threshold SHALL be recorded, in code, as verified addresses usable for contact creation; lower-confidence results are reported as information only. The lookup tool SHALL NOT exist when no provider key is configured, and lookups SHALL be restricted to domains of companies in the run's batch.

#### Scenario: Verified email recorded
- **WHEN** a lookup returns an address on the company's domain at or above the confidence threshold
- **THEN** the address (with the provider's name and title fields) is recorded as verified for this run and reported to the agent

#### Scenario: Low-confidence result not usable
- **WHEN** a lookup returns an address below the confidence threshold
- **THEN** the result is reported as unverified and cannot be used to create a contact

#### Scenario: Lookup cap reached
- **WHEN** the per-company lookup cap is exhausted
- **THEN** further lookups for that company return `ok: false` explaining the cap

#### Scenario: No key configured
- **WHEN** `HUNTER_API_KEY` is not set
- **THEN** the lookup tool is not offered to the agent and discovery proceeds with fetch-and-search only
