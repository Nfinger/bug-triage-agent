# Deep Contact Discovery

## Why

Point Lookout's retry proved the ceiling of fetch-and-search discovery: the agent surfaced the company's structure but had to stop at "nobody emailable" because (a) LinkedIn — where the people actually are — auth-walls every fetch, so a search snippet naming "Jim Smith, Events Manager" is visible but inadmissible, and (b) companies like this publish no on-domain email at all, so even a known name yields no address. The agent needs a licensed way to turn a domain (and optionally a name) into a verified email, and snippets need to count as leads.

## What Changes

- **Snippet-sourced leads**: a named person + title from a `web_search` result may be used as a discovery lead (recorded with the result URL) even when the page behind it cannot be fetched. Snippets remain inadmissible as evidence for outreach claims — this changes contact *finding*, not message linting.
- **Hunter.io email lookups**: a new `find_contact_email` tool wraps Hunter's domain-search and email-finder APIs. Only results at or above a confidence threshold are recorded as verified; lookups are capped per company; the tool exists only when `HUNTER_API_KEY` is configured (the run degrades to today's behavior without it).
- **`create_contact` gains a second evidence path**: an email is creatable if it was found on a fetched page (unchanged) OR was provider-verified this run — enforced in code via a run-context registry the model cannot write to, with the created name required to match the provider's record.
- Skip notes and find-a-contact tasks name the leads found (person, title, source) even when no email could be verified.
- New config: `HUNTER_API_KEY` (optional secret), `HUNTER_MIN_SCORE` (default 80), `HUNTER_LOOKUPS_PER_COMPANY` (default 2).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `account-research`: contact-discovery research adds snippet-sourced leads and bounded, key-gated provider email lookups whose verified results are recorded in code.
- `contact-selection`: contact creation accepts provider-verified emails (name-matched, provenance recorded) alongside page-found emails; skip records name the leads found.

## Impact

- `src/prospecting/hunter.ts` (new provider client), `src/tools/email-finder.ts` (new tool), `src/prospecting/config.ts`, `src/prospecting/run-context.ts` (verified-email registry, lookup budget), `src/prospecting/research-budget.ts` (lookup kind), `src/tools/hubspot-contacts.ts` (`create_contact` second path), `src/agents/prospecting.ts` (tool + prompt), `.env.example`, tests.
- New outbound dependency: `api.hunter.io` (paid account owned by the user; key stored as a worker secret).
