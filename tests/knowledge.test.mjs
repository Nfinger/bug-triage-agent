import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { MAX_TOTAL_BYTES, parseKnowledge, personaMatchers } from '../src/prospecting/knowledge.ts';

async function realDocs() {
	const read = (name) => readFile(new URL(`../docs/business/${name}`, import.meta.url), 'utf8');
	return {
		'company.md': await read('company.md'),
		'products.md': await read('products.md'),
		'icp.md': await read('icp.md'),
		'messaging.md': await read('messaging.md'),
	};
}

test('the checked-in business docs parse', async () => {
	const knowledge = parseKnowledge(await realDocs());
	assert.ok(knowledge.icp.industries.length > 0);
	assert.ok(knowledge.messaging.maxWords > 0);
	assert.ok(knowledge.prose.includes('docs/business/products.md'));
	const matchers = personaMatchers(knowledge.icp);
	assert.ok(matchers.some((m) => m.test('Events Manager')));
	assert.ok(matchers.some((m) => m.test('Taproom Manager')));
	assert.ok(matchers.some((m) => m.test('HR Director')));
});

test('a missing doc fails before anything else', async () => {
	const docs = await realDocs();
	docs['products.md'] = '';
	assert.throws(() => parseKnowledge(docs), /products\.md is missing or empty/);
});

test('an invalid icp block is rejected with its path', async () => {
	const docs = await realDocs();
	docs['icp.md'] = docs['icp.md'].replace(/"industries": \[[^\]]*\]/, '"industries": []');
	assert.throws(() => parseKnowledge(docs), /icp\.md json block failed validation: industries/);
});

test('the size cap is enforced, not truncated', async () => {
	const docs = await realDocs();
	docs['company.md'] += '\n' + 'x'.repeat(MAX_TOTAL_BYTES);
	assert.throws(() => parseKnowledge(docs), /over the .*-byte cap/);
});
