import { Hono } from 'hono';
import { channel as github } from './channels/github.ts';
import { channel as slack } from './channels/slack.ts';
import { registerCodingFailsafe } from './failsafe.ts';
import { setupObservability } from './observability.ts';

setupObservability();
// Fail-closed publication for coding runs: a failed submission checkpoints
// its sandbox work and posts a blocker comment on the originating issue.
registerCodingFailsafe();

const app = new Hono();

// Slack Events API posts to /channels/slack/events; verified deliveries from
// the bug-report channel are dispatched to the BugTriage agent.
app.route('/channels/slack', slack.route());

// GitHub posts issue events to /channels/github/webhook; the coding-agent
// label being applied dispatches the Coding agent for that issue.
app.route('/channels/github', github.route());

export default app;
