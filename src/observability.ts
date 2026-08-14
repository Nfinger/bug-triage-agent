import { observe } from '@flue/runtime';

// Registered once at startup from app.ts. Subscribers run synchronously on
// the event emission path, so this stays cheap: structured console output,
// picked up by Workers Logs (see wrangler.jsonc `observability`) with no
// extra wiring. Per-response model/tool spans come from Flue's built-in
// Cloudflare tracing instrumentation, not from here.
export function setupObservability(): void {
	observe((event) => {
		switch (event.type) {
			case 'submission_settled':
				if (event.outcome === 'failed') {
					console.error(
						`[${event.agentName}] submission ${event.submissionId} failed:`,
						event.error?.message,
					);
				}
				break;

			// Token and cost usage per model turn, tagged by agent/model/purpose
			// so they can be filtered and summed in the Workers Logs dashboard.
			case 'turn':
				if (event.response.usage) {
					const { usage } = event.response;
					console.log('[metrics] llm.tokens', {
						agent: event.agentName,
						conversation: event.conversationId,
						model: event.request.requestedModel,
						purpose: event.purpose,
						input: usage.input,
						output: usage.output,
						cacheRead: usage.cacheRead,
						cacheWrite: usage.cacheWrite,
						totalTokens: usage.totalTokens,
						cost: usage.cost.total,
					});
				}
				break;

			// Tool-emitted log.info/warn/error calls (see file_github_issue /
			// comment_on_github_issue), plus the runtime's own log events.
			case 'log':
				console[event.level](`[${event.agentName}] ${event.message}`, {
					...event.attributes,
					conversation: event.conversationId,
				});
				break;
		}
	});
}
