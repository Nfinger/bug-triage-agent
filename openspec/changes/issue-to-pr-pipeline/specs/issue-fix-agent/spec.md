# issue-fix-agent Specification (Delta)

## ADDED Requirements

### Requirement: Per-issue workspace on a dedicated branch
When dispatched for an issue, the coding agent SHALL work in a real (host-backed) sandbox with the target repository cloned into a working directory unique to that issue, on a branch named `agent/issue-<n>` created from the repository's default branch.

#### Scenario: Workspace is prepared for a new issue
- **WHEN** the coding agent starts work on issue N for the first time
- **THEN** the target repository is cloned into a working directory scoped to issue N and a branch `agent/issue-N` exists, checked out from the default branch

#### Scenario: Two issues do not share a workspace
- **WHEN** coding-agent conversations exist for two different issues
- **THEN** each operates in its own working directory and branch, and neither sees the other's uncommitted changes

### Requirement: Fix is scoped to the issue and committed
The agent SHALL implement a fix addressing the labeled issue's reported behavior and commit it on the issue branch with a message referencing the issue number. It SHALL NOT make unrelated changes outside the scope of the issue.

#### Scenario: Fix is committed on the issue branch
- **WHEN** the agent completes a fix for issue N
- **THEN** the branch `agent/issue-N` contains at least one commit whose message references issue N, and the diff is limited to the fix

### Requirement: Repository validation runs before delivery
Before delivering its work, the agent SHALL run the target repository's own validation commands (at minimum lint and typecheck where the repository provides them, plus tests when feasible) and SHALL NOT open a pull request while validation it ran is failing due to its change.

#### Scenario: Validation passes
- **WHEN** the agent's fix passes the repository's lint/typecheck/tests
- **THEN** the agent proceeds to deliver the branch as a pull request

#### Scenario: Validation fails due to the change
- **WHEN** the repository's validation fails because of the agent's change and the agent cannot resolve the failure
- **THEN** no pull request is opened and the agent reports the failure on the issue instead

#### Scenario: Pre-existing failure is not blocking
- **WHEN** a validation failure is demonstrated to exist on the default branch independent of the agent's change
- **THEN** the agent may still deliver, noting the pre-existing failure in its report

### Requirement: Inability to fix is reported honestly
If the agent cannot produce a fix — the issue is unclear, the fix is out of reach, or the environment blocks it — it SHALL comment its findings and the specific blocker on the GitHub issue rather than opening a speculative pull request or ending silently.

#### Scenario: Agent cannot produce a fix
- **WHEN** the agent concludes it cannot implement a correct fix for the issue
- **THEN** the issue receives a comment describing what was investigated and why no PR was opened, and no pull request is created
