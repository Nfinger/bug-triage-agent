# business-knowledge Specification

## Purpose
TBD - created by archiving change add-prospecting-agent. Update Purpose after archive.
## Requirements
### Requirement: Versioned business docs loaded per run
The agent SHALL load the markdown files under `docs/business/` (at minimum `company.md`, `products.md`, `icp.md`, `messaging.md`) at the start of each run and include their content in its prompt. The ICP and persona rules in these files SHALL also be parsed in code to drive scoring and contact selection.

#### Scenario: Docs present
- **WHEN** a run starts
- **THEN** the prompt contains the current contents of every business doc

#### Scenario: Required doc missing
- **WHEN** a required business doc is absent or empty
- **THEN** the run fails before selecting any account with an error naming the missing file

### Requirement: Machine-readable ICP and persona sections
`icp.md` SHALL contain a fenced `json` block declaring target industries, company-size ranges, geographies (each entry a US state — name or two-letter code — or a country), target persona title patterns, and excluded domains, which the system SHALL parse and validate.

#### Scenario: ICP parsed
- **WHEN** `icp.md` declares target industries and persona title patterns
- **THEN** scoring uses the industries for fit and contact selection uses the title patterns

#### Scenario: State-level geography
- **WHEN** `icp.md` lists "Maine" in `geographies`
- **THEN** a company whose state is "Maine" or "ME" earns geography fit regardless of its country value

#### Scenario: Invalid ICP block
- **WHEN** the ICP block fails validation
- **THEN** the run fails with a validation error before any HubSpot write

### Requirement: Size bound
Total loaded business-doc content SHALL be capped; exceeding the cap SHALL fail the run with an explanatory error rather than silently truncating.

#### Scenario: Docs exceed cap
- **WHEN** combined docs exceed the size cap
- **THEN** the run fails and names the cap

