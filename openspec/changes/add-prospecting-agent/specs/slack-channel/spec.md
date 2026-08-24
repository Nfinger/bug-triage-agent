## ADDED Requirements

### Requirement: Outbound run-summary posting
The Slack integration SHALL support posting a message to a configured channel (`SLACK_PROSPECTING_CHANNEL_ID`) using a bot token (`SLACK_BOT_TOKEN`) with the `chat:write` scope, independent of the inbound Events API route. Posting failures SHALL be logged and SHALL NOT fail the originating run.

#### Scenario: Summary posted
- **WHEN** the prospecting run finishes
- **THEN** a message is posted to the configured channel

#### Scenario: Post fails
- **WHEN** Slack rejects the post
- **THEN** the error is logged and the run's CRM writes remain intact
