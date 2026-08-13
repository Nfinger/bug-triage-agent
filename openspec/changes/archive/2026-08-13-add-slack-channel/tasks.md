# Tasks: Add Slack Channel for Bug Reports

## 1. Scaffold Flue App

- [x] 1.1 Initialize package.json and install `@flue/runtime`, `@flue/cli`, and `hono` (plus TypeScript/vite dev tooling per `flue init` defaults)
- [x] 1.2 Create `flue.config.ts` with `defineConfig({ target: 'node' })`
- [x] 1.3 Create `src/app.ts` Hono entry point and verify the dev server starts (`npx vite dev`)
- [x] 1.4 Add `.gitignore` (node_modules, .env) and `.env.example` documenting `SLACK_SIGNING_SECRET`, `SLACK_BUG_CHANNEL_ID`, `GITHUB_TOKEN`, and `GITHUB_REPO`

## 2. Add Slack Channel

- [x] 2.1 Run `flue add channel slack` to install `@flue/slack` and `@slack/web-api`; inspect the installed package's exports/types to confirm the `createSlackChannel` API matches the design
- [x] 2.2 Create `src/channels/slack.ts` using `createSlackChannel({ signingSecret, events })` reading `SLACK_SIGNING_SECRET` from env
- [x] 2.3 Implement event filtering in the `events` handler: only `event_callback` message events where `event.channel === SLACK_BUG_CHANNEL_ID`, dropping events with `bot_id` or a message `subtype`
- [x] 2.4 Dispatch filtered messages to the bug-triage agent as `kind: 'signal'` (`type: 'slack.message'`) with `id: channel.instanceId({ teamId, channelId, threadTs })`, `idempotencyKey: payload.event_id`, and Slack metadata (channel, thread, reporter, event ID) in `initialData`/`attributes`
- [x] 2.5 Mount the channel in `src/app.ts` via `app.route('/channels/slack', slack.route())`

## 3. GitHub Issue Tools

- [x] 3.1 Run `flue add channel github` to install `@flue/github` and `@octokit/rest`; keep the scaffolded Octokit `client` in `src/channels/github.ts` (do not mount the inbound webhook route) and confirm the API matches the design
- [x] 3.2 Create `src/tools/github-issues.ts` with `defineTool()` tools: `file_github_issue` (`client.rest.issues.create` against `GITHUB_REPO`, body = structured summary + Slack thread/reporter backlink) and `comment_on_github_issue` (`client.rest.issues.createComment`)
- [x] 3.3 Surface tool errors in results (issue number on success, error detail on failure) so failed filings are visible in the agent conversation

## 4. Bug-Triage Agent

- [x] 4.1 Create `src/agents/bug-triage.ts` with the `'use agent'` directive and a prompt instructing it to read each bug report and produce a structured summary (summary, severity, affected area)
- [x] 4.2 Bind the GitHub tools to the agent and instruct it: file exactly one issue per thread (remember the issue number in the conversation), append follow-up thread messages as comments on that issue
- [x] 4.3 Verify the agent runs standalone against a sandbox repo: `npx flue run src/agents/bug-triage.ts --message "<sample bug report>"` creates a real issue with summary, severity, affected area, and Slack backlink

## 5. Verification

- [x] 5.1 Test signature verification: a request to `/channels/slack/events` without a valid Slack signature is rejected; a correctly signed request (simulated with the signing secret) is accepted
- [x] 5.2 Test the `url_verification` handshake returns the challenge value
- [x] 5.3 Test filtering: signed message events from a non-configured channel, bot-authored messages, and subtype events produce no dispatch but still return 200
- [x] 5.4 Test threading and idempotency: a top-level message and a thread reply land in the same agent conversation; redelivering the same `event_id` does not produce a second agent run and does not create a duplicate GitHub issue
- [x] 5.5 End-to-end smoke test against a sandbox repo: simulate a signed bug-report event and confirm the agent conversation contains the structured summary and exactly one GitHub issue was created with a Slack backlink
- [x] 5.6 Follow-up flow: simulate a thread reply after filing and confirm it lands as a comment on the existing issue, with no second issue created

## 6. Provider Setup (manual/documented)

- [x] 6.1 Write README section for Slack: create the Slack app, enable Events API pointing at `<base-url>/channels/slack/events`, subscribe to `message.channels` with `channels:history` scope, invite the app to the bug channel, and set `SLACK_SIGNING_SECRET` / `SLACK_BUG_CHANNEL_ID`
- [x] 6.2 Write README section for GitHub: create a token with issue-write access to the target repository and set `GITHUB_TOKEN` / `GITHUB_REPO`
