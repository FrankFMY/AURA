<script lang="ts">
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import ArrowUp from 'lucide-svelte/icons/arrow-up';

	interface Props {
		/** Whether the button is visible */
		show: boolean;
		/** Callback when clicked */
		onClick: () => void;
		/** Position from bottom */
		bottom?: string;
		/** Position from right */
		right?: string;
	}

	let { show, onClick, bottom = '5rem', right = '1rem' }: Props = $props();
</script>

{#if show}
	<button
		onclick={onClick}
		class="fixed z-40 flex items-center justify-center w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:shadow-primary/25 transition-all duration-300 hover:-translate-y-1 active:scale-95 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
		style="bottom: {bottom}; right: {right};"
		aria-label="Scroll to top"
		transition:scale={{ duration: 200, start: 0.8, easing: cubicOut }}
	>
		<ArrowUp class="h-5 w-5" />
	</button>
{/if}
