# bug-report-intake Specification

## ADDED Requirements

### Requirement: One agent conversation per Slack thread
The bug-triage agent SHALL be addressed with a stable conversation ID derived from the Slack team, channel, and thread timestamp, so all messages in one Slack thread land in the same agent conversation and separate threads stay separate.

#### Scenario: Follow-up in the same thread
- **WHEN** a user posts a follow-up message in an existing bug-report thread
- **THEN** it is delivered to the same agent conversation as the original report

#### Scenario: New top-level report
- **WHEN** a user posts a new top-level message in the bug-report channel
- **THEN** a new agent conversation is started for that thread

### Requirement: Bug reports arrive as signals with Slack metadata
Dispatched messages SHALL be delivered to the agent as `kind: 'signal'` messages carrying the report text plus Slack metadata: channel ID, thread timestamp, reporting user, and event ID.

#### Scenario: Report metadata is preserved
- **WHEN** a bug report is dispatched to the agent
- **THEN** the agent's conversation contains the message text and the Slack channel, thread, reporter, and event identifiers

### Requirement: Agent reads and summarizes bug reports
The bug-triage agent SHALL process each incoming bug report by producing a structured reading of it — at minimum a summary, severity assessment, and affected area — available in the agent conversation.

#### Scenario: Bug report is processed
- **WHEN** the agent receives a dispatched bug report signal
- **THEN** the agent run completes with a structured summary (summary, severity, affected area) of the report
