# github-issue-filing Specification

## ADDED Requirements

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
