import { cloudflare } from '@cloudflare/vite-plugin';
import { flue, flueWorkerConfig } from '@flue/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	// flue() must come before cloudflare(): it prepares the generated Worker
	// entry and the merged wrangler config the Cloudflare plugin consumes.
	plugins: [flue(), cloudflare({ config: flueWorkerConfig() })],
	server: {
		// Allow tunneled dev traffic (Slack Events API → ngrok → vite).
		allowedHosts: ['.ngrok-free.app'],
	},
});
