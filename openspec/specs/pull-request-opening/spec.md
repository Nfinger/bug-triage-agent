# pull-request-opening Specification

## Requirements

### Requirement: Push access is verified before any fix work starts
Before the workspace is set up or any investigation or code changes begin, the system SHALL verify that the configured GitHub token has push permission on the target repository. If it does not, the agent SHALL comment the specific, actionable permission error (naming the missing PAT scopes) on the originating issue immediately and stop — no clone, fix, or PR work is attempted. The check SHALL also be enforced inside workspace setup so it cannot be skipped.

#### Scenario: Token lacks push permission
- **WHEN** the coding agent is dispatched and the token's permissions on the target repository do not include push
- **THEN** the issue receives a comment naming the missing scopes (Contents and Pull requests read/write) and no workspace setup, investigation, or code changes occur

#### Scenario: Token has push permission
- **WHEN** the preflight confirms push permission
- **THEN** fix work proceeds normally

#### Scenario: Workspace setup independently refuses without push access
- **WHEN** workspace setup is invoked while the token lacks push permission
- **THEN** setup returns the permission error without cloning

### Requirement: A validated fix becomes exactly one pull request per issue
After its checks pass, the agent SHALL push the work branch and open a pull request against the repository's default branch via a bound tool. The PR body SHALL reference the originating issue with a closing keyword (`Fixes #<number>`) and summarize the change and how it was validated. The agent SHALL open at most one PR per issue conversation, reusing the existing PR for any follow-up pushes.

#### Scenario: Fix results in a linked PR
- **WHEN** the agent completes a validated fix for issue #42
- **THEN** the repository has exactly one open PR from the work branch whose body contains `Fixes #42` and a summary of the change

#### Scenario: Follow-up work does not open a second PR
- **WHEN** the agent revises its fix after the PR already exists
- **THEN** the revision is pushed to the same branch and no additional PR is created

### Requirement: The outcome is reported on the originating issue
Once the PR is opened, the agent SHALL comment on the originating issue with the PR link. If the agent gives up — cannot reproduce, fix out of scope, checks unfixable — it SHALL instead comment on the issue explaining why no PR was opened.

#### Scenario: Success comment links the PR
- **WHEN** the PR for an issue is created
- **THEN** the issue gains a comment containing the PR URL

#### Scenario: Failure is explained, not silent
- **WHEN** the agent abandons a fix attempt
- **THEN** the issue gains a comment explaining the reason, and no PR exists for that attempt

### Requirement: Publishing failures are surfaced
If pushing the branch or creating the PR fails (auth, permissions, API error), the tool result SHALL record the error and the agent SHALL report the failure rather than claiming success.

#### Scenario: PR creation fails
- **WHEN** the pull-request API call returns an error
- **THEN** the conversation records the failed tool result and no success is reported for that fix
