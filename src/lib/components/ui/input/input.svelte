<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLInputAttributes, 'class' | 'value'> {
		value?: string;
		class?: string;
	}

	let {
		type = 'text',
		value = $bindable(''),
		placeholder,
		disabled = false,
		class: className,
		...restProps
	}: Props = $props();
</script>

<input
	{type}
	bind:value
	{placeholder}
	{disabled}
	class={cn(
		'flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background transition-all duration-200',
		'file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground',
		'placeholder:text-muted-foreground/60',
		'hover:border-primary/40',
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-primary',
		'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input',
		className,
	)}
	{...restProps}
/>
