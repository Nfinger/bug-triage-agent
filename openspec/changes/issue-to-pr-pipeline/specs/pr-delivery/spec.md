# pr-delivery Specification (Delta)

## ADDED Requirements

### Requirement: Credential preflight before work begins
Before any clone or fix work starts for an issue, the system SHALL verify that the configured GitHub token has push permission on the target repository. If it does not, the system SHALL comment the specific, actionable permission error on the issue immediately and stop without starting fix work.

#### Scenario: Token lacks push permission
- **WHEN** the coding agent is dispatched and the token's permissions on the target repository do not include push
- **THEN** the issue receives a comment naming the missing permission (e.g., Contents and Pull requests read/write) and no clone, fix, or PR work is attempted

#### Scenario: Token has push permission
- **WHEN** the preflight confirms push permission
- **THEN** fix work proceeds normally

### Requirement: Fix branch is pushed to the target repository
The agent SHALL deliver its committed fix by pushing the issue branch to the target repository using the configured token.

#### Scenario: Branch push succeeds
- **WHEN** the agent pushes branch `agent/issue-N` after committing a validated fix
- **THEN** the branch exists on the target repository's remote with the fix commit

#### Scenario: Branch push fails
- **WHEN** the push is rejected (e.g., authentication or permission error)
- **THEN** the failure is recorded in the tool result and reported on the issue as a comment; the agent does not claim delivery succeeded

### Requirement: Exactly one pull request per issue, referencing it
The agent SHALL open at most one pull request per issue conversation, from the issue branch into the default branch. The PR body SHALL reference the issue with a closing keyword (`Fixes #<n>`) and summarize the change and the validation performed.

#### Scenario: PR is opened for a validated fix
- **WHEN** the agent completes and validates a fix for issue N
- **THEN** an open pull request exists from `agent/issue-N` into the default branch whose body contains `Fixes #N` and a summary of the change and validation

#### Scenario: Re-delivered or repeated event does not duplicate the PR
- **WHEN** the agent conversation for issue N receives another trigger after its PR was opened
- **THEN** the target repository still has exactly one pull request originating from that conversation

### Requirement: PR link is reported back on the issue
After opening the pull request, the agent SHALL comment on the originating issue with a link to the PR, so the opt-in label's outcome is visible where the work was requested.

#### Scenario: Issue gains the PR link
- **WHEN** the pull request for issue N is created
- **THEN** issue N receives a comment containing the pull request URL

### Requirement: Delivery failures surface on the issue
Any failure in the delivery chain (preflight, push, PR creation, or link-back comment) SHALL be surfaced as a comment on the issue (or, if commenting itself fails, in the agent conversation record) — the pipeline SHALL NOT stall silently with finished work stranded locally.

#### Scenario: PR creation fails after a successful push
- **WHEN** the pull-request API call fails after the branch was pushed
- **THEN** the issue receives a comment stating the branch name that was pushed and the error that blocked PR creation
