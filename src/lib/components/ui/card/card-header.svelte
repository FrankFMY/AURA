<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		class: className,
		children,
	}: { class?: string; children?: import('svelte').Snippet } = $props();
</script>

<div class={cn('flex flex-col space-y-1.5 p-6', className)}>
	{@render children?.()}
</div>
