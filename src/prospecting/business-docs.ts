import { parseKnowledge, type Knowledge } from './knowledge.ts';
// Workers have no filesystem at runtime, so the docs are bundled at build
// time. Vite's `?raw` import makes each file a string; editing a doc and
// redeploying is how the agent's knowledge changes.
import company from '../../docs/business/company.md?raw';
import icp from '../../docs/business/icp.md?raw';
import messaging from '../../docs/business/messaging.md?raw';
import products from '../../docs/business/products.md?raw';

let cached: Knowledge | undefined;

/** The validated business knowledge; parsed once per isolate. */
export function loadKnowledge(): Knowledge {
	cached ??= parseKnowledge({
		'company.md': company,
		'products.md': products,
		'icp.md': icp,
		'messaging.md': messaging,
	});
	return cached;
}
