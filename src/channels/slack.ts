// flue-blueprint: channel/slack@1
import { dispatch } from '@flue/runtime';
import { createSlackChannel } from '@flue/slack';
import { BugTriage } from '../agents/bug-triage.ts';

export const channel = createSlackChannel({
	signingSecret: process.env.SLACK_SIGNING_SECRET!,

	// Path: /channels/slack/events
	async events({ payload }) {
		if (payload.type !== 'event_callback') return;
		const event = payload.event;

		// Only plain user messages posted in the configured bug-report channel:
		// no other channels, no bot posts, no subtypes (edits, joins, ...).
		if (event.type !== 'message') return;
		if (event.channel !== process.env.SLACK_BUG_CHANNEL_ID) return;
		if ('subtype' in event && event.subtype !== undefined) return;
		if ('bot_id' in event && event.bot_id !== undefined) return;
		if (!event.text) return;

		const thread = {
			teamId: payload.team_id,
			channelId: event.channel,
			threadTs: event.thread_ts ?? event.ts,
		};

		await dispatch(BugTriage, {
			id: channel.instanceId(thread),
			idempotencyKey: payload.event_id,
			// Recorded once when this event creates the instance; ignored after.
			initialData: {
				channelId: thread.channelId,
				threadTs: thread.threadTs,
				startedBy: event.user,
				startedAt: new Date(Number(event.ts) * 1000).toISOString(),
			},
			message: {
				kind: 'signal',
				type: 'slack.message',
				body: event.text,
				attributes: {
					eventId: payload.event_id,
					channelId: event.channel,
					threadTs: thread.threadTs,
					messageTs: event.ts,
					reporter: event.user,
				},
			},
		});
	},
});
