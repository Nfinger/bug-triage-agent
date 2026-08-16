# github-issue-intake Specification

## Requirements

### Requirement: GitHub webhook deliveries are verified before processing
The application SHALL expose a GitHub webhook endpoint (mounted at `/channels/github/webhook`) that verifies each delivery's signature against `GITHUB_WEBHOOK_SECRET` using the raw request body. Deliveries that fail verification SHALL be rejected without dispatching any agent.

#### Scenario: Valid delivery is accepted
- **WHEN** GitHub posts an `issues` event signed with the configured webhook secret
- **THEN** the endpoint responds with a 2xx status and the event proceeds to filtering

#### Scenario: Invalid signature is rejected
- **WHEN** a request arrives whose signature does not match the configured secret
- **THEN** the request is rejected and no agent conversation is created or messaged

### Requirement: Only label-opted issues in the configured repository are dispatched
The channel SHALL dispatch to the coding agent only for `issues` events with action `labeled` where the applied label matches the configured coding-agent label (`CODING_AGENT_LABEL`, default `agent-fix`) and the repository matches the configured `GITHUB_REPO`. All other events (other actions, other labels, other repositories, bot-initiated noise) SHALL be ignored.

#### Scenario: Labeling an issue triggers the coding agent
- **WHEN** a person applies the coding-agent label to an issue in the configured repository
- **THEN** a coding-agent conversation for that issue is dispatched with the issue's number, title, and repository recorded as initial data

#### Scenario: Unrelated label is ignored
- **WHEN** an issue is labeled with any label other than the coding-agent label
- **THEN** no coding-agent conversation is created or messaged

#### Scenario: Event from another repository is ignored
- **WHEN** an `issues` event arrives for a repository other than the configured one
- **THEN** no coding-agent conversation is created or messaged

### Requirement: Exactly one coding-agent conversation per issue
The channel SHALL derive the agent instance id from the repository and issue number, so all deliveries for one issue converge on one conversation, and SHALL pass the webhook delivery id as the idempotency key so redelivered or duplicate label events do not restart or duplicate work.

#### Scenario: Redelivered webhook does not duplicate work
- **WHEN** GitHub redelivers a label event already processed for an issue
- **THEN** the existing conversation is unchanged and no second fix attempt begins

#### Scenario: Label removed and re-applied converges on the same conversation
- **WHEN** the coding-agent label is removed and later re-applied to the same issue
- **THEN** the dispatch targets the same conversation for that issue rather than creating a parallel one
