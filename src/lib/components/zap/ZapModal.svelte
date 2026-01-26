<script lang="ts">
	import { onDestroy } from 'svelte';
	import { _ } from 'svelte-i18n';
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { zapService, type ZapResult } from '$services/zap';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import { Textarea } from '$components/ui/textarea';
	import { Spinner } from '$components/ui/spinner';
	import { notificationsStore } from '$stores/notifications.svelte';
	import { fireZapConfetti } from '$lib/utils/confetti';
	import { playZapSound, vibrate } from '$lib/services/audio';
	import Zap from 'lucide-svelte/icons/zap';
	import X from 'lucide-svelte/icons/x';
	import Copy from 'lucide-svelte/icons/copy';
	import Check from 'lucide-svelte/icons/check';
	import ExternalLink from 'lucide-svelte/icons/external-link';

	// Timeout IDs for cleanup
	let closeTimeoutId: ReturnType<typeof setTimeout> | undefined;
	let copiedTimeoutId: ReturnType<typeof setTimeout> | undefined;

	interface Props {
		/** Whether modal is open */
		open: boolean;
		/** Recipient pubkey */
		recipientPubkey: string;
		/** Recipient display name */
		recipientName?: string;
		/** Lightning address or LNURL */
		lnurl: string;
		/** Event ID being zapped (optional) */
		eventId?: string;
		/** Close handler */
		onclose: () => void;
	}

	let {
		open,
		recipientPubkey,
		recipientName,
		lnurl,
		eventId,
		onclose,
	}: Props = $props();

	// Preset amounts in sats
	const presetAmounts = [21, 100, 500, 1000, 5000, 10000];

	let selectedAmount = $state(100);
	let customAmount = $state('');
	let comment = $state('');
	let isLoading = $state(false);
	let zapResult = $state<ZapResult | null>(null);
	let copied = $state(false);
	let showFlyingSats = $state(false);

	const effectiveAmount = $derived(
		customAmount ? parseInt(customAmount, 10) : selectedAmount,
	);

	function selectAmount(amount: number) {
		selectedAmount = amount;
		customAmount = '';
	}

	async function handleZap() {
		if (!effectiveAmount || effectiveAmount <= 0) {
			notificationsStore.error(
				'Invalid amount',
				'Please enter a valid amount',
			);
			return;
		}

		isLoading = true;
		zapResult = null;

		try {
			const result = await zapService.sendZap({
				recipientPubkey,
				amount: zapService.satsToMsats(effectiveAmount),
				lnurl,
				comment: comment || undefined,
				eventId,
			});

			zapResult = result;

			if (result.paymentResult?.success) {
				// Fire confetti celebration!
				fireZapConfetti();
				playZapSound();
				vibrate([10, 30, 10, 30, 10]);
				showFlyingSats = true;

				notificationsStore.success(
					'Zap sent! ⚡',
					`${effectiveAmount} sats zapped successfully`,
				);
				if (closeTimeoutId) clearTimeout(closeTimeoutId);
				closeTimeoutId = setTimeout(() => onclose(), 2500);
			}
		} catch (e) {
			console.error('Zap failed:', e);
			notificationsStore.error(
				'Zap failed',
				'Could not complete the zap. Please check your wallet connection and try again.',
			);
		} finally {
			isLoading = false;
		}
	}

	async function copyInvoice() {
		if (zapResult?.invoice) {
			try {
				if (!navigator.clipboard?.writeText) {
					notificationsStore.error('Copy failed', 'Clipboard API not available');
					return;
				}
				await navigator.clipboard.writeText(zapResult.invoice);
				copied = true;
				if (copiedTimeoutId) clearTimeout(copiedTimeoutId);
				copiedTimeoutId = setTimeout(() => (copied = false), 2000);
			} catch (e) {
				console.error('Failed to copy invoice:', e);
				notificationsStore.error('Copy failed', 'Could not copy to clipboard');
			}
		}
	}

	function openInWallet() {
		if (zapResult?.invoice) {
			window.open(`lightning:${zapResult.invoice}`, '_blank');
		}
	}

	// Cleanup timeouts on component destroy
	onDestroy(() => {
		if (closeTimeoutId) clearTimeout(closeTimeoutId);
		if (copiedTimeoutId) clearTimeout(copiedTimeoutId);
	});
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
		onclick={onclose}
		onkeydown={(e) => e.key === 'Escape' && onclose()}
		role="button"
		tabindex="-1"
		transition:fade={{ duration: 200 }}
	></div>

	<!-- Modal -->
	<div
		class="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4"
		transition:scale={{ duration: 250, start: 0.95, easing: cubicOut }}
		role="dialog"
		aria-modal="true"
		aria-labelledby="zap-modal-title"
	>
		<div
			class="rounded-lg border border-border bg-background shadow-xl card-elevated-lg"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-border p-4"
			>
				<div class="flex items-center gap-2">
					<div
						class="flex h-8 w-8 items-center justify-center rounded-full bg-warning/10"
					>
						<Zap class="h-4 w-4 text-warning" />
					</div>
					<div>
						<h2 id="zap-modal-title" class="font-semibold">{$_('components.zap.title')}</h2>
						<p class="text-xs text-muted-foreground">
							{$_('components.zap.toUser', { values: { name: recipientName || $_('profile.title') } })}
						</p>
					</div>
				</div>
				<Button
					variant="ghost"
					size="icon"
					onclick={onclose}
					aria-label="Close"
				>
					<X class="h-4 w-4" />
				</Button>
			</div>

			<!-- Content -->
			<div class="p-4 space-y-4">
				{#if !zapResult}
					<!-- Amount Selection -->
					<div class="space-y-2">
						<span class="text-sm font-medium">{$_('components.zap.amount')}</span>
						<div
							class="grid grid-cols-3 gap-2"
							role="group"
							aria-label="Amount selection"
						>
							{#each presetAmounts as amount}
								<Button
									variant={(
										selectedAmount === amount &&
										!customAmount
									) ?
										'default'
									:	'outline'}
									size="sm"
									onclick={() => selectAmount(amount)}
								>
									⚡ {amount}
								</Button>
							{/each}
						</div>
					</div>

					<!-- Custom Amount -->
					<div class="space-y-2">
						<label
							for="custom-amount"
							class="text-sm font-medium">{$_('components.zap.customAmount')}</label
						>
						<Input
							id="custom-amount"
							type="number"
							bind:value={customAmount}
							placeholder={$_('components.zap.customAmountPlaceholder')}
							min="1"
						/>
					</div>

					<!-- Comment -->
					<div class="space-y-2">
						<label
							for="zap-comment"
							class="text-sm font-medium"
							>{$_('components.zap.comment')}</label
						>
						<Textarea
							id="zap-comment"
							bind:value={comment}
							placeholder={$_('components.zap.commentPlaceholder')}
							rows={2}
						/>
					</div>

					<!-- Summary -->
					<div class="rounded-lg bg-muted p-3 text-center">
						<p class="text-sm text-muted-foreground">
							{$_('components.zap.willSend')}
						</p>
						<p class="text-2xl font-bold text-warning">
							⚡ {effectiveAmount || 0} sats
						</p>
					</div>
				{:else}
					<!-- Result -->
					{#if zapResult.paymentResult?.success}
						<div class="text-center py-4 relative overflow-hidden">
							<!-- Flying sats animation -->
							{#if showFlyingSats}
								<div
									class="absolute inset-0 pointer-events-none"
								>
									{#each Array(8) as _, i (i)}
										<span
											class="flying-sat absolute text-2xl"
											style="left: {20 +
												i * 10}%; animation-delay: {i *
												0.1}s"
										>
											⚡
										</span>
									{/each}
								</div>
							{/if}

							<div
								class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-warning/20 animate-bounce"
							>
								<Zap class="h-8 w-8 text-warning" />
							</div>
							<h3 class="text-lg font-semibold text-warning">
								{$_('components.zap.zapSent')}
							</h3>
							<p class="text-2xl font-bold text-warning mt-2">
								{$_('components.zap.satsZapped', { values: { amount: effectiveAmount } })}
							</p>
							<p class="text-muted-foreground text-sm mt-1">
								{$_('components.zap.zappedSuccessfully')}
							</p>
						</div>
					{:else}
						<div class="space-y-4">
							<p
								class="text-sm text-muted-foreground text-center"
							>
								{zapResult.paymentAttempted ?
									$_('components.zap.paymentFailed')
								:	$_('components.zap.noWallet')}
							</p>

							<!-- Invoice Display -->
							<div class="rounded-lg bg-muted p-3">
								<p class="break-all font-mono text-xs">
									{zapResult.invoice.slice(0, 50)}...
								</p>
							</div>

							<div class="flex gap-2">
								<Button
									variant="outline"
									class="flex-1"
									onclick={copyInvoice}
								>
									{#if copied}
										<Check class="mr-2 h-4 w-4" />
										{$_('auth.copied')}
									{:else}
										<Copy class="mr-2 h-4 w-4" />
										{$_('components.zap.copyInvoice')}
									{/if}
								</Button>
								<Button
									variant="glow"
									class="flex-1"
									onclick={openInWallet}
								>
									<ExternalLink class="mr-2 h-4 w-4" />
									{$_('components.zap.openWallet')}
								</Button>
							</div>
						</div>
					{/if}
				{/if}
			</div>

			<!-- Footer -->
			{#if !zapResult}
				<div class="border-t border-border p-4">
					<Button
						variant="glow"
						class="w-full"
						onclick={handleZap}
						disabled={isLoading || !effectiveAmount}
					>
						{#if isLoading}
							<Spinner class="mr-2 h-4 w-4" />
							{$_('components.zap.sending')}
						{:else}
							<Zap class="mr-2 h-4 w-4" />
							{$_('note.zap')} {effectiveAmount || 0} sats
						{/if}
					</Button>
				</div>
			{/if}
		</div>
	</div>
{/if}

<style>
	@keyframes fly-up {
		0% {
			opacity: 1;
			transform: translateY(100px) scale(1);
		}
		50% {
			opacity: 1;
		}
		100% {
			opacity: 0;
			transform: translateY(-100px) scale(1.5);
		}
	}

	.flying-sat {
		animation: fly-up 1.5s ease-out forwards;
	}
</style>
