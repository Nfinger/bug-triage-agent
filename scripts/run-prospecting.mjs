#!/usr/bin/env node
// Start one prospecting run by hand (verification, or backfilling a day the
// cron missed). Same idempotency as the cron: a day that already ran is a
// no-op.
//
//   node --env-file=.dev.vars scripts/run-prospecting.mjs [YYYY-MM-DD]
//
// The agent is dispatched through the Flue runtime, so the dev server
// (`npm run dev`) must be running for the run to execute.

const [, , dateArg] = process.argv;
const firedAt = dateArg ? new Date(`${dateArg}T13:00:00Z`) : new Date();
if (Number.isNaN(firedAt.getTime())) {
	console.error(`Invalid date "${dateArg}"; expected YYYY-MM-DD`);
	process.exit(1);
}

// The schedule imports the bundled business docs (`.md?raw`), which Node
// needs a loader hook for.
const { registerHooks } = await import('node:module');
const { load } = await import('./md-raw-loader.mjs');
registerHooks({ load });

const { dispatchProspecting } = await import('../src/schedules/prospecting.ts');
await dispatchProspecting(firedAt);
