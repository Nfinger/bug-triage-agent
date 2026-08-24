## MODIFIED Requirements

### Requirement: Deterministic readiness score
The system SHALL compute a readiness score for each candidate company from CRM signals using a fixed, documented weighting — not model judgement. Signals SHALL include at minimum: recent website visits or form submissions, an open deal or a deal re-opened recently, a lifecycle-stage advance within the lookback window, recency of last inbound engagement, and ICP fit derived from the business docs (industry, size, geography — where geography matches the company's state or country, case-insensitively, with two-letter US state codes matched to their state names). The same inputs SHALL always produce the same score.

#### Scenario: Reproducible score
- **WHEN** the score is computed twice for the same company snapshot
- **THEN** the result is identical

#### Scenario: Signal weights applied
- **WHEN** two companies differ only in that one submitted a form in the lookback window
- **THEN** the company with the form submission scores higher

#### Scenario: Geography fit by state
- **WHEN** the ICP geographies include "Maine" and a company's state property is "ME" or "Maine"
- **THEN** the company earns the geography share of ICP fit
