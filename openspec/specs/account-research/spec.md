# account-research Specification

## Purpose
TBD - created by archiving change add-prospecting-agent. Update Purpose after archive.
## Requirements
### Requirement: Read-only web research tools
The agent SHALL research each selected account through two read-only tools: fetch a page by URL (returning extracted text) and web search (returning titles, URLs, snippets). Tools SHALL expose no write capability and SHALL not execute scripts or follow login flows.

#### Scenario: Company website fetched
- **WHEN** the agent fetches the company's domain from its HubSpot record
- **THEN** the tool returns the page's visible text, truncated to the byte cap and marked truncated if so

#### Scenario: Search results returned
- **WHEN** the agent searches for recent news about the company
- **THEN** the tool returns up to the configured number of results with title, URL, and snippet

### Requirement: Research is bounded per account
Each account SHALL be limited to a fixed number of fetches and searches per run, and each fetched page SHALL be size-capped. Private, loopback, and non-HTTP(S) URLs SHALL be refused.

#### Scenario: Per-account budget exhausted
- **WHEN** the agent exceeds the fetch or search budget for an account
- **THEN** the tool returns `ok: false` explaining the budget is spent and the agent proceeds with what it has

#### Scenario: Internal address refused
- **WHEN** the agent requests a URL resolving to a private network or localhost
- **THEN** the tool refuses without making a request

### Requirement: Facts must be evidenced
Any account-specific claim used in outreach SHALL be traceable to a fetched URL, a search result, or a HubSpot property read during the run. The agent SHALL NOT invent facts about the account.

#### Scenario: Unevidenced claim dropped
- **WHEN** the agent cannot source a personalization detail
- **THEN** it omits that detail rather than fabricating it

