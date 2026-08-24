# Tasks: Deep Contact Discovery

## 1. Provider client and budget

- [x] 1.1 `src/prospecting/hunter.ts`: pure client for Hunter domain-search and email-finder (fetch injectable), normalizing results to `{email, firstName, lastName, title, score, type}`; error results as `{ok:false,error}`
- [x] 1.2 `src/prospecting/config.ts`: `hunterApiKey()` (optional), `hunterMinScore()` (default 80), `hunterLookupsPerCompany()` (default 2); `.env.example` entries
- [x] 1.3 `src/prospecting/research-budget.ts`: add `lookups` kind (limit from constructor, default 2, unaffected by discovery bonus); `src/prospecting/run-context.ts`: add `verifiedEmails` registry

## 2. Tools

- [x] 2.1 `src/tools/email-finder.ts`: `find_contact_email` tool — batch fence, lookup budget, domain forced to the company's own, calls hunter client, records ≥threshold on-domain personal results into `context.verifiedEmails`, reports the rest as unverified
- [x] 2.2 `src/tools/hubspot-contacts.ts`: `create_contact` second evidence path — email in `verifiedEmails` with loosely-matching name allows creation without a fetched sourceUrl; error message explains both paths

## 3. Agent wiring

- [x] 3.1 `src/agents/prospecting.ts`: register `find_contact_email` when the key is configured; extend the discovery playbook (snippet leads with result URLs, lookup usage, leads named in skip summaries), conditionally mentioning the tool

## 4. Tests & verify

- [x] 4.1 Tests: hunter client normalization + threshold/domain filtering; tool records verified only for on-domain ≥threshold and respects the lookup cap; create_contact accepts a verified email with matching name and rejects unverified or mismatched names
- [x] 4.2 `npm test` and `npm run check:types` pass
- [ ] 4.3 Deploy via CI; after the user sets `HUNTER_API_KEY`, rerun Point Lookout via the manual endpoint and confirm the run either creates a verified contact or names leads in the skip record
