import adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({
			pages: 'build',
			assets: 'build',
			fallback: '200.html',
			precompress: false,
			strict: true
		}),
		alias: {
			$components: 'src/lib/components',
			$services: 'src/lib/services',
			$stores: 'src/lib/stores',
			$db: 'src/lib/db',
			$utils: 'src/lib/utils'
		}
	}
};

export default config;
