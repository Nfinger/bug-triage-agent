# hubspot-crm-access Delta

## MODIFIED Requirements

### Requirement: Bounded write access
Write tools SHALL be limited to: creating a contact, associating a contact with a company, creating a company (only through the sourcing agent's guarded creation tool, subject to its dedupe, evidence, and per-run cap rules), creating a note on a company or contact, creating a task on a company, setting a fixed set of prospecting properties, creating the fixed custom property definitions when absent, and sending an email. No tool SHALL delete or merge objects, change ownership, or modify deals.

#### Scenario: Destructive operation unavailable
- **WHEN** the agent attempts any operation other than those listed
- **THEN** no such tool exists to call and nothing is changed in HubSpot

#### Scenario: Company creation only via the guarded tool
- **WHEN** any agent other than the sourcing agent attempts to create a company
- **THEN** no such tool is available to it
