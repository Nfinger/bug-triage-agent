## ADDED Requirements

### Requirement: Persona-driven selection
For each selected company the agent SHALL choose up to `OUTREACH_CONTACTS_PER_COMPANY` contacts whose job titles match the target personas defined in the business docs, preferring contacts with recent inbound activity, then seniority, then most recently created.

#### Scenario: Persona match preferred
- **WHEN** a company has contacts with titles matching a target persona and others that do not
- **THEN** only persona-matching contacts are chosen

#### Scenario: No matching contact
- **WHEN** no existing contact matches a target persona
- **THEN** the agent may create a contact only if research produced a named person with a verified-format email on the company's domain; otherwise it records a task for a human and skips the account

### Requirement: Hard exclusions enforced in code
The selection tool SHALL exclude, regardless of model input: contacts with unsubscribed or non-opted-in email subscription status, contacts with a hard bounce, contacts (or their company) marked do-not-contact / do-not-prospect, contacts with an email outside the company's domain, and contacts emailed within `OUTREACH_COOLDOWN_DAYS`.

#### Scenario: Unsubscribed contact excluded
- **WHEN** a contact's email subscription status is unsubscribed
- **THEN** the contact is not returned as a candidate and cannot be sent to

#### Scenario: Recently emailed excluded
- **WHEN** a contact received any email from the sender within the cooldown window
- **THEN** the contact is excluded

#### Scenario: Foreign domain excluded
- **WHEN** a contact's email domain does not match the company domain
- **THEN** the contact is excluded

### Requirement: Created contacts are marked
Any contact the agent creates SHALL be associated to the company and flagged with a property identifying it as agent-created and the run date, so humans can audit and clean up.

#### Scenario: Agent-created contact
- **WHEN** the agent creates a contact
- **THEN** the contact is associated with the company and carries the agent-created marker
