# github-issue-filing Delta Specification

Delta on the `github-issue-filing` capability introduced by the `add-slack-channel` change. Existing filing/commenting requirements are unchanged; this adds the hand-off to the coding agent.

## ADDED Requirements

### Requirement: Code-fixable issues are labeled for the coding agent
When the triage agent files an issue for a report it judges to be a code-fixable bug in the configured repository, it SHALL apply the coding-agent label (`CODING_AGENT_LABEL`, default `agent-fix`) to the issue, triggering the coding-agent pipeline. The label SHALL be applied as a distinct labeling call after issue creation so GitHub emits an `issues.labeled` webhook event.

#### Scenario: Fixable bug report is handed off automatically
- **WHEN** the triage agent files an issue for a Slack report describing a reproducible product bug
- **THEN** the issue carries the coding-agent label and the labeling occurred as a separate API call after creation

#### Scenario: Non-code report is not handed off
- **WHEN** the triage agent files an issue for a report that is not a code fix (a question, a feature request, an infrastructure outage)
- **THEN** the issue is created without the coding-agent label

### Requirement: Labeling failure does not fail the filing
If applying the label fails after the issue was created, the tool result SHALL still report the created issue (number and URL) together with the labeling error, so the report is filed and the missed hand-off is visible rather than the whole filing appearing failed.

#### Scenario: Label API call errors after creation
- **WHEN** issue creation succeeds but the labeling call returns an error
- **THEN** the tool result contains the issue number and URL plus the labeling error, and the agent reports the issue as filed but not handed off
