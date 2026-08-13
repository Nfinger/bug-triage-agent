import { createAgentRouter } from '@flue/runtime/routing';
import { Hono } from 'hono';
import { Hello } from './agents/hello.ts';
import { channel as slack } from './channels/slack.ts';

const app = new Hono();

// Slack Events API posts to /channels/slack/events; verified deliveries from
// the bug-report channel are dispatched to the BugTriage agent.
app.route('/channels/slack', slack.route());

// The route map: every agent, channel, and custom route is mounted here
// explicitly. Talk to Hello with one POST per message:
//
//   curl -X POST http://localhost:5173/agents/hello/my-first-chat \
//     -H 'content-type: application/json' \
//     -d '{"kind":"user","body":"Tell me a joke."}'
app.route('/agents/hello', createAgentRouter(Hello));

export default app;
