# Source New Companies

## Why

The prospecting agent only works companies that already exist in HubSpot — the top of the funnel was never automated. With a ~12-company pool, two days of runs exhausted everything eligible (the rest in cooldown or signal-less), and the pool's brewery skew makes every run look brewery-obsessed. The agent needs a sourcing stage that finds net-new Maine ICP businesses on the web and creates them as companies, so daily scoring has fresh, diverse material.

## What Changes

- New dispatch-only `Sourcing` agent on its own cron (weekdays 12:00 UTC — one hour before prospecting, so the morning's finds enter the same day's scoring). It researches Maine event-hosting businesses with the existing `fetch_page`/`web_search` tools under a per-run budget and creates companies through a new guarded `create_company` tool.
- **Category rotation in code**: each run gets a focus category derived deterministically from the run date (venues, campgrounds/resorts, restaurants/breweries, corporate HR, community orgs, …the full ICP spread) so coverage rotates instead of converging on one niche.
- `create_company` guardrails (all code-enforced): per-run cap (`SOURCING_MAX_COMPANIES`, default 5); domain required and not already in HubSpot (dedupe via domain search); the company's own site must have been fetched this run; Maine location and an ICP-list industry required; created records marked `agent_sourced` + `agent_sourced_run` with a note citing source URLs.
- **Scoring change**: agent-sourced companies created within the lookback window earn a new `sourced-fresh` signal (+15) that satisfies the "fit alone is not a buying signal" rule — otherwise sourced companies could never be selected. They rank below genuinely warm accounts and age out naturally.
- The sourcing dispatcher creates the new custom company properties idempotently at fire time (the setup script needs prod vars that aren't available locally).
- Slack pre/post-run summary for sourcing; manual trigger `POST /schedules/sourcing/run` behind the existing `PROSPECTING_MANUAL_TOKEN`.
- Config: `SOURCING_ENABLED` (default true), `SOURCING_MAX_COMPANIES` (default 5).

## Capabilities

### New Capabilities

- `company-sourcing`: the sourcing agent — schedule, research bounds, company-creation guardrails, dedupe, provenance, category rotation, run summary, manual trigger.

### Modified Capabilities

- `buying-signal-scoring`: add the `sourced-fresh` signal for agent-sourced companies within the lookback window, counting as a non-fit signal.
- `hubspot-crm-access`: bounded write access extends to creating a company (guarded) and creating the fixed custom property definitions when absent.

## Impact

- New: `src/agents/sourcing.ts`, `src/schedules/sourcing.ts`, `src/tools/hubspot-sourcing.ts` (create_company), `src/prospecting/sourcing-categories.ts`.
- Modified: `src/prospecting/scoring.ts` (+signal), `src/prospecting/crm.ts` (createCompany, createProperty, read agent_sourced props), `src/prospecting/config.ts`, `src/cloudflare.ts` (+cron route), `wrangler.jsonc` (+cron, +DO migration — append-only), `src/app.ts` + manual-run route, `.env.example`, tests.
- HubSpot: two new custom company properties (`agent_sourced`, `agent_sourced_run`), created automatically; agent-created companies appear in the portal for human review before any outreach reaches them (outreach is still draft-mode).
