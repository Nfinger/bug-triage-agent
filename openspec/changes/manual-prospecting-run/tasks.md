# Tasks: Manual Prospecting Run

## 1. Core

- [x] 1.1 `src/prospecting/config.ts`: add `manualRunToken()` reading `PROSPECTING_MANUAL_TOKEN` (undefined disables the route)
- [x] 1.2 `src/prospecting/crm.ts`: add `findCompanyByDomain(domain)` (exact-match search, null when absent) and `clearProspected(companyId)` (clears `last_prospected_at`)
- [x] 1.3 `src/schedules/prospecting.ts`: accept `{ runId }` option for the conversation/idempotency id and return `{ dispatched, selected, considered }`
- [x] 1.4 New `src/schedules/prospecting-manual.ts`: Hono route `POST /run` — 404 when token unconfigured, 401 on bad bearer (digest comparison), optional `resetDomains` (≤10) cleared via CRM, then dispatch with a unique manual run id; respond with runId, dispatch result, and per-domain reset results
- [x] 1.5 `src/app.ts`: mount the route at `/schedules/prospecting`

## 2. Tests & verify

- [x] 2.1 `tests/manual-run.test.mjs`: CRM helpers against a scripted client (domain found/not found, clear writes empty property); route auth (404 unconfigured, 401 wrong token — nothing dispatched)
- [x] 2.2 `npm test` and `npm run check:types` pass
- [ ] 2.3 Deploy via CI, set `PROSPECTING_MANUAL_TOKEN`, call the endpoint with `resetDomains: ["visitpointlookout.com"]`, and confirm a run dispatches and retries Point Lookout
