<script lang="ts">
	import { onMount } from 'svelte';
	import { cn } from '$lib/utils';
	import ImageOff from 'lucide-svelte/icons/image-off';

	interface Props {
		src: string;
		alt?: string;
		class?: string;
		placeholder?: string;
		blurhash?: string;
		aspectRatio?: string;
		objectFit?: 'cover' | 'contain' | 'fill' | 'none';
		loading?: 'lazy' | 'eager';
		onLoad?: () => void;
		onError?: () => void;
	}

	let {
		src,
		alt = '',
		class: className = '',
		placeholder,
		blurhash,
		aspectRatio,
		objectFit = 'cover',
		loading = 'lazy',
		onLoad,
		onError,
	}: Props = $props();

	let imageElement = $state<HTMLImageElement | undefined>(undefined);
	let isLoaded = $state(false);
	let hasError = $state(false);
	let isInView = $state(false);

	// Generate placeholder color from blurhash or use default
	const placeholderColor = $derived(
		placeholder ||
			(blurhash ? extractDominantColor(blurhash) : 'rgb(var(--muted))'),
	);

	// Simple blurhash dominant color extraction (first pixel approximation)
	function extractDominantColor(hash: string): string {
		// This is a simplified version - real blurhash decoding is more complex
		// For now, return a neutral color
		return 'rgb(var(--muted))';
	}

	// Use Intersection Observer for lazy loading
	let observer: IntersectionObserver | null = null;

	onMount(() => {
		if (loading === 'lazy' && imageElement) {
			observer = new IntersectionObserver(
				(entries) => {
					for (const entry of entries) {
						if (entry.isIntersecting) {
							isInView = true;
							observer?.disconnect();
						}
					}
				},
				{
					rootMargin: '100px', // Start loading 100px before visible
					threshold: 0,
				},
			);
			observer.observe(imageElement);
		} else {
			isInView = true;
		}

		return () => {
			observer?.disconnect();
		};
	});

	function handleLoad() {
		isLoaded = true;
		onLoad?.();
	}

	function handleError() {
		hasError = true;
		onError?.();
	}

	// Sanitize src URL
	const safeSrc = $derived(() => {
		try {
			const url = new URL(src);
			if (!['http:', 'https:'].includes(url.protocol)) {
				return '';
			}
			return url.href;
		} catch {
			return '';
		}
	});
</script>

<div
	class={cn('relative overflow-hidden bg-muted', className)}
	style={aspectRatio ? `aspect-ratio: ${aspectRatio};` : ''}
>
	<!-- Placeholder background -->
	{#if !isLoaded && !hasError}
		<div
			class="absolute inset-0 animate-pulse"
			style="background: {placeholderColor};"
		></div>
	{/if}

	<!-- Error state -->
	{#if hasError}
		<div
			class="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground"
		>
			<ImageOff class="h-8 w-8" />
		</div>
	{:else}
		<!-- Actual image -->
		<img
			bind:this={imageElement}
			src={isInView ? safeSrc() : undefined}
			{alt}
			class={cn(
				'h-full w-full transition-opacity duration-300',
				objectFit === 'cover' && 'object-cover',
				objectFit === 'contain' && 'object-contain',
				objectFit === 'fill' && 'object-fill',
				objectFit === 'none' && 'object-none',
				isLoaded ? 'opacity-100' : 'opacity-0',
			)}
			{loading}
			decoding="async"
			onload={handleLoad}
			onerror={handleError}
		/>
	{/if}
</div>
