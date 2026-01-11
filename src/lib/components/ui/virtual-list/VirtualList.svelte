<script lang="ts" generics="T">
	import { onMount, onDestroy, tick } from 'svelte';

	interface Props {
		/** Array of items to render */
		items: T[];
		/** Estimated height of each item in pixels */
		itemHeight?: number;
		/** Number of items to render above/below the visible area */
		overscan?: number;
		/** Container height (CSS value) */
		height?: string;
		/** Callback when scrolling near the end */
		onEndReached?: () => void;
		/** Threshold in pixels before end to trigger onEndReached */
		endReachedThreshold?: number;
		/** Key function to get unique key for each item */
		getKey?: (item: T, index: number) => string | number;
		/** Snippet to render each item */
		children: import('svelte').Snippet<[{ item: T; index: number; style: string }]>;
		/** Class for the container */
		class?: string;
	}

	let {
		items,
		itemHeight = 100,
		overscan = 5,
		height = '100%',
		onEndReached,
		endReachedThreshold = 200,
		getKey = (_: T, index: number) => index,
		children,
		class: className = ''
	}: Props = $props();

	let container: HTMLDivElement;
	let scrollTop = $state(0);
	let containerHeight = $state(0);

	// Calculate virtual window
	const totalHeight = $derived(items.length * itemHeight);
	const startIndex = $derived(Math.max(0, Math.floor(scrollTop / itemHeight) - overscan));
	const endIndex = $derived(
		Math.min(items.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan)
	);
	const visibleItems = $derived(
		items.slice(startIndex, endIndex).map((item, i) => ({
			item,
			index: startIndex + i,
			key: getKey(item, startIndex + i)
		}))
	);
	const offsetY = $derived(startIndex * itemHeight);

	// Check if we're near the end
	let endReachedCalled = false;

	function handleScroll() {
		if (!container) return;
		scrollTop = container.scrollTop;

		// Check for end reached
		if (onEndReached && !endReachedCalled) {
			const distanceFromEnd = totalHeight - (scrollTop + containerHeight);
			if (distanceFromEnd < endReachedThreshold) {
				endReachedCalled = true;
				onEndReached();
			}
		}
	}

	// Reset endReachedCalled when items change
	$effect(() => {
		items;
		endReachedCalled = false;
	});

	// Update container height on resize
	let resizeObserver: ResizeObserver | null = null;

	onMount(() => {
		if (container) {
			containerHeight = container.clientHeight;

			resizeObserver = new ResizeObserver((entries) => {
				for (const entry of entries) {
					containerHeight = entry.contentRect.height;
				}
			});
			resizeObserver.observe(container);
		}
	});

	onDestroy(() => {
		resizeObserver?.disconnect();
	});

	/** Scroll to a specific index */
	export function scrollToIndex(index: number, behavior: ScrollBehavior = 'smooth') {
		if (container) {
			container.scrollTo({
				top: index * itemHeight,
				behavior
			});
		}
	}

	/** Scroll to top */
	export function scrollToTop(behavior: ScrollBehavior = 'smooth') {
		scrollToIndex(0, behavior);
	}

	/** Get current scroll position */
	export function getScrollTop(): number {
		return scrollTop;
	}
</script>

<div
	bind:this={container}
	class="overflow-y-auto overflow-x-hidden {className}"
	style="height: {height};"
	onscroll={handleScroll}
	role="list"
>
	<!-- Spacer for total height -->
	<div style="height: {totalHeight}px; position: relative;">
		<!-- Visible items container -->
		<div style="transform: translateY({offsetY}px);">
			{#each visibleItems as { item, index, key } (key)}
				{@render children({ item, index, style: `height: ${itemHeight}px;` })}
			{/each}
		</div>
	</div>
</div>
