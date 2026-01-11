<script
	lang="ts"
	module
>
	import type { Snippet } from 'svelte';
	import { tv, type VariantProps } from 'tailwind-variants';

	export const buttonVariants = tv({
		base: 'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]',
		variants: {
			variant: {
				default:
					'bg-primary text-primary-foreground shadow-md hover:bg-primary/90 hover:shadow-lg hover:shadow-primary/20',
				destructive:
					'bg-destructive text-destructive-foreground shadow-md hover:bg-destructive/90',
				outline:
					'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
				secondary:
					'bg-secondary text-secondary-foreground hover:bg-secondary/80',
				ghost: 'hover:bg-accent hover:text-accent-foreground',
				link: 'text-primary underline-offset-4 hover:underline',
				glow: 'bg-primary text-primary-foreground shadow-md hover:shadow-lg hover:shadow-primary/40 glow-primary',
			},
			size: {
				default: 'h-10 px-4 py-2',
				sm: 'h-8 rounded-md px-3 text-xs',
				lg: 'h-12 rounded-lg px-8 text-base',
				icon: 'h-10 w-10',
			},
		},
		defaultVariants: {
			variant: 'default',
			size: 'default',
		},
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

	export interface ButtonProps {
		variant?: ButtonVariant;
		size?: ButtonSize;
		class?: string;
		disabled?: boolean;
		type?: 'button' | 'submit' | 'reset';
		href?: string;
		children?: Snippet;
		onclick?: (e: MouseEvent) => void;
		[key: string]: unknown;
	}
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		class: className,
		variant = 'default',
		size = 'default',
		disabled = false,
		type = 'button',
		href,
		children,
		onclick,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		{href}
		class={cn(buttonVariants({ variant, size }), className)}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		{type}
		{disabled}
		{onclick}
		class={cn(buttonVariants({ variant, size }), className)}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
