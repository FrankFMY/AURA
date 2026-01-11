<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		src?: string | null;
		alt?: string;
		class?: string;
	}

	let { src, alt = '', class: className }: Props = $props();
	let hasError = $state(false);
</script>

{#if src && !hasError}
	<img
		{src}
		{alt}
		class={cn('aspect-square h-full w-full object-cover', className)}
		onerror={() => (hasError = true)}
	/>
{/if}
