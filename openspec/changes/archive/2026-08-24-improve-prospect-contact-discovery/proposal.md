# Improve Prospect Contact Discovery

## Why

Good-fit companies are being skipped because the prospecting agent cannot find a person to email. In the 2026-08-24 run, Point Lookout Resort (score 50, strong ICP fit, fresh SQL stage-advance) was skipped: HubSpot had no eligible contacts, the company's contact page returned a 400, and the agent had no budget or direction left to hunt for a named person. Today the agent spends its entire research budget (4 fetches, 3 searches) on message personalization *before* it learns the company has no contacts, gets charged for failed fetches, and has no playbook for finding people — so any company without a pre-existing HubSpot contact and an easily-fetched team page falls through.

## What Changes

- Reorder the per-company loop in the agent prompt: check `list_eligible_contacts` immediately after `get_company`, so the agent knows *before* researching whether it must also find a person.
- Grant a deterministic contact-discovery research bonus (extra fetches and searches, in code, not model-controlled) when `list_eligible_contacts` returns no one, so people-finding does not compete with personalization research.
- Add a contact-discovery playbook to the prompt: try team/about/staff/leadership/contact pages (following links seen on fetched pages and common paths), run people-focused searches (company name + persona titles, press releases), and on a failed fetch try alternate URLs rather than giving up.
- Stop charging the research budget for failed page fetches (HTTP errors, network failures), with a separate per-company attempt cap so retries stay bounded.
- When a company is still skipped for lack of a contact, require the skip record to document what discovery was attempted (URLs tried, queries run), and create a HubSpot follow-up task for a human to find a contact — the `contact-selection` spec already requires this task but it was never implemented.
- No change to the safety guardrails: `create_contact` still requires a named person from a fetched page with a company-domain email; the agent still never invents names or email addresses.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-research`: Add a contact-discovery requirement — when a selected company has no eligible contacts, a bonus research allowance is granted in code and research is directed at finding people; failed fetches no longer consume the budget (bounded by an attempt cap).
- `contact-selection`: Strengthen the no-matching-contact scenario — the agent must attempt directed contact discovery before skipping, the skip outcome must document the attempts, and skipping for lack of a contact creates a human follow-up task in HubSpot (making the existing spec scenario real).

## Impact

- **Prereq**: this branch (`well-duke` @ 2aa18c5) predates the prospecting agent; implementation starts by fast-forwarding to `origin/main` (cb9cf36), which contains all prospecting code and the `account-research` / `contact-selection` specs.
- `src/agents/prospecting.ts` — per-company loop reorder and contact-discovery playbook in the prompt.
- `src/prospecting/research-budget.ts` — discovery bonus grant, failure refunds, attempt cap.
- `src/tools/web-research.ts` — refund budget on failed fetch; surface remaining attempts.
- `src/tools/hubspot-contacts.ts` — `list_eligible_contacts` grants the discovery bonus in code when zero contacts are eligible.
- `src/tools/hubspot-companies.ts` — `record_company_outcome` creates a human follow-up task on no-contact skips.
- `tests/` — new/updated unit tests for budget behavior, discovery grant, and skip-task creation.
- No config, schema, or wrangler changes; no new external dependencies; HubSpot API usage unchanged apart from one extra task-creation call on no-contact skips.
