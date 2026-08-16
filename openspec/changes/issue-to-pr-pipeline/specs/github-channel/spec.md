# github-channel Specification (Delta)

## ADDED Requirements

### Requirement: Verified GitHub webhook ingress
The app SHALL expose a GitHub webhook endpoint at `POST /channels/github/webhook` that verifies every delivery's signature against the raw request body using `GITHUB_WEBHOOK_SECRET` before any handler runs.

#### Scenario: Valid delivery is accepted
- **WHEN** GitHub posts a webhook delivery with a valid signature
- **THEN** the request is accepted and the webhook handler runs

#### Scenario: Invalid signature is rejected
- **WHEN** a request arrives at the webhook endpoint with a missing or invalid signature
- **THEN** the request is rejected without invoking the handler or dispatching to any agent

### Requirement: Agent-fix label events trigger the coding agent
The channel SHALL dispatch the coding agent when an issue in the configured repository (`GITHUB_REPO`) receives the `agent-fix` label (an `issues` event with action `labeled` where the label is `agent-fix`). All other verified deliveries SHALL be acknowledged without dispatch.

#### Scenario: Issue labeled agent-fix
- **WHEN** an issue in the configured repository is labeled `agent-fix`
- **THEN** the coding agent is dispatched with the issue's repository, number, title, and body

#### Scenario: Other label is ignored
- **WHEN** an issue is labeled with any label other than `agent-fix`
- **THEN** no dispatch occurs and the delivery is acknowledged successfully

#### Scenario: Event from another repository is ignored
- **WHEN** a verified `agent-fix` label event arrives for a repository other than the configured one
- **THEN** no dispatch occurs

### Requirement: One coding-agent conversation per issue
The channel SHALL address the coding agent with a stable conversation ID derived from the repository owner, repository name, and issue number, so all events for one issue land in the same durable conversation.

#### Scenario: Label re-applied to the same issue
- **WHEN** the `agent-fix` label is removed and re-applied to an issue that already has a coding-agent conversation
- **THEN** the event is delivered to that existing conversation, not a new one

### Requirement: Idempotent dispatch
The channel SHALL use GitHub's webhook delivery ID as the dispatch idempotency key so redelivered events are processed at most once.

#### Scenario: GitHub redelivers an event
- **WHEN** GitHub redelivers a webhook with a delivery ID that was already processed
- **THEN** the coding agent receives the corresponding message at most once
