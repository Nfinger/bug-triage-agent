## ADDED Requirements

### Requirement: Weekly report is filed as a GitHub issue
At the end of each review run, the agent SHALL file its report as a GitHub issue in the configured tracker repository (`GITHUB_REPO`) via a bound tool using the authenticated Octokit client. The issue body SHALL contain the focus area, the overall summary, and every finding with its kind, severity, evidence, and proposed next step; the title SHALL identify the review, its focus area, and its date.

#### Scenario: Review becomes an issue
- **WHEN** a weekly review run completes successfully
- **THEN** a GitHub issue exists in the configured repository whose title names the architecture review, the focus area, and the run date, and whose body contains the summary and all findings with kind, severity, evidence, and next step

#### Scenario: Repository is fixed by configuration
- **WHEN** the filing tool runs
- **THEN** the issue is created in the repository named by `GITHUB_REPO`, never in a repository chosen by the model

### Requirement: Exactly one issue per weekly run
The agent SHALL create at most one architecture-review issue per run, and a re-delivered or repeated fire for the same date SHALL NOT produce a second issue.

#### Scenario: One issue per run
- **WHEN** a review run completes
- **THEN** exactly one architecture-review issue has been created for that run

#### Scenario: Repeated fire does not duplicate the issue
- **WHEN** a fire is repeated for a date whose review has already run
- **THEN** the repository still contains exactly one architecture-review issue for that date

### Requirement: Reports are labelled for discoverability
Filed issues SHALL carry the configured review label (`ARCH_REVIEW_LABEL`, default `architecture-review`) so past reports can be listed and read by the agent and by humans. If labelling fails, the issue SHALL still be filed and the result SHALL record that it was filed without the label.

#### Scenario: Issue is labelled
- **WHEN** a report issue is filed successfully
- **THEN** the issue carries the configured review label and is returned by a label-filtered issue listing

#### Scenario: Labelling is not permitted
- **WHEN** the issue cannot be created with the label (for example the token lacks label permission)
- **THEN** the issue is still created without the label and the tool result records that it was filed unlabelled

### Requirement: Filing failures are not silently dropped
If the GitHub API call fails, the failure SHALL be surfaced in the agent conversation as a failed tool result carrying the error, and the agent SHALL NOT claim the report was filed.

#### Scenario: GitHub API returns an error
- **WHEN** the report-filing tool call fails (for example a bad token or rate limit)
- **THEN** the agent conversation records the failed tool result with the error and reports the failure instead of a success

#### Scenario: Failure does not stop the schedule
- **WHEN** a run fails to file its issue
- **THEN** the weekly schedule remains registered and the next Friday's run proceeds normally
