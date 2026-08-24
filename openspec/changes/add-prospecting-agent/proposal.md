## Why

Finding accounts that are ready to buy, identifying the right people at them, and writing a message that actually speaks to their situation is slow, repetitive work that today happens by hand (or not at all). This system already runs scheduled, tool-using agents against external systems (Slack, GitHub); adding a prospecting agent connected to HubSpot turns the CRM's buying signals into a daily stream of personalized, sent outreach — and records everything it does back on the CRM so humans can see, audit, and follow up.

## What Changes

- Add a `Prospecting` agent (`src/agents/prospecting.ts`) that runs once per day on a Cloudflare cron, selects a bounded batch of HubSpot companies showing buying intent, researches each one, picks the right contact(s), writes a personalized email, and sends it through HubSpot so it lands on the contact's timeline.
- Add a HubSpot integration (`src/channels/hubspot-client.ts` + `src/tools/hubspot-*.ts`): read companies/contacts/deals/engagements, score readiness from CRM signals, create/associate contacts, send single-send emails, and write a note + task on the company record describing what was done.
- Add a business-knowledge loader: markdown under `docs/business/` (positioning, products, ICP, messaging guidelines, do-not-contact rules) is read at run time and injected into the agent's prompt, so the agent "understands our business and product offerings" from versioned docs rather than from the model's guesses.
- Add research tools: bounded web search and page fetch (company website, recent news) so each message can cite something real about the account.
- Add a prospecting schedule (`src/schedules/prospecting.ts`) and cron trigger, with the same date-keyed idempotency pattern the weekly architecture review uses, plus a daily send cap and an `OUTREACH_ENABLED` kill switch that degrades sending to "log a draft note on the record" without a redeploy.
- Add guardrails enforced in tools, not prompts: never contact a company/contact marked do-not-contact or unsubscribed, never re-send to a contact emailed within a cooldown window, never exceed the daily cap, and never send to a domain outside the contact's company.
- Add a `prospecting-run` summary posted to a Slack channel at the end of each run (accounts selected, contacts emailed, skipped-and-why) — reusing the existing Slack client.

## Capabilities

### New Capabilities
- `hubspot-crm-access`: authenticated, read/write access to HubSpot companies, contacts, deals, and engagements, bound to one configured portal; secrets and portal fixed by configuration, not model input.
- `buying-signal-scoring`: deterministic readiness scoring of HubSpot companies from CRM signals (recent site visits/form fills, open or re-opened deals, lifecycle stage changes, engagement recency, ICP fit from business docs), producing a ranked, bounded daily batch.
- `account-research`: read-only research of a selected account via company website fetch and web search, bounded in size and count, producing evidenced facts the message can reference.
- `contact-selection`: choosing or creating the right contact(s) at an account according to target-persona rules from the business docs, with hard exclusions for do-not-contact, unsubscribed, bounced, and recently-contacted people.
- `personalized-outreach`: composing and sending a personalized email through HubSpot per selected contact, logged to the CRM timeline, subject to the daily cap, cooldown, and kill switch; every send or skip recorded as a note/task on the company.
- `business-knowledge`: loading versioned business/product/ICP/messaging documents from the repository into the agent's context each run.
- `prospecting-schedule`: daily cron-dispatched runs with date-keyed idempotency, enable flag, and end-of-run Slack summary.

### Modified Capabilities
- `slack-channel`: the Slack integration gains an outbound "post run summary to a configured channel" use alongside the existing bug-report ingress (new requirement: posting to `SLACK_PROSPECTING_CHANNEL_ID`).

## Impact

- **New code**: `src/agents/prospecting.ts`, `src/schedules/prospecting.ts`, `src/channels/hubspot-client.ts`, `src/tools/hubspot-companies.ts`, `src/tools/hubspot-contacts.ts`, `src/tools/hubspot-outreach.ts`, `src/tools/web-research.ts`, `src/prospecting/{config,scoring,knowledge}.ts`, `docs/business/*.md`, tests under `tests/`.
- **Modified code**: `src/cloudflare.ts` (`scheduled()` routes a second cron), `wrangler.jsonc` (new cron expression + append-only `flue-class-FlueProspectingAgent` migration), `.env.example`, `README.md`, `AGENTS.md`.
- **New dependencies**: none for HubSpot (plain `fetch` against the REST API; runs unchanged in a Worker and is trivially mockable). Web research uses `fetch` plus a search provider API (configured via `WEB_SEARCH_API_KEY`); no headless browser.
- **New configuration**: `HUBSPOT_ACCESS_TOKEN` (private app token with crm.objects.{companies,contacts,deals}.read/write, sales-email-read, and single-send scopes), `HUBSPOT_SENDER_EMAIL`, `OUTREACH_ENABLED`, `OUTREACH_DAILY_CAP`, `OUTREACH_COOLDOWN_DAYS`, `PROSPECTING_BATCH_SIZE`, `SLACK_PROSPECTING_CHANNEL_ID`, `WEB_SEARCH_API_KEY`.
- **External effects**: this agent sends real email to real people. Defaults ship with `OUTREACH_ENABLED=false` (draft-note mode) and a low cap so the pipeline can be observed in the CRM before sending is switched on. Compliance (CAN-SPAM/GDPR) is enforced by honoring HubSpot's subscription status and a mandatory unsubscribe footer from the docs.
- **Operational**: Cloudflare delivers cron at-least-once; runs are keyed by date so a duplicate fire is a no-op. Sending is the only irreversible action and is gated by per-contact dedup inside the tool.
