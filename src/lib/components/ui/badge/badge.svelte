<script
	lang="ts"
	module
>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const badgeVariants = tv({
		base: 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
		variants: {
			variant: {
				default:
					'border-transparent bg-primary text-primary-foreground',
				secondary:
					'border-transparent bg-secondary text-secondary-foreground',
				destructive:
					'border-transparent bg-destructive text-destructive-foreground',
				outline: 'text-foreground',
				success:
					'border-transparent bg-success text-success-foreground',
				warning:
					'border-transparent bg-warning text-warning-foreground',
			},
		},
		defaultVariants: {
			variant: 'default',
		},
	});

	export type BadgeVariant = VariantProps<typeof badgeVariants>['variant'];
</script>

<script lang="ts">
	import { cn } from '$lib/utils';

	let {
		class: className,
		variant = 'default',
		children,
	}: {
		class?: string;
		variant?: BadgeVariant;
		children?: import('svelte').Snippet;
	} = $props();
</script>

<div class={cn(badgeVariants({ variant }), className)}>
	{@render children?.()}
</div>
