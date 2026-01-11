<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		class: className,
		children,
	}: { class?: string; children?: import('svelte').Snippet } = $props();
</script>

<div class={cn('flex items-center p-6 pt-0', className)}>
	{@render children?.()}
</div>
