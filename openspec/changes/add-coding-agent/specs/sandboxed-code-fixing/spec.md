# sandboxed-code-fixing Specification

## ADDED Requirements

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

### Requirement: Credentials do not leak into the repository or its history
The `GITHUB_TOKEN` used for authenticated git operations SHALL NOT be written into committed files or recorded in commit contents. Authentication SHALL be confined to git's remote configuration or per-command credentials.

#### Scenario: Pushed history is free of credentials
- **WHEN** the work branch is pushed
- **THEN** no commit content on the branch contains the token
