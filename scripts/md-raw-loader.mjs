// Node loader hook so the manual scripts can import the same
// `../../docs/business/*.md?raw` modules the Vite build bundles: any .md file
// resolves to a module whose default export is its text. Synchronous, for
// module.registerHooks().
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function load(url, context, nextLoad) {
	if (url.split('?')[0].endsWith('.md')) {
		const text = readFileSync(fileURLToPath(url.split('?')[0]), 'utf8');
		return { format: 'module', source: `export default ${JSON.stringify(text)};`, shortCircuit: true };
	}
	return nextLoad(url, context);
}
