import assert from 'node:assert/strict';
import test from 'node:test';

import { handleObservabilityEvent } from '../src/observability.ts';

const common = {
	agentName: 'coding-agent',
	instanceId: 'instance-1',
	submissionId: 'submission-1',
	conversationId: 'conversation-1',
	operationId: 'operation-1',
	turnId: 'turn-1',
	taskId: 'task-1',
};

const lifecycleEvents = [
	{
		...common,
		type: 'submission_running',
		kind: 'dispatch',
		attemptCount: 1,
		maxAttempts: 3,
		prompt: '__SECRET_submission_prompt__',
	},
	{
		...common,
		type: 'submission_recovery',
		operation: 'process_submission',
		outcome: 'deferred',
		attemptCount: 2,
		maxAttempts: 3,
		error: {
			type: 'TimeoutError',
			name: 'Error',
			message: '__SECRET_recovery_error_message__',
		},
	},
	{
		...common,
		type: 'submission_settled',
		outcome: 'failed',
		error: {
			type: 'RuntimeError',
			name: 'Error',
			message: '__SECRET_settled_error_message__',
		},
	},
	{
		...common,
		type: 'submission_settled',
		outcome: 'completed',
	},
	{
		...common,
		type: 'operation_start',
		operationKind: 'task',
		agentInput: '__SECRET_operation_input__',
	},
	{
		...common,
		type: 'operation',
		operationKind: 'task',
		durationMs: 101,
		isError: false,
		result: '__SECRET_operation_result__',
		effectiveResult: '__SECRET_operation_effective_result__',
	},
	{
		...common,
		type: 'turn_start',
		purpose: 'agent',
		prompt: '__SECRET_turn_prompt__',
		request: {
			requestedModel: 'model-1',
			messages: ['__SECRET_turn_start_messages__'],
		},
	},
	{
		...common,
		type: 'turn',
		purpose: 'agent',
		durationMs: 202,
		isError: false,
		request: {
			requestedModel: 'model-1',
			prompt: '__SECRET_turn_request_prompt__',
			messages: ['__SECRET_turn_request_messages__'],
		},
		response: {
			finishReason: 'stop',
			output: '__SECRET_turn_response_output__',
			content: '__SECRET_turn_response_content__',
			text: '__SECRET_turn_response_text__',
			usage: {
				input: 11,
				output: 12,
				cacheRead: 3,
				cacheWrite: 4,
				totalTokens: 23,
				cost: { total: 0.01 },
			},
		},
	},
	{
		...common,
		type: 'tool_start',
		toolName: 'bash',
		toolCallId: 'tool-call-1',
		arguments: '__SECRET_tool_arguments__',
		args: '__SECRET_tool_args__',
	},
	{
		...common,
		type: 'tool',
		toolName: 'bash',
		toolCallId: 'tool-call-1',
		durationMs: 303,
		isError: false,
		result: '__SECRET_tool_result__',
		effectiveResult: '__SECRET_tool_effective_result__',
	},
	{
		...common,
		type: 'task_start',
		agent: 'worker-agent',
		prompt: '__SECRET_task_prompt__',
		agentInput: '__SECRET_task_input__',
	},
	{
		...common,
		type: 'task',
		agent: 'worker-agent',
		durationMs: 404,
		isError: false,
		result: '__SECRET_task_result__',
		effectiveResult: '__SECRET_task_effective_result__',
	},
];

const expectedFieldsByLabel = {
	'[lifecycle] submission running': ['agent', 'attemptCount', 'conversation', 'instance', 'kind', 'maxAttempts', 'operation', 'submission', 'task', 'turn'],
	'[lifecycle] submission recovery': ['agent', 'attemptCount', 'conversation', 'errorType', 'instance', 'maxAttempts', 'operation', 'outcome', 'recoveryOperation', 'submission', 'task', 'turn'],
	'[lifecycle] submission settled': ['agent', 'conversation', 'errorType', 'instance', 'operation', 'outcome', 'submission', 'task', 'turn'],
	'[lifecycle] operation started': ['agent', 'conversation', 'instance', 'kind', 'operation', 'submission', 'task', 'turn'],
	'[lifecycle] operation finished': ['agent', 'conversation', 'durationMs', 'instance', 'isError', 'kind', 'operation', 'submission', 'task', 'turn'],
	'[lifecycle] turn started': ['agent', 'conversation', 'instance', 'operation', 'purpose', 'submission', 'task', 'turn'],
	'[lifecycle] turn finished': ['agent', 'conversation', 'durationMs', 'finishReason', 'instance', 'isError', 'model', 'operation', 'purpose', 'submission', 'task', 'turn'],
	'[metrics] llm.tokens': ['agent', 'cacheRead', 'cacheWrite', 'conversation', 'cost', 'input', 'instance', 'model', 'operation', 'output', 'purpose', 'submission', 'task', 'totalTokens', 'turn'],
	'[lifecycle] tool started': ['agent', 'conversation', 'instance', 'operation', 'submission', 'task', 'tool', 'toolCallId', 'turn'],
	'[lifecycle] tool finished': ['agent', 'conversation', 'durationMs', 'instance', 'isError', 'operation', 'submission', 'task', 'tool', 'toolCallId', 'turn'],
	'[lifecycle] task started': ['agent', 'conversation', 'instance', 'operation', 'submission', 'subagent', 'task', 'turn'],
	'[lifecycle] task finished': ['agent', 'conversation', 'durationMs', 'instance', 'isError', 'operation', 'submission', 'subagent', 'task', 'turn'],
};

const expectedCountByLabel = Object.fromEntries(
	Object.keys(expectedFieldsByLabel).map((label) => [
		label,
		label === '[lifecycle] submission settled' ? 2 : 1,
	]),
);

test('lifecycle observer is synchronous-safe and logs only allowlisted metadata', () => {
	const captured = [];
	const originalConsole = {
		log: console.log,
		warn: console.warn,
		error: console.error,
	};

	for (const level of Object.keys(originalConsole)) {
		console[level] = (...args) => captured.push({ level, args });
	}

	try {
		for (const event of lifecycleEvents) {
			assert.doesNotThrow(() => handleObservabilityEvent(event));
		}
	} finally {
		Object.assign(console, originalConsole);
	}

	assert.equal(
		captured.length,
		Object.values(expectedCountByLabel).reduce((total, count) => total + count, 0),
	);
	const countByLabel = Object.fromEntries(
		Object.keys(expectedFieldsByLabel).map((label) => [label, 0]),
	);
	for (const { args } of captured) {
		assert.equal(args.length, 2);
		const [label, fields] = args;
		assert.ok(label in expectedFieldsByLabel, `unexpected log label: ${label}`);
		countByLabel[label] += 1;
		assert.deepEqual(
			Object.keys(fields).sort(),
			[...expectedFieldsByLabel[label]].sort(),
		);
	}
	assert.deepEqual(countByLabel, expectedCountByLabel);

	assert.doesNotMatch(JSON.stringify(captured), /__SECRET_/);
});
