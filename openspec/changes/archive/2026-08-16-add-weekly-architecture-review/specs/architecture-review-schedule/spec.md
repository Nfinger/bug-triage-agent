## ADDED Requirements

### Requirement: Weekly Friday trigger
The Worker SHALL declare a cron trigger that fires once per week on Friday, and the fire SHALL dispatch an architecture-review run to the `ArchitectureReview` agent. The cadence SHALL be part of the deployed configuration, and no HTTP route SHALL be mounted for the agent.

#### Scenario: Friday fire dispatches a review
- **WHEN** the weekly cron fires on Friday
- **THEN** exactly one architecture-review run is dispatched to the `ArchitectureReview` agent

#### Scenario: Non-Friday days do not dispatch
- **WHEN** the configured time of day arrives on any day other than Friday
- **THEN** no architecture-review run is dispatched

#### Scenario: Trigger is present in the deployed configuration
- **WHEN** the Worker is built for deployment
- **THEN** the emitted configuration carries the weekly cron trigger and the built Worker exposes a scheduled handler for it

#### Scenario: Agent is not reachable over HTTP
- **WHEN** a request is made to any route for the architecture-review agent
- **THEN** no route exists for it and no review run can be started from outside the app

### Requirement: Enablement is configurable
`ARCH_REVIEW_ENABLED` SHALL control whether a fire results in a run. When it is off, a fire SHALL complete without dispatching anything. A value that is neither true nor false SHALL raise an error rather than being interpreted.

#### Scenario: Review is disabled
- **WHEN** `ARCH_REVIEW_ENABLED` is set to `false` and the weekly cron fires
- **THEN** no run is dispatched and no issue is filed

#### Scenario: Unusable enablement value
- **WHEN** `ARCH_REVIEW_ENABLED` is set to a value that is neither true nor false
- **THEN** an error naming the variable is raised rather than a silently assumed default

### Requirement: The agent's durable class is declared
The architecture-review agent's Durable Object class SHALL be declared in the Worker's append-only migration list, so the agent can be deployed without disturbing the existing agents' classes.

#### Scenario: Migration entry exists for the new agent
- **WHEN** the Worker is built for deployment
- **THEN** the emitted configuration declares the architecture-review agent's class, and the bundle exports exactly the agent classes the migrations declare

### Requirement: One run per week, identified by fire date
Each fire SHALL dispatch to a conversation whose ID is derived from the fire's date, and SHALL pass that same value as the dispatch idempotency key, so a repeated delivery for the same date produces at most one review run.

#### Scenario: Each week gets its own conversation
- **WHEN** the trigger fires on two different Fridays
- **THEN** each run is delivered to a separate agent conversation identified by its own fire date

#### Scenario: Repeated delivery for the same date is deduplicated
- **WHEN** a scheduled fire is delivered more than once for the same date (the platform delivers scheduled events at-least-once), or a run is triggered by hand for a date already dispatched
- **THEN** the agent processes the review at most once for that date

### Requirement: Review runs are dispatched as signals carrying the focus area
The dispatched message SHALL be a `kind: 'signal'` message carrying the review instruction as its body, with the selected focus area and the scheduled timestamp available to the agent as initial data and message attributes.

#### Scenario: Focus area travels with the dispatch
- **WHEN** a review run is dispatched
- **THEN** the agent conversation contains the focus area identifier and the scheduled timestamp alongside the review instruction

### Requirement: Dispatch outcomes are visible
The scheduled handler SHALL await the dispatch so that a failure surfaces in the platform's logs rather than being lost in an unobserved promise, and a successful dispatch SHALL record which run it started.

#### Scenario: Dispatch fails
- **WHEN** the dispatch call fails during a scheduled fire
- **THEN** the failure surfaces in the Worker's logs and is not silently swallowed

#### Scenario: Dispatch succeeds
- **WHEN** a scheduled fire dispatches a run
- **THEN** the conversation it dispatched and the focus area are recorded in the logs

### Requirement: Runs can be triggered without the cron
The dispatch SHALL be callable directly, so a run can be exercised or a skipped week backfilled without waiting for or altering the cron.

#### Scenario: Manual run
- **WHEN** the dispatch is called directly with a date
- **THEN** a review run for that date is dispatched, subject to the same one-run-per-date rule
