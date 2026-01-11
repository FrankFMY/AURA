<script lang="ts">
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
				setTimeout(() => onclose(), 2500);
			}
		} catch (e) {
			console.error('Zap failed:', e);
			notificationsStore.error(
				'Zap failed',
				e instanceof Error ? e.message : 'Unknown error',
			);
		} finally {
			isLoading = false;
		}
	}

	async function copyInvoice() {
		if (zapResult?.invoice) {
			await navigator.clipboard.writeText(zapResult.invoice);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		}
	}

	function openInWallet() {
		if (zapResult?.invoice) {
			window.open(`lightning:${zapResult.invoice}`, '_blank');
		}
	}
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
						<h2 class="font-semibold">Send Zap</h2>
						<p class="text-xs text-muted-foreground">
							to {recipientName || 'this user'}
						</p>
					</div>
				</div>
				<Button
					variant="ghost"
					size="icon"
					onclick={onclose}
				>
					<X class="h-4 w-4" />
				</Button>
			</div>

			<!-- Content -->
			<div class="p-4 space-y-4">
				{#if !zapResult}
					<!-- Amount Selection -->
					<div class="space-y-2">
						<span class="text-sm font-medium">Amount (sats)</span>
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
							class="text-sm font-medium">Custom amount</label
						>
						<Input
							id="custom-amount"
							type="number"
							bind:value={customAmount}
							placeholder="Enter custom amount"
							min="1"
						/>
					</div>

					<!-- Comment -->
					<div class="space-y-2">
						<label
							for="zap-comment"
							class="text-sm font-medium"
							>Comment (optional)</label
						>
						<Textarea
							id="zap-comment"
							bind:value={comment}
							placeholder="Add a message..."
							rows={2}
						/>
					</div>

					<!-- Summary -->
					<div class="rounded-lg bg-muted p-3 text-center">
						<p class="text-sm text-muted-foreground">
							You will send
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
									{#each Array(8) as _, i}
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
								Zap Sent! ⚡
							</h3>
							<p class="text-2xl font-bold text-warning mt-2">
								+{effectiveAmount} sats
							</p>
							<p class="text-muted-foreground text-sm mt-1">
								zapped successfully
							</p>
						</div>
					{:else}
						<div class="space-y-4">
							<p
								class="text-sm text-muted-foreground text-center"
							>
								{zapResult.paymentAttempted ?
									'Payment failed. Copy the invoice to pay manually:'
								:	'No wallet connected. Copy the invoice to pay:'}
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
										Copied
									{:else}
										<Copy class="mr-2 h-4 w-4" />
										Copy Invoice
									{/if}
								</Button>
								<Button
									variant="glow"
									class="flex-1"
									onclick={openInWallet}
								>
									<ExternalLink class="mr-2 h-4 w-4" />
									Open Wallet
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
							Sending...
						{:else}
							<Zap class="mr-2 h-4 w-4" />
							Zap {effectiveAmount || 0} sats
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
