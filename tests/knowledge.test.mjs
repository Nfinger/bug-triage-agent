import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { MAX_TOTAL_BYTES, parseKnowledge, personaMatchers } from '../src/prospecting/knowledge.ts';
import { lintMessage } from '../src/prospecting/lint.ts';

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

test('the checked-in voice rules make a relevant proposal without explaining the prospect’s business to them', async () => {
	const knowledge = parseKnowledge(await realDocs());

	assert.match(knowledge.prose, /Use research to choose a relevant proposal, not to summarize or interpret the prospect’s business/);
	assert.match(knowledge.prose, /Stay in Matt’s lane/);
	assert.match(knowledge.prose, /if \[venue\] ever wants lawn games for cocktail hour/);
	assert.doesNotMatch(knowledge.prose, /Mountain Star has nine acres to make cocktail hour feel like part of the wedding/);
});

test('the agent asks research to select the offer rather than narrate the prospect back to them', async () => {
	const source = await readFile(new URL('../src/agents/prospecting.ts', import.meta.url), 'utf8');

	assert.match(source, /Use research to choose the relevant proposal; do not repeat or interpret facts about the prospect/);
	assert.doesNotMatch(source, /one specific, true thing about them/);
});

test('the checked-in voice rules reject generic cold-email language', async () => {
	const knowledge = parseKnowledge(await realDocs());
	const problems = lintMessage(
		{
			subject: 'Events at Acme',
			body: 'Jane, I wanted to reach out because we help venues elevate their guest experience. I would love to connect and tell you more about our perfect lawn-game packages. Matt',
			evidence: ['https://acme.example/events'],
		},
		knowledge.messaging,
		new Set(['acme.example/events']),
	);

	assert.ok(problems.includes('contains banned phrase "wanted to reach out"'));
	assert.ok(problems.includes('contains banned phrase "would love to"'));
	assert.ok(problems.includes('contains banned phrase "elevate"'));
	assert.ok(problems.includes('contains banned phrase "perfect"'));
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
