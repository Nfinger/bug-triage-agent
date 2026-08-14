import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const githubChannel = await readFile(
	new URL('../src/channels/github.ts', import.meta.url),
	'utf8',
);

test('removing the coding label aborts stale per-issue work before a retry', () => {
	assert.match(githubChannel, /import \{ dispatch, init \} from '@flue\/runtime'/);
	assert.match(
		githubChannel,
		/if \(delivery\.payload\.action === 'unlabeled'\) \{[\s\S]*?init\(Coding, \{ id: instanceId \}\)\.abort\(\)/,
	);
	assert.match(githubChannel, /if \(delivery\.payload\.action !== 'labeled'\) return/);
});
