<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		class?: string;
		shimmer?: boolean;
	}

	let { class: className, shimmer = true }: Props = $props();
</script>

<div
	class={cn(
		'rounded-md bg-muted',
		shimmer ? 'animate-shimmer' : 'animate-pulse',
		className,
	)}
></div>
