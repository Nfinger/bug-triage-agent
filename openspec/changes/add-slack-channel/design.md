# Design: Add Slack Channel for Bug Reports

## Context

The repo is a fresh Flue project with no application code yet. Flue channels provide verified HTTP ingress for external providers: the framework verifies each delivery's signature, then hands the provider's native payload to app code, which routes it into agent conversations via `dispatch()`. Slack has a first-party blueprint (`flue add channel slack`) that installs `@flue/slack` (ingress verification + routes) and `@slack/web-api` (outbound SDK). GitHub likewise has a blueprint (`flue add channel github`) that installs `@flue/github` plus `@octokit/rest` and scaffolds `src/channels/github.ts` with an authenticated Octokit `client`; outbound API calls (like creating issues) are made through tools defined with `defineTool()` and bound to agents.

Slack's Events API constraints shape the design: deliveries must be acknowledged within ~3 seconds, events may be redelivered (so processing must be idempotent on `event_id`), and endpoint setup requires answering a `url_verification` challenge.

## Goals / Non-Goals

**Goals:**
- Minimal working Flue app scaffold (node target) that can be served locally.
- Verified Slack ingress mounted at `/channels/slack`, reading message events from one configured bug-report channel.
- A bug-triage agent that receives each report as a signal (thread = conversation) and produces a structured reading (summary, severity, affected area).
- Each summarized report filed as a GitHub issue in a configured repository — exactly one issue per Slack thread, with follow-up thread messages appended as comments on that issue.

**Non-Goals:**
- Posting replies back to Slack (outbound via `@slack/web-api`) — a natural follow-up, not in this change.
- Inbound GitHub webhooks (reacting to issue comments/PRs) — the GitHub channel is used outbound-only here.
- Syncing issue state back to Slack (closing threads when issues close, etc.).
- Handling Slack interactivity (slash commands, buttons, modals) or multiple workspaces.
- Deployment/hosting setup beyond local dev serving.

## Decisions

### 1. Use the `@flue/slack` blueprint, not a hand-rolled channel
`flue add channel slack` gives signature verification against raw body bytes and the Events API route for free via `createSlackChannel({ signingSecret, events })`. A custom `createChannelRouter()` channel would re-implement verification we'd have to get exactly right (raw unconsumed body, timing-safe compare). **Alternative considered**: generic channel blueprint — only appropriate for providers without first-party support.

### 2. Listen for `message` events in one channel, not `app_mention`
The docs example uses `app_mention`, but the requirement is to *read bug reports* posted to a channel, not to be summoned. The Slack app subscribes to message events (scope `channels:history`, event `message.channels`), and the handler filters `event.channel === SLACK_BUG_CHANNEL_ID`. This keeps app-level noise out: other channels, bot messages (`bot_id`/`subtype` present), and edits/deletes (message subtypes) are dropped before dispatch. **Alternative considered**: subscribing only via mention — rejected because reporters shouldn't need to remember to @-mention the bot.

### 3. Thread identity = agent conversation identity
Dispatch with `id: channel.instanceId({ teamId, channelId, threadTs })` where `threadTs = event.thread_ts ?? event.ts`. A top-level report starts a conversation; follow-ups in its thread continue it. This matches the framework's canonical Slack pattern and gives thread-aware triage with no extra state.

### 4. Signals, not user messages
Events are dispatched as `kind: 'signal'` with `type: 'slack.message'`, the report text as body, and Slack metadata in `attributes`/`initialData` (channel, thread, reporter, event ID). Signals preserve provenance metadata, which the agent needs for any later follow-up (e.g., replying in-thread in a future change).

### 5. Idempotency via Slack `event_id`
`idempotencyKey: payload.event_id` on every dispatch. Slack redelivers on slow/failed acks; the framework dedupes on this key so an agent never processes the same report twice.

### 6. GitHub filing via agent-bound Octokit tools, channel used outbound-only
`flue add channel github` is used for its scaffolded, authenticated Octokit `client` — the inbound webhook route is not mounted since nothing here reacts to GitHub events. Issue filing is done by the *agent*, not the channel handler: two tools defined with `defineTool()` (`file_github_issue` calling `client.rest.issues.create`, `comment_on_github_issue` calling `client.rest.issues.createComment`) are bound to the bug-triage agent, which calls them after producing its structured summary. **Alternative considered**: creating the issue directly in the Slack event handler — rejected because the issue body *is* the agent's summary, which doesn't exist until the agent runs; filing from the agent also keeps the tool result (issue number or error) in the conversation.

### 7. One issue per thread, enforced by conversation state
The agent conversation (one per Slack thread) remembers the issue number from its first successful `file_github_issue` call. New top-level reports file an issue; follow-ups in the thread call `comment_on_github_issue` against the remembered number instead. Combined with `event_id` idempotency at dispatch, this prevents duplicate issues from redeliveries and from thread replies. Issue bodies include a backlink to the Slack thread (reporter + thread reference) for traceability.

### 8. Configuration via environment
- `SLACK_SIGNING_SECRET` — required by `createSlackChannel` for verification.
- `SLACK_BUG_CHANNEL_ID` — the channel to read; an env var rather than hardcoded so dev/prod can point at different channels.
- `GITHUB_TOKEN` — authenticates the Octokit client for outbound calls; needs issue-write access to the target repo.
- `GITHUB_REPO` — `owner/repo` to file issues in; env var so dev can point at a sandbox repo.

### 9. Scaffold with node target
`flue.config.ts` uses `target: 'node'`; app served via Hono + `npx vite dev` locally. Simplest path for a demo; switching to `cloudflare` later is a config change.

## Risks / Trade-offs

- [Slack retries on ack >3s] → Handler only enqueues `dispatch()` (returns immediately) and returns 200; agent work runs async.
- [Duplicate processing on redelivery] → `event_id` idempotency key dedupes at dispatch.
- [Message noise: edits, joins, bot posts] → Filter out events with `subtype` or `bot_id` before dispatch; only plain user messages reach the agent.
- [Signature bypass if body is parsed before verification] → Rely on `@flue/slack` which verifies against raw bytes; never add middleware that consumes the body ahead of the channel route.
- [Secrets in repo] → `.env` is gitignored; document required vars in `.env.example`.
- [Duplicate GitHub issues if the agent forgets prior filing] → Conversation-per-thread keeps the issue number in state; dispatch idempotency on `event_id` blocks replayed events entirely.
- [GitHub API failure loses a report] → Tool result records the error in the agent conversation so failures are observable; Slack thread remains the source of truth for retry.
- [Token misconfiguration (wrong repo/scopes)] → Verification tasks include filing against a sandbox repo before pointing at the real one.
- [Doc drift: `@flue/slack` / `@flue/github` APIs may differ from docs snapshot] → Tasks include checking the installed packages' exports/types during implementation.

## Migration Plan

Greenfield — no migration. Deploy order for going live: run app → expose URL (e.g. tunnel for dev) → create Slack app with Events API URL `/channels/slack/events` (passes `url_verification` automatically) → subscribe to `message.channels` with `channels:history` scope → invite the app to the bug-report channel → create a GitHub token with issue-write access to the target repo → set env vars.

## Open Questions

- Which Slack workspace/channel is the real bug-report channel (need `SLACK_BUG_CHANNEL_ID` value at deploy time)?
- Which GitHub repository should receive the issues (need `GITHUB_REPO` and a token with issue-write access at deploy time)?
- Should issue labels (e.g., severity) be applied from the agent's assessment? (Design leaves labels out; severity lives in the issue body for now.)
