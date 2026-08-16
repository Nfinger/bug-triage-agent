# github-issue-filing Specification

## Requirements

### Requirement: Summarized report is filed as a GitHub issue
After producing its structured reading of a bug report, the bug-triage agent SHALL create a GitHub issue in the configured repository (`GITHUB_REPO`) via a bound tool using the authenticated Octokit client. The issue SHALL contain the structured summary (summary, severity, affected area) and a reference back to the originating Slack message (reporter and thread).

#### Scenario: New bug report becomes an issue
- **WHEN** the agent finishes processing a new top-level bug report from Slack
- **THEN** a GitHub issue exists in the configured repository containing the summary, severity, affected area, and a reference to the Slack thread and reporter

### Requirement: Exactly one issue per Slack thread
The agent SHALL create at most one GitHub issue per Slack bug-report thread, retaining the created issue number in its conversation so subsequent messages in the thread never open a duplicate issue.

#### Scenario: Follow-up does not duplicate the issue
- **WHEN** a follow-up message arrives in a Slack thread whose report has already been filed
- **THEN** no new GitHub issue is created

#### Scenario: Redelivered event does not duplicate the issue
- **WHEN** Slack redelivers an already-processed event for a filed thread
- **THEN** the repository still contains exactly one issue for that thread

### Requirement: Follow-ups are appended as issue comments
When a follow-up message arrives in a Slack thread whose issue has been filed, the agent SHALL append the follow-up content as a comment on that existing GitHub issue.

#### Scenario: Thread reply becomes an issue comment
- **WHEN** a user replies in a bug-report thread after the issue was created
- **THEN** the existing GitHub issue gains a comment carrying the follow-up content

### Requirement: Filing failures are not silently dropped
If the GitHub API call fails, the failure SHALL be surfaced in the agent conversation (the tool result records the error) rather than being swallowed, so an unfiled report is observable.

#### Scenario: GitHub API returns an error
- **WHEN** the issue-creation tool call fails (e.g., bad token, rate limit)
- **THEN** the agent conversation records the failed tool result and no success is reported for that report

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
