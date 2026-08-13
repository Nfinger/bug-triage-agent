# Add Slack Channel for Bug Reports

## Why

Bug reports currently live only in Slack conversations where they get lost in scroll-back and nothing acts on them. Wiring a Slack channel into this Flue app lets an agent read bug reports directly from Slack as they arrive, summarize them, and file each one as a GitHub issue — so reports land in the tracker where work actually happens.

## What Changes

- Scaffold the minimal Flue app (the repo is currently empty): `flue.config.ts`, `src/app.ts` Hono entry point, and package setup with `@flue/runtime` and `@flue/cli`.
- Add the Slack channel via the `@flue/slack` blueprint (`flue add channel slack`), providing verified HTTP ingress for Slack's Events API.
- Create a Slack channel module (`src/channels/slack.ts`) that verifies request signatures with the Slack signing secret, filters for bug-report messages posted in the designated Slack channel, and dispatches them to an agent with idempotent delivery (Slack `event_id` as the idempotency key).
- Create a bug-report agent (`src/agents/bug-triage.ts`) that receives dispatched Slack messages and reads/summarizes the bug report (thread-aware: one conversation per Slack thread).
- Mount the channel at `/channels/slack` so Slack's Events API posts to `/channels/slack/events`.
- Add the GitHub channel via the `@flue/github` blueprint (`flue add channel github`) for its authenticated Octokit client, and give the bug-triage agent tools to create a GitHub issue from each summarized report (one issue per Slack thread) and to append follow-up thread messages as comments on that issue.
- Add required configuration: `SLACK_SIGNING_SECRET` (ingress verification), `SLACK_BUG_CHANNEL_ID` (which channel to read), `GITHUB_TOKEN` (outbound API auth), and `GITHUB_REPO` (owner/repo to file issues in).

## Capabilities

### New Capabilities

- `slack-channel`: Verified Slack ingress — accept Slack Events API deliveries, verify signatures against the raw request body, filter to the configured bug-report channel, and dispatch events to the bug-triage agent exactly once per Slack event.
- `bug-report-intake`: Agent-side handling of dispatched bug reports — one agent conversation per Slack thread, receiving each report as a signal with its Slack metadata (channel, thread, reporter) intact.
- `github-issue-filing`: Filing summarized bug reports as GitHub issues via the agent's bound Octokit tools — exactly one issue per Slack thread, with follow-up thread messages appended as issue comments.

### Modified Capabilities

_None — this is the first change in the project; no existing specs._

## Impact

- **New dependencies**: `@flue/runtime`, `@flue/cli`, `@flue/slack`, `@slack/web-api`, `@flue/github`, `@octokit/rest`, `hono`.
- **New code**: `flue.config.ts`, `src/app.ts`, `src/channels/slack.ts`, `src/channels/github.ts`, `src/agents/bug-triage.ts`, `src/tools/github-issues.ts`.
- **External systems**: Requires a Slack app configured with Events API pointed at the deployed `/channels/slack/events` URL, subscribed to message events in the bug-report channel, with its signing secret provided via environment; and a GitHub token with issue-write access to the target repository.
- **No breaking changes** — greenfield addition.
