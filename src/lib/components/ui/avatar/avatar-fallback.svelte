<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		class: className,
		children,
	}: { class?: string; children?: import('svelte').Snippet } = $props();
</script>

<span
	class={cn(
		'flex h-full w-full items-center justify-center rounded-full bg-muted text-muted-foreground font-medium',
		className,
	)}
>
	{@render children?.()}
</span>
