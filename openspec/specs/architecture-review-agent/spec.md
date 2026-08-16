## Requirements

### Requirement: One rotating focus area per run
Each review run SHALL cover exactly one focus area of the system, selected deterministically from a fixed ordered list of areas (ingress & channel security, agent design & prompts, outbound tools & external calls, persistence & durability, configuration & secrets, dependencies & build, observability & operability, scheduled & background work) by the week of the fire — not chosen by the model. The agent SHALL confine its review to the area it was given.

#### Scenario: Focus area is determined by the week
- **WHEN** two consecutive weekly runs are dispatched
- **THEN** each run receives the next focus area in the fixed rotation order, computed from the week of the fire

#### Scenario: Rotation is reproducible
- **WHEN** the focus area is computed twice for the same week
- **THEN** the same focus area is selected both times

#### Scenario: Review stays within the focus area
- **WHEN** the agent completes a run for a given focus area
- **THEN** its report covers that focus area and does not substitute a different one

### Requirement: Agent reviews the repository read-only
The agent SHALL inspect the repository under review through read-only tools bound to it — listing the repository tree, reading individual file contents with line numbers, and listing recent architecture-review issues. The tools SHALL expose no write, delete, or code-modifying operation, SHALL resolve the repository from configuration rather than from model input, and SHALL refuse to return secret-shaped paths (for example `.env` files).

#### Scenario: Agent reads real code before reporting
- **WHEN** the agent produces a report for a focus area
- **THEN** it has listed the repository tree and read the files it cites

#### Scenario: Repository is fixed by configuration
- **WHEN** the agent attempts to inspect a repository
- **THEN** the repository read is the one named by `ARCH_REVIEW_REPO` (defaulting to `GITHUB_REPO`) regardless of any repository named by the model

#### Scenario: Secret-shaped path is refused
- **WHEN** the agent requests a path matching a secret-shaped name such as `.env`
- **THEN** the tool refuses and returns no file contents

#### Scenario: Oversized file is bounded
- **WHEN** the agent reads a file larger than the tool's line or byte cap
- **THEN** the tool returns a truncated result that indicates it was truncated

### Requirement: Prior reports inform the review
Before reporting, the agent SHALL consult recent architecture-review issues and SHALL NOT restate a finding that is already open; it SHALL reference the existing issue instead.

#### Scenario: Prior finding is not duplicated
- **WHEN** the agent identifies an issue that an open prior review already reported
- **THEN** the report references the existing issue rather than restating it as a new finding

### Requirement: Structured findings with severity and evidence
The run SHALL produce a report containing the focus area, a short overall summary, and between 3 and 7 findings ranked by severity. Each finding SHALL carry a kind (improvement, hardening, or technical debt), a title, a severity (low, medium, or high), evidence citing concrete `path:line` locations read during the run, and a proposed next step. A finding without evidence SHALL NOT be reported.

#### Scenario: Report is structured
- **WHEN** a review run completes
- **THEN** the report contains the focus area, a summary, and 3–7 findings each with kind, title, severity, evidence, and a proposed next step

#### Scenario: Findings are ranked
- **WHEN** a report contains findings of differing severity
- **THEN** higher-severity findings are listed before lower-severity ones

#### Scenario: Unevidenced claim is dropped
- **WHEN** the agent cannot cite a `path:line` location for a candidate finding
- **THEN** that finding is not included in the report

### Requirement: Advisory output only
The review SHALL be advisory: the agent SHALL NOT modify code, open pull requests, or alter any existing issue as part of a run.

#### Scenario: No code is changed
- **WHEN** a review run completes
- **THEN** the repository's code and existing issues are unchanged apart from the newly filed report issue
