## ADDED Requirements

### Requirement: Deterministic readiness score
The system SHALL compute a readiness score for each candidate company from CRM signals using a fixed, documented weighting — not model judgement. Signals SHALL include at minimum: recent website visits or form submissions, an open deal or a deal re-opened recently, a lifecycle-stage advance within the lookback window, recency of last inbound engagement, and ICP fit derived from the business docs (industry, size, geography). The same inputs SHALL always produce the same score.

#### Scenario: Reproducible score
- **WHEN** the score is computed twice for the same company snapshot
- **THEN** the result is identical

#### Scenario: Signal weights applied
- **WHEN** two companies differ only in that one submitted a form in the lookback window
- **THEN** the company with the form submission scores higher

### Requirement: Bounded, ranked daily batch
Each run SHALL select at most `PROSPECTING_BATCH_SIZE` companies, ordered by score descending, from companies that are not customers, not marked do-not-prospect, and not selected within the cooldown window. Selection SHALL happen in code before the agent sees any company.

#### Scenario: Batch cap
- **WHEN** more companies qualify than the batch size
- **THEN** only the top-scoring `PROSPECTING_BATCH_SIZE` companies are passed to the agent

#### Scenario: Existing customer excluded
- **WHEN** a company's lifecycle stage is customer (or a closed-won deal exists)
- **THEN** it is not selected regardless of score

#### Scenario: Recently prospected excluded
- **WHEN** a company was selected by a run within `OUTREACH_COOLDOWN_DAYS`
- **THEN** it is not selected again

### Requirement: Score rationale recorded
The selected batch SHALL carry, for each company, the contributing signals and their weights so the agent can reference them and the run summary can explain why each account was chosen.

#### Scenario: Rationale available
- **WHEN** a company is selected
- **THEN** its entry lists each signal that contributed and the resulting score
