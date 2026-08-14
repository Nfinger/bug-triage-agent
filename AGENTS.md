# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/app.ts` — the route map; every route is mounted here explicitly.
- `wrangler.jsonc` — Cloudflare Worker config: name, compatibility settings, and the Durable Object migration for each agent. This project targets Cloudflare (`flue.config.ts`), so there is no `src/db.ts` — conversations persist in Durable Object SQLite instead.

## Commands

- `npx flue run src/agents/hello.ts --message "Hi"` — run an agent locally, no server.
- `npm run dev` — start the dev server (workerd, via the Cloudflare Vite plugin).
- `npm run build` — build the deployable Worker artifact into `dist/`.
- `npm run deploy` — build and `wrangler deploy`. Runs automatically on merge to `main` via `.github/workflows/deploy.yml`.
- `npm run check:types` — typecheck.
- `npx flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `npx flue add` — list blueprints for adding channels, sandboxes, and databases.
