<script lang="ts">
	import { Spinner } from '$components/ui/spinner';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';

	interface Props {
		/** Callback function when refresh is triggered */
		onRefresh: () => Promise<void>;
		/** Threshold in pixels to trigger refresh */
		threshold?: number;
		/** Whether refreshing is currently disabled */
		disabled?: boolean;
		/** Content to render */
		children: import('svelte').Snippet;
	}

	let {
		onRefresh,
		threshold = 80,
		disabled = false,
		children,
	}: Props = $props();

	let container: HTMLDivElement;
	let startY = 0;
	let pullDistance = $state(0);
	let isRefreshing = $state(false);
	let isPulling = $state(false);

	const progress = $derived(Math.min(pullDistance / threshold, 1));
	const shouldRefresh = $derived(pullDistance >= threshold);

	function handleTouchStart(e: TouchEvent) {
		if (disabled || isRefreshing) return;
		if (container.scrollTop > 0) return;

		startY = e.touches[0].clientY;
		isPulling = true;
	}

	function handleTouchMove(e: TouchEvent) {
		if (!isPulling || disabled || isRefreshing) return;

		const currentY = e.touches[0].clientY;
		const diff = currentY - startY;

		if (diff > 0 && container.scrollTop === 0) {
			// Apply resistance to pull
			pullDistance = Math.min(diff * 0.5, threshold * 1.5);
			e.preventDefault();
		}
	}

	async function handleTouchEnd() {
		if (!isPulling) return;
		isPulling = false;

		if (shouldRefresh && !isRefreshing) {
			isRefreshing = true;
			try {
				await onRefresh();
			} finally {
				isRefreshing = false;
			}
		}

		pullDistance = 0;
	}
</script>

<div
	bind:this={container}
	class="relative h-full overflow-y-auto"
	ontouchstart={handleTouchStart}
	ontouchmove={handleTouchMove}
	ontouchend={handleTouchEnd}
	role="region"
>
	<!-- Pull indicator -->
	{#if pullDistance > 0 || isRefreshing}
		<div
			class="absolute left-0 right-0 top-0 flex items-center justify-center transition-transform duration-200"
			style="height: {Math.max(
				pullDistance,
				isRefreshing ? 60 : 0,
			)}px; transform: translateY(-{isRefreshing ? 0 : (
				Math.max(60 - pullDistance, 0)
			)}px);"
		>
			<div
				class="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10"
				style="transform: rotate({progress * 180}deg);"
			>
				{#if isRefreshing}
					<Spinner size="sm" />
				{:else}
					<RefreshCw
						class="h-5 w-5 text-primary transition-opacity {(
							shouldRefresh
						) ?
							'opacity-100'
						:	'opacity-50'}"
					/>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Content -->
	<div
		class="transition-transform duration-200"
		style="transform: translateY({pullDistance}px);"
	>
		{@render children()}
	</div>
</div>
