import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [tailwindcss(), sveltekit()],
	optimizeDeps: {
		include: [
			'lucide-svelte',
			'nostr-tools',
			'dexie',
			'clsx',
			'tailwind-merge',
			'tailwind-variants',
			'dompurify',
			'@noble/curves',
			'@noble/hashes',
			'@noble/ciphers',
			'@cashu/cashu-ts'
		],
		esbuildOptions: {
			target: 'esnext'
		}
	},
	ssr: {
		// Don't externalize these packages in SSR
		noExternal: ['@noble/curves', '@noble/hashes', '@noble/ciphers']
	},
	build: {
		target: 'esnext',
		// Enable minification
		minify: 'esbuild',
		// Chunk splitting for better caching
		rollupOptions: {
			output: {
				manualChunks: (id) => {
					// Don't chunk SvelteKit internals
					if (id.includes('@sveltejs/kit')) {
						return undefined;
					}
					// Nostr-related packages
					if (id.includes('@nostr-dev-kit/ndk') || id.includes('nostr-tools')) {
						return 'vendor-nostr';
					}
					// UI packages
					if (id.includes('lucide-svelte') || id.includes('bits-ui') || id.includes('tailwind-variants')) {
						return 'vendor-ui';
					}
					// Utility packages
					if (id.includes('dexie') || id.includes('dompurify') || id.includes('zod')) {
						return 'vendor-utils';
					}
					// Noble crypto packages
					if (id.includes('@noble/')) {
						return 'vendor-crypto';
					}
					return undefined;
				}
			}
		},
		// Source maps for production debugging (optional)
		sourcemap: false,
		// Chunk size warnings
		chunkSizeWarningLimit: 500
	},
	// Enable compression preview
	preview: {
		headers: {
			'Cache-Control': 'public, max-age=31536000, immutable'
		}
	}
});
