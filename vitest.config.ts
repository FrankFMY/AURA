import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { resolve } from 'path';

export default defineConfig({
	plugins: [
		svelte({
			hot: !process.env.VITEST,
			compilerOptions: {
				// Force DOM generation for tests, preventing SSR-related errors
				generate: 'dom'
			}
		})
	],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}', 'tests/unit/**/*.{test,spec}.{js,ts}'],
		globals: true,
		environment: 'jsdom',
		setupFiles: ['./tests/setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html'],
			exclude: [
				'node_modules/',
				'tests/',
				'**/*.d.ts',
				'**/*.config.*',
				'**/types/**'
			]
		},
		alias: {
			$lib: resolve('./src/lib'),
			'$lib/*': resolve('./src/lib/*'),
			$app: resolve('./node_modules/@sveltejs/kit/src/runtime/app'),
			'$app/*': resolve('./node_modules/@sveltejs/kit/src/runtime/app/*'),
			$stores: resolve('./src/lib/stores'),
			'$stores/*': resolve('./src/lib/stores/*'),
			$services: resolve('./src/lib/services'),
			'$services/*': resolve('./src/lib/services/*'),
			$components: resolve('./src/lib/components'),
			'$components/*': resolve('./src/lib/components/*'),
			$db: resolve('./src/lib/db')
		}
	},
	resolve: {
		alias: {
			$lib: resolve('./src/lib'),
			$stores: resolve('./src/lib/stores'),
			$services: resolve('./src/lib/services'),
			$components: resolve('./src/lib/components'),
			$db: resolve('./src/lib/db')
		}
	}
});
