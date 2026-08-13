# slack-channel Specification

## Requirements

### Requirement: Verified Slack ingress
The app SHALL expose a Slack channel endpoint at `/channels/slack` (Events API at `POST /channels/slack/events`) that verifies every incoming request signature against the raw, unconsumed request body using the Slack signing secret before any handler runs.

#### Scenario: Valid Slack delivery is accepted
- **WHEN** Slack posts an event to `/channels/slack/events` with a valid signature
- **THEN** the request is accepted and the event handler runs

#### Scenario: Invalid signature is rejected
- **WHEN** a request arrives at `/channels/slack/events` with a missing or invalid Slack signature
- **THEN** the request is rejected without invoking any event handler or dispatching to an agent

#### Scenario: URL verification handshake
- **WHEN** Slack sends a `url_verification` challenge during Events API setup
- **THEN** the endpoint responds with the challenge value so Slack accepts the endpoint

### Requirement: Bug-report message filtering
The channel SHALL process only message events posted in the configured bug-report Slack channel (`SLACK_BUG_CHANNEL_ID`) and SHALL ignore events from other channels, bot-authored messages, and non-message event types.

#### Scenario: Message in the bug-report channel is processed
- **WHEN** a user posts a message in the configured bug-report channel
- **THEN** the message is dispatched to the bug-triage agent

#### Scenario: Message in another channel is ignored
- **WHEN** a message event arrives from a Slack channel other than the configured one
- **THEN** no dispatch occurs and the endpoint still returns a success response to Slack

#### Scenario: Bot messages are ignored
- **WHEN** a message event authored by a bot (including this app's own posts) arrives from the bug-report channel
- **THEN** no dispatch occurs

### Requirement: Idempotent dispatch
The channel SHALL use Slack's provider-stable `event_id` as the dispatch `idempotencyKey` so redelivered events are processed at most once.

#### Scenario: Slack redelivers an event
- **WHEN** Slack retries a delivery with the same `event_id`
- **THEN** the agent receives the message at most once

### Requirement: Fast acknowledgment
The channel handler SHALL acknowledge Slack deliveries immediately by returning a success response after dispatch is enqueued, without waiting for the agent run to complete.

#### Scenario: Agent processing is slow
- **WHEN** an event is dispatched and the agent run takes longer than Slack's 3-second acknowledgment window
- **THEN** the endpoint has already returned a success response and Slack does not mark the delivery failed
