<script lang="ts">
	import { cn } from '$lib/utils';

	interface Props {
		class?: string;
		size?: 'sm' | 'md' | 'lg' | 'xl';
		children?: import('svelte').Snippet;
	}

	const sizeClasses = {
		sm: 'h-8 w-8',
		md: 'h-10 w-10',
		lg: 'h-12 w-12',
		xl: 'h-16 w-16',
	};

	let { class: className, size = 'md', children }: Props = $props();
</script>

<span
	class={cn(
		'relative flex shrink-0 overflow-hidden rounded-full transition-all duration-200 ring-2 ring-transparent hover:ring-primary/20',
		sizeClasses[size],
		className,
	)}
>
	{@render children?.()}
</span>
