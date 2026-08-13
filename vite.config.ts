import { flue } from '@flue/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [flue()],
	server: {
		// Allow tunneled dev traffic (Slack Events API → ngrok → vite).
		allowedHosts: ['.ngrok-free.app'],
	},
});
