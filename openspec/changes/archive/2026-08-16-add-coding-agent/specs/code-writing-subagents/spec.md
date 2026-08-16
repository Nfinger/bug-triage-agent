# code-writing-subagents Specification

## ADDED Requirements

### Requirement: Code writing is delegated to declared subagents
The orchestrating coding agent SHALL declare worker subagents via `useSubagent(defineSubagent(...))` — at minimum a `code-writer` that implements one scoped task (edit files, run targeted checks), and an `investigator` for read-only exploration — and SHALL delegate implementation work to them through the framework's `task` tool rather than editing code directly in its own turn.

#### Scenario: Fix implementation runs in a subagent
- **WHEN** the orchestrator has planned a fix for an issue
- **THEN** the file edits are performed by a `code-writer` subagent invoked via the `task` tool, and the subagent's report appears in the parent conversation

#### Scenario: Exploration is delegated read-only
- **WHEN** the orchestrator needs to locate the cause of the bug in the codebase
- **THEN** it can delegate to the `investigator` subagent, whose task result reports findings without modifying the working tree

### Requirement: Subagents operate in the shared per-issue sandbox
Worker subagents SHALL attach the same per-issue sandbox as their orchestrator (sandbox identity derived from the issue, shared by closure), so every delegated task reads and writes the one working tree and branch for that issue. Subagents SHALL NOT create sandboxes of their own keyed to anything else.

#### Scenario: Subagent edits are visible to the orchestrator
- **WHEN** a `code-writer` subagent completes a task that modified files
- **THEN** the orchestrator sees those modifications in its own sandbox working tree without any copying step

#### Scenario: Concurrent issues remain isolated
- **WHEN** subagents are working on two different issues at the same time
- **THEN** each subagent only ever sees the working tree belonging to its own issue

### Requirement: Only the orchestrator validates and publishes
Subagents SHALL NOT push branches, open pull requests, or comment on issues — the PR and issue-comment tools are bound only to the orchestrator. The orchestrator SHALL run the project's full checks itself after delegated work completes, before publishing.

#### Scenario: Subagent cannot publish
- **WHEN** a `code-writer` subagent finishes its task
- **THEN** no push, PR, or issue comment has occurred; publishing happens only in the orchestrator's subsequent turns after full checks pass

### Requirement: Delegated work is scoped to avoid conflicting edits
The orchestrator SHALL give each delegated task a defined scope (which files/areas to change and what done means) and SHALL NOT run multiple `code-writer` tasks whose scopes overlap at the same time.

#### Scenario: Two writers get disjoint scopes
- **WHEN** the orchestrator splits a fix into two parallel `code-writer` tasks
- **THEN** the two task scopes name disjoint parts of the working tree
