<script lang="ts">
	import { cn } from '$lib/utils';
	import type { HTMLTextareaAttributes } from 'svelte/elements';

	interface Props extends Omit<HTMLTextareaAttributes, 'class' | 'value'> {
		value?: string;
		class?: string;
	}

	let {
		value = $bindable(''),
		placeholder,
		disabled = false,
		rows = 3,
		class: className,
		...restProps
	}: Props = $props();
</script>

<textarea
	bind:value
	{placeholder}
	{disabled}
	{rows}
	class={cn(
		'flex min-h-20 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background transition-all duration-200',
		'placeholder:text-muted-foreground/60',
		'hover:border-primary/40',
		'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:border-primary',
		'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-input',
		'resize-none',
		className,
	)}
	{...restProps}
></textarea>
