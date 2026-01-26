<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { Button } from '$components/ui/button';
	import X from 'lucide-svelte/icons/x';
	import AlertTriangle from 'lucide-svelte/icons/alert-triangle';

	interface Props {
		open?: boolean;
		title: string;
		message?: string;
		confirmText?: string;
		cancelText?: string;
		variant?: 'default' | 'destructive';
		onconfirm?: () => void | Promise<void>;
		oncancel?: () => void;
	}

	let {
		open = $bindable(false),
		title,
		message = '',
		confirmText,
		cancelText,
		variant = 'default',
		onconfirm,
		oncancel
	}: Props = $props();

	let dialogRef: HTMLDivElement | undefined = $state(undefined);
	let isProcessing = $state(false);

	const resolvedConfirmText = $derived(confirmText || $_('common.confirm'));
	const resolvedCancelText = $derived(cancelText || $_('common.cancel'));

	async function handleConfirm() {
		if (isProcessing) return;
		isProcessing = true;
		try {
			await onconfirm?.();
			open = false;
		} finally {
			isProcessing = false;
		}
	}

	function handleCancel() {
		oncancel?.();
		open = false;
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			handleCancel();
		}
	}

	function handleBackdropClick(event: MouseEvent) {
		if (event.target === event.currentTarget) {
			handleCancel();
		}
	}

	// Focus trap
	$effect(() => {
		if (open && dialogRef) {
			const focusableElements = dialogRef.querySelectorAll<HTMLElement>(
				'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
			);
			const firstElement = focusableElements[0];
			const lastElement = focusableElements[focusableElements.length - 1];

			firstElement?.focus();

			function handleTab(event: KeyboardEvent) {
				if (event.key !== 'Tab') return;

				if (event.shiftKey) {
					if (document.activeElement === firstElement) {
						event.preventDefault();
						lastElement?.focus();
					}
				} else {
					if (document.activeElement === lastElement) {
						event.preventDefault();
						firstElement?.focus();
					}
				}
			}

			document.addEventListener('keydown', handleTab);
			return () => document.removeEventListener('keydown', handleTab);
		}
	});
</script>

{#if open}
	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
		role="dialog"
		aria-modal="true"
		aria-labelledby="confirm-dialog-title"
		aria-describedby={message ? 'confirm-dialog-description' : undefined}
		onclick={handleBackdropClick}
		onkeydown={handleKeyDown}
	>
		<div
			bind:this={dialogRef}
			class="relative w-full max-w-md rounded-lg bg-background p-6 shadow-xl border border-border mx-4"
		>
			<!-- Close button -->
			<button
				class="absolute right-4 top-4 text-muted-foreground hover:text-foreground transition-colors"
				onclick={handleCancel}
				aria-label={$_('common.close')}
			>
				<X class="h-4 w-4" />
			</button>

			<!-- Icon for destructive variant -->
			{#if variant === 'destructive'}
				<div class="flex justify-center mb-4">
					<div class="rounded-full bg-destructive/10 p-3">
						<AlertTriangle class="h-6 w-6 text-destructive" />
					</div>
				</div>
			{/if}

			<!-- Title -->
			<h2
				id="confirm-dialog-title"
				class="text-lg font-semibold {variant === 'destructive' ? 'text-center' : ''}"
			>
				{title}
			</h2>

			<!-- Message -->
			{#if message}
				<p
					id="confirm-dialog-description"
					class="mt-2 text-sm text-muted-foreground {variant === 'destructive' ? 'text-center' : ''}"
				>
					{message}
				</p>
			{/if}

			<!-- Actions -->
			<div class="mt-6 flex {variant === 'destructive' ? 'flex-col-reverse sm:flex-row sm:justify-center' : 'justify-end'} gap-3">
				<Button
					variant="outline"
					onclick={handleCancel}
					disabled={isProcessing}
					class={variant === 'destructive' ? 'sm:w-auto w-full' : ''}
				>
					{resolvedCancelText}
				</Button>
				<Button
					variant={variant === 'destructive' ? 'destructive' : 'default'}
					onclick={handleConfirm}
					disabled={isProcessing}
					class={variant === 'destructive' ? 'sm:w-auto w-full' : ''}
				>
					{#if isProcessing}
						<span class="inline-block w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></span>
					{/if}
					{resolvedConfirmText}
				</Button>
			</div>
		</div>
	</div>
{/if}
