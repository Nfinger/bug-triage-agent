import { observe } from '@flue/runtime';

function correlation(event: {
	agentName?: string;
	instanceId?: string;
	submissionId?: string;
	conversationId?: string;
	operationId?: string;
	turnId?: string;
	taskId?: string;
}) {
	return {
		agent: event.agentName,
		instance: event.instanceId,
		submission: event.submissionId,
		conversation: event.conversationId,
		operation: event.operationId,
		turn: event.turnId,
		task: event.taskId,
	};
}

// Registered once at startup from app.ts. Subscribers run synchronously on
// the event emission path, so this stays cheap: content-free lifecycle markers
// plus structured tool logs, all picked up by Workers Logs. Prompt text, model
// output, tool arguments, task briefs, and tool results are intentionally not
// copied into these logs.
type ObservabilityEvent = Parameters<Parameters<typeof observe>[0]>[0];

export function handleObservabilityEvent(event: ObservabilityEvent): void {
	switch (event.type) {
			case 'submission_running':
				console.log('[lifecycle] submission running', {
					...correlation(event),
					kind: event.kind,
					attemptCount: event.attemptCount,
					maxAttempts: event.maxAttempts,
				});
				break;

			case 'submission_recovery':
				console.warn('[lifecycle] submission recovery', {
					...correlation(event),
					recoveryOperation: event.operation,
					outcome: event.outcome,
					attemptCount: event.attemptCount,
					maxAttempts: event.maxAttempts,
					errorType: event.error?.type ?? event.error?.name,
				});
				break;

			case 'submission_settled':
				console[event.outcome === 'completed' ? 'log' : 'error']('[lifecycle] submission settled', {
					...correlation(event),
					outcome: event.outcome,
					errorType: event.error?.type ?? event.error?.name,
				});
				break;

			case 'operation_start':
				console.log('[lifecycle] operation started', {
					...correlation(event),
					kind: event.operationKind,
				});
				break;

			case 'operation':
				console.log('[lifecycle] operation finished', {
					...correlation(event),
					kind: event.operationKind,
					durationMs: event.durationMs,
					isError: event.isError,
				});
				break;

			case 'turn_start':
				console.log('[lifecycle] turn started', {
					...correlation(event),
					purpose: event.purpose,
				});
				break;

			case 'turn': {
				console.log('[lifecycle] turn finished', {
					...correlation(event),
					purpose: event.purpose,
					model: event.request.requestedModel,
					durationMs: event.durationMs,
					finishReason: event.response.finishReason,
					isError: event.isError,
				});
				if (event.response.usage) {
					const { usage } = event.response;
					console.log('[metrics] llm.tokens', {
						...correlation(event),
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
			}

			case 'tool_start':
				console.log('[lifecycle] tool started', {
					...correlation(event),
					tool: event.toolName,
					toolCallId: event.toolCallId,
				});
				break;

			case 'tool':
				console.log('[lifecycle] tool finished', {
					...correlation(event),
					tool: event.toolName,
					toolCallId: event.toolCallId,
					durationMs: event.durationMs,
					isError: event.isError,
				});
				break;

			case 'task_start':
				console.log('[lifecycle] task started', {
					...correlation(event),
					subagent: event.agent,
				});
				break;

			case 'task':
				console.log('[lifecycle] task finished', {
					...correlation(event),
					subagent: event.agent,
					durationMs: event.durationMs,
					isError: event.isError,
				});
				break;

			// Tool-emitted log.info/warn/error calls, plus the runtime's own logs.
			case 'log':
				console[event.level](`[${event.agentName}] ${event.message}`, {
					...event.attributes,
					conversation: event.conversationId,
				});
				break;
	}
}

export function setupObservability(): void {
	observe(handleObservabilityEvent);
}
