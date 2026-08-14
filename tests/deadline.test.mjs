import assert from 'node:assert/strict';
import test from 'node:test';

import { withDeadline } from '../src/tools/deadline.ts';

test('withDeadline rejects when an operation never settles', async () => {
	const startedAt = Date.now();
	await assert.rejects(
		withDeadline(new Promise(() => {}), 20, 'dependency install'),
		/dependency install exceeded its 20ms deadline/,
	);
	assert.ok(Date.now() - startedAt < 500, 'deadline must settle independently of the operation');
});

test('withDeadline returns an operation that settles before its deadline', async () => {
	assert.equal(await withDeadline(Promise.resolve('ok'), 100, 'dependency install'), 'ok');
});
