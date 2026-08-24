## MODIFIED Requirements

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
