<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		class: className,
		children,
	}: { class?: string; children?: import('svelte').Snippet } = $props();
</script>

<h3 class={cn('text-xl font-semibold leading-none tracking-tight', className)}>
	{@render children?.()}
</h3>
