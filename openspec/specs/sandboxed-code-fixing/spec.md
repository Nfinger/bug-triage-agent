# sandboxed-code-fixing Specification

## Requirements

### Requirement: All code work happens inside a per-issue Cloudflare sandbox
The coding agent SHALL attach a Cloudflare sandbox (via `useSandbox` with the `@cloudflare/sandbox` provider) whose identity is derived from the issue (`owner/repo#issueNumber`), so each issue gets exactly one isolated container shared by the orchestrator and its worker subagents. All repository access — cloning, editing, running commands — SHALL happen inside that sandbox, never on the host worker.

#### Scenario: Sandbox is scoped to the issue
- **WHEN** two issues are dispatched to the coding agent concurrently
- **THEN** each issue's orchestrator and subagents operate in that issue's own sandbox and neither issue sees the other's working tree

### Requirement: The agent works on a dedicated branch of a fresh clone
At the start of a fix attempt, the agent SHALL clone the configured repository into the sandbox (authenticated with `GITHUB_TOKEN`), and create a work branch named for the issue (e.g. `agent/issue-<number>`) off the repository's default branch. Commits SHALL land only on that work branch.

#### Scenario: Work branch is created from the default branch
- **WHEN** the agent begins working on issue #42
- **THEN** the sandbox contains a clone of the configured repository with a branch such as `agent/issue-42` checked out, based on the current default branch

#### Scenario: Default branch is never committed to
- **WHEN** the agent commits its changes
- **THEN** the default branch in the clone has no new commits; all commits are on the work branch

### Requirement: Fixes are validated in the sandbox before being proposed
Before publishing anything, the agent SHALL run the project's available checks (at minimum its type/build check, plus tests when the project defines them) inside the sandbox and SHALL treat a failing check as an unfinished fix — either iterating or reporting failure, never proposing a branch whose checks fail.

#### Scenario: Checks pass before a PR is opened
- **WHEN** the agent decides its fix is complete
- **THEN** the project's checks have been run in the sandbox on the work branch and reported success

#### Scenario: Persistently failing checks abort the proposal
- **WHEN** the agent cannot get the project's checks to pass after iterating
- **THEN** no branch is pushed and the failure is reported on the issue instead

### Requirement: Repeated sandbox tool failures are bounded and terminal
The system SHALL bound repeated sandbox tool failures instead of letting the model loop on them. After a small number of identical consecutive failures of one tool, the error result SHALL carry explicit guidance to stop repeating the call; past a hard threshold (identical failures of one tool, or consecutive failures across sandbox tools), the sandbox tool set SHALL be disabled for the rest of the run and every further sandbox call SHALL fail fast with an instruction to publish a blocker comment and stop. A new submission (label retry) SHALL start with a clean failure count.

#### Scenario: Identical failures trip the breaker
- **WHEN** the same sandbox tool fails the same way five times in a row (for example because the container cannot be scheduled)
- **THEN** sandbox tools are disabled for the remainder of the run and every subsequent sandbox call returns a fast, explicit instruction to report the blocker on the issue instead of retrying

#### Scenario: A label retry starts clean
- **WHEN** the coding label is re-applied after a run whose breaker tripped
- **THEN** the new submission begins with sandbox tools enabled and failure counters reset

### Requirement: Partial work is checkpointed before the run ends
The agent SHALL be warned, inside tool results, when its wall-clock budget is nearly exhausted, with instructions to commit, push the work branch, and publish (PR or blocker comment) instead of starting new work. When a run's submission settles as failed anyway, the system SHALL attempt a mechanical checkpoint — commit dirty state and push the work branch when it carries commits beyond the default branch — so partial work survives the sandbox.

#### Scenario: Deadline warnings precede the abort
- **WHEN** a run approaches the end of its three-hour budget
- **THEN** sandbox tool results carry a deadline notice telling the agent to checkpoint and publish, before the hard abort fires

#### Scenario: A failed run preserves its commits
- **WHEN** a run's submission settles as failed while the work branch holds commits beyond the default branch
- **THEN** the branch is pushed to the remote and the blocker comment names it (marked as not validated)

### Requirement: Credentials do not leak into the repository or its history
The `GITHUB_TOKEN` used for authenticated git operations SHALL NOT be written into committed files or recorded in commit contents. Authentication SHALL be confined to git's remote configuration or per-command credentials.

#### Scenario: Pushed history is free of credentials
- **WHEN** the work branch is pushed
- **THEN** no commit content on the branch contains the token
