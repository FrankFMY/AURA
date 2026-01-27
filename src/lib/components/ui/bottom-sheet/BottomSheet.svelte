<script lang="ts">
	import { browser } from '$app/environment';
	import X from 'lucide-svelte/icons/x';

	interface Props {
		open?: boolean;
		title?: string;
		children?: import('svelte').Snippet;
		onclose?: () => void;
	}

	let {
		open = $bindable(false),
		title = '',
		children,
		onclose
	}: Props = $props();

	let startY = $state(0);
	let currentY = $state(0);
	let isDragging = $state(false);

	function handleClose() {
		open = false;
		onclose?.();
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			handleClose();
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			handleClose();
		}
	}

	// Touch handling for swipe-to-close
	function handleTouchStart(event: TouchEvent) {
		startY = event.touches[0].clientY;
		isDragging = true;
	}

	function handleTouchMove(event: TouchEvent) {
		if (!isDragging) return;
		const deltaY = event.touches[0].clientY - startY;
		// Only allow dragging down
		currentY = Math.max(0, deltaY);
	}

	function handleTouchEnd() {
		if (currentY > 100) {
			handleClose();
		}
		currentY = 0;
		isDragging = false;
	}

	// Lock body scroll when open
	$effect(() => {
		if (browser && open) {
			document.body.style.overflow = 'hidden';
			return () => {
				document.body.style.overflow = '';
			};
		}
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<!-- svelte-ignore a11y_interactive_supports_focus -->
	<div
		class="fixed inset-0 z-60 flex items-end justify-center bg-black/50 backdrop-blur-sm transition-opacity duration-300"
		class:opacity-100={open}
		role="dialog"
		aria-modal="true"
		aria-labelledby={title ? 'bottom-sheet-title' : undefined}
		onclick={handleBackdropClick}
		onkeydown={handleKeyDown}
	>
		<div
			class="relative w-full max-w-lg rounded-t-2xl bg-background shadow-xl border-t border-x border-border safe-area-pb transition-transform duration-300 ease-out"
			style="transform: translateY({currentY}px)"
			ontouchstart={handleTouchStart}
			ontouchmove={handleTouchMove}
			ontouchend={handleTouchEnd}
		>
			<!-- Drag handle -->
			<div class="flex justify-center pt-3 pb-2">
				<div class="h-1 w-10 rounded-full bg-muted-foreground/30"></div>
			</div>

			<!-- Header -->
			{#if title}
				<div class="flex items-center justify-between px-4 pb-2">
					<h2 id="bottom-sheet-title" class="text-lg font-semibold">
						{title}
					</h2>
					<button
						class="rounded-full p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
						onclick={handleClose}
						aria-label="Close"
					>
						<X class="h-5 w-5" />
					</button>
				</div>
			{/if}

			<!-- Content -->
			<div class="max-h-[70vh] overflow-y-auto px-4 pb-4">
				{#if children}
					{@render children()}
				{/if}
			</div>
		</div>
	</div>
{/if}
