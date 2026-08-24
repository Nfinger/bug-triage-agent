## Why

The prospecting agent currently carries placeholder business docs for a fictional analytics company — so in yesterday's verification run it (correctly) refused to write a single email, including to our own seeded account. Yard Games World is a lawn-game rental business (Boston, South Shore, Worcester) expanding into **Maine**, and the agent's job is to fuel that expansion: find Maine businesses and venues that host events, reach the person who plans them, and open the conversation. The docs are the steering wheel of the whole system — ICP drives scoring and contact selection, messaging drives the linter — so writing them is a product change, not copywriting.

## What Changes

- Replace all four `docs/business/*.md` placeholders with real Yard Games World content: who we are (locations, service model), the full game catalog and package/delivery pricing as context, the event types we serve, and a Maine-expansion-focused ICP and messaging guide.
- Target ICP: Maine businesses that host or plan recurring group events — breweries and taprooms, wedding and event venues, event planners, corporate HR/office/people teams, campgrounds and resorts, community organizations — with persona patterns to match (events manager, taproom manager, HR/people ops, office manager, owner).
- **Code delta**: ICP geography currently matches only the company `country` property, so "Maine" is untargetable. Add `state` to the company properties read and match geographies against state OR country; the ICP block's `geographies` lists states/regions ("Maine") alongside countries.
- Messaging rules tuned for a local services business: shorter cap, warmer tone, no rental-price quoting for the new Maine territory (delivery pricing there isn't set), Boston-area social proof allowed.

## Capabilities

### New Capabilities
(none)

### Modified Capabilities
- `business-knowledge`: content requirements stay; the ICP block's `geographies` semantics widen from countries to states-or-countries.
- `buying-signal-scoring`: geography fit SHALL match the company's state or country against the ICP geographies (was: country only).

## Impact

- **Content**: `docs/business/company.md`, `products.md`, `icp.md`, `messaging.md` rewritten.
- **Code**: `src/prospecting/crm.ts` (+`state` property), `src/prospecting/scoring.ts` (geography match), tests in `tests/scoring.test.mjs`.
- **No config, schema, or wrangler changes.** Redeploy required for the bundled docs to take effect.
- Existing HubSpot data: Maine companies must carry `state` = "Maine"/"ME" (both matched) to earn geography fit; missing state simply scores lower, it doesn't exclude.
