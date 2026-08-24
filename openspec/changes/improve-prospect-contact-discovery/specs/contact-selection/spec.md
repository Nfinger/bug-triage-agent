# contact-selection Delta

## MODIFIED Requirements

### Requirement: Persona-driven selection
For each selected company the agent SHALL choose up to `OUTREACH_CONTACTS_PER_COMPANY` contacts whose job titles match the target personas defined in the business docs, preferring contacts with recent inbound activity, then seniority, then most recently created. The agent SHALL learn whether a company has eligible contacts before spending its research budget, so that discovery research can be prioritized when no contact exists.

#### Scenario: Persona match preferred
- **WHEN** a company has contacts with titles matching a target persona and others that do not
- **THEN** only persona-matching contacts are chosen

#### Scenario: No matching contact
- **WHEN** no existing contact matches a target persona
- **THEN** the agent attempts directed contact-discovery research, and may create a contact only if research produced a named person with a verified-format email on the company's domain from a page fetched this run; otherwise it records a task for a human and skips the account

#### Scenario: Skip documents discovery attempts
- **WHEN** the agent skips a company because no contact could be found or created
- **THEN** the recorded outcome documents the discovery attempts made (pages tried, searches run) so a human can pick up where the agent stopped

#### Scenario: Human task created on no-contact skip
- **WHEN** a company outcome is recorded as skipped because no eligible or creatable contact exists
- **THEN** a follow-up task to find a contact is created on the company in HubSpot, attributed to the prospecting agent and the run date
