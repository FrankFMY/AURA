<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils';

	interface Props {
		class?: string;
		children?: Snippet;
		onclick?: (e: MouseEvent) => void;
		[key: string]: unknown;
	}

	let { class: className, children, onclick, ...restProps }: Props = $props();
</script>

{#if onclick}
	<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
	<div
		class={cn(
			'rounded-xl border border-border bg-card text-card-foreground shadow-sm transition-all duration-200 cursor-pointer',
			className,
		)}
		{onclick}
		role="button"
		tabindex={0}
		onkeydown={(e) =>
			e.key === 'Enter' && onclick(e as unknown as MouseEvent)}
		{...restProps}
	>
		{@render children?.()}
	</div>
{:else}
	<div
		class={cn(
			'rounded-xl border border-border bg-card text-card-foreground shadow-sm transition-all duration-200',
			className,
		)}
		{...restProps}
	>
		{@render children?.()}
	</div>
{/if}
