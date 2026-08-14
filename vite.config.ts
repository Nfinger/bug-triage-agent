import { cloudflare } from '@cloudflare/vite-plugin';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';

// flue() must come before cloudflare(): it prepares the generated Worker
// entry and merged wrangler config that the Cloudflare plugin consumes.
export default defineConfig({
	plugins: [flue(), cloudflare({ config: flueWorkerConfig() })],
	server: {
		// Allow tunneled dev traffic (Slack Events API → ngrok → vite).
		allowedHosts: ['.ngrok-free.app'],
	},
});
