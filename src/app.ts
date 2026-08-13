import { Hono } from 'hono';
import { channel as slack } from './channels/slack.ts';

const app = new Hono();

// Slack Events API posts to /channels/slack/events; verified deliveries from
// the bug-report channel are dispatched to the BugTriage agent.
app.route('/channels/slack', slack.route());

export default app;
