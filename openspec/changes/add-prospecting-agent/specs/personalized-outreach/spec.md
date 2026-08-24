## ADDED Requirements

### Requirement: Personalized message per contact
For each chosen contact the agent SHALL compose a short email (subject + body) that names a specific, evidenced fact about the account, connects it to a product offering from the business docs, follows the messaging guidelines (tone, length, banned phrases), and ends with a single clear ask. Messages SHALL NOT be templated copies across contacts.

#### Scenario: Message references account research
- **WHEN** an email is composed for a contact
- **THEN** its body references at least one fact sourced from that account's research or CRM record

#### Scenario: Guidelines enforced
- **WHEN** the composed message exceeds the length limit or contains a banned phrase from the guidelines
- **THEN** the send tool rejects it with `ok: false` and the agent must revise

### Requirement: Send through HubSpot
Sends SHALL use HubSpot's transactional single-send API from `HUBSPOT_SENDER_EMAIL`, so the email is logged on the contact timeline, honors HubSpot subscription status, and includes the required unsubscribe footer. The recipient SHALL be the contact's HubSpot email; the model SHALL NOT supply an arbitrary address.

#### Scenario: Sent and logged
- **WHEN** a send succeeds
- **THEN** the email appears on the contact's timeline and the tool returns the send ID

#### Scenario: Recipient fixed
- **WHEN** the agent supplies a recipient address different from the contact's record
- **THEN** the tool sends to the record's email (or refuses) and never to the supplied address

### Requirement: Kill switch and daily cap
When `OUTREACH_ENABLED` is false the send tool SHALL NOT send; it SHALL instead record the composed message as a note on the contact titled as a draft. Across a run, successful sends SHALL NOT exceed `OUTREACH_DAILY_CAP`; once reached, further sends are recorded as drafts.

#### Scenario: Disabled
- **WHEN** `OUTREACH_ENABLED=false`
- **THEN** no email is sent and each composed message is stored as a draft note on the contact

#### Scenario: Cap reached
- **WHEN** the run has already sent `OUTREACH_DAILY_CAP` emails
- **THEN** subsequent send calls store drafts and return `ok: true, sent: false, reason: "cap"`

### Requirement: Every outcome recorded on the CRM
For every company in the batch the run SHALL leave a note on the company summarizing what was done (contacts chosen, sent/drafted/skipped with reason, research sources) and SHALL create a follow-up task for the company owner when an email was sent.

#### Scenario: Sent outcome recorded
- **WHEN** an email is sent to a contact
- **THEN** the company has a note describing it and a follow-up task assigned to the company owner

#### Scenario: Skipped outcome recorded
- **WHEN** an account is skipped (no eligible contact, research failed, etc.)
- **THEN** the company has a note stating the skip reason

### Requirement: At-most-once send per contact per run
A second send call for the same contact in the same run SHALL be refused, and a send whose outcome is unknown (timeout) SHALL NOT be retried automatically.

#### Scenario: Duplicate send refused
- **WHEN** the agent calls send twice for the same contact in one run
- **THEN** the second call returns `ok: false` and nothing is sent

#### Scenario: Unknown outcome not retried
- **WHEN** the send request times out
- **THEN** the tool reports the uncertain outcome and does not resend
