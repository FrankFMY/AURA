<script lang="ts">
	import { scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { cn } from '$lib/utils';
	import type { ComponentType } from 'svelte';

	interface Props {
		/** Icon component from lucide-svelte */
		icon: ComponentType;
		/** Main title */
		title: string;
		/** Description text */
		description?: string;
		/** Action button text */
		actionLabel?: string;
		/** Action button click handler */
		onAction?: () => void;
		/** Visual variant */
		variant?: 'default' | 'muted' | 'accent' | 'warning';
		/** Size variant */
		size?: 'sm' | 'md' | 'lg';
		/** Additional classes */
		class?: string;
	}

	let {
		icon: Icon,
		title,
		description,
		actionLabel,
		onAction,
		variant = 'default',
		size = 'md',
		class: className,
	}: Props = $props();

	const variantStyles = {
		default: {
			iconBg: 'bg-primary/10',
			iconColor: 'text-primary',
			glow: 'shadow-primary/20',
		},
		muted: {
			iconBg: 'bg-muted',
			iconColor: 'text-muted-foreground',
			glow: '',
		},
		accent: {
			iconBg: 'bg-accent/10',
			iconColor: 'text-accent',
			glow: 'shadow-accent/20',
		},
		warning: {
			iconBg: 'bg-warning/10',
			iconColor: 'text-warning',
			glow: 'shadow-warning/20',
		},
	};

	const sizeStyles = {
		sm: {
			container: 'py-6 px-4',
			iconWrapper: 'w-12 h-12',
			icon: 'h-6 w-6',
			title: 'text-base',
			description: 'text-sm max-w-xs',
		},
		md: {
			container: 'py-10 px-6',
			iconWrapper: 'w-16 h-16',
			icon: 'h-8 w-8',
			title: 'text-lg',
			description: 'text-sm max-w-sm',
		},
		lg: {
			container: 'py-16 px-8',
			iconWrapper: 'w-24 h-24',
			icon: 'h-12 w-12',
			title: 'text-xl',
			description: 'text-base max-w-md',
		},
	};

	const currentVariant = $derived(variantStyles[variant]);
	const currentSize = $derived(sizeStyles[size]);
</script>

<div
	class={cn(
		'flex flex-col items-center justify-center text-center',
		currentSize.container,
		className,
	)}
	in:scale={{ duration: 300, start: 0.95, easing: cubicOut }}
>
	<!-- Decorative background elements -->
	<div class="relative">
		<!-- Glow effect behind icon -->
		{#if variant !== 'muted'}
			<div
				class={cn(
					'absolute inset-0 rounded-full blur-2xl opacity-30 animate-pulse-glow',
					currentVariant.iconBg,
				)}
			></div>
		{/if}

		<!-- Icon container -->
		<div
			class={cn(
				'relative flex items-center justify-center rounded-full mb-4 animate-float',
				currentVariant.iconBg,
				currentSize.iconWrapper,
				variant !== 'muted' && 'ring-1 ring-inset ring-white/10',
			)}
		>
			<Icon class={cn(currentSize.icon, currentVariant.iconColor)} />
		</div>
	</div>

	<!-- Title -->
	<h3 class={cn('font-semibold text-foreground mb-2', currentSize.title)}>
		{title}
	</h3>

	<!-- Description -->
	{#if description}
		<p
			class={cn(
				'text-muted-foreground mx-auto leading-relaxed',
				currentSize.description,
			)}
		>
			{description}
		</p>
	{/if}

	<!-- Action button -->
	{#if actionLabel && onAction}
		<button
			onclick={onAction}
			class={cn(
				'mt-6 px-6 py-2.5 rounded-lg font-medium transition-all duration-200',
				'bg-primary text-primary-foreground',
				'hover:shadow-lg hover:shadow-primary/25 hover:-translate-y-0.5',
				'active:translate-y-0 active:shadow-md',
			)}
		>
			{actionLabel}
		</button>
	{/if}

	<!-- Decorative grid pattern -->
	{#if size === 'lg'}
		<div
			class="absolute inset-0 cyber-grid opacity-5 pointer-events-none"
			aria-hidden="true"
		></div>
	{/if}
</div>
