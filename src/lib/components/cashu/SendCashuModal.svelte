<script lang="ts">
	/**
	 * SendCashuModal
	 * 
	 * Modal for sending eCash tokens in chat.
	 */
	import { cashuStore } from '$stores/cashu.svelte';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import { Spinner } from '$components/ui/spinner';
	import {
		Card,
		CardHeader,
		CardTitle,
		CardContent,
		CardFooter
	} from '$components/ui/card';
	import X from 'lucide-svelte/icons/x';
	import Coins from 'lucide-svelte/icons/coins';
	import Zap from 'lucide-svelte/icons/zap';
	import AlertCircle from 'lucide-svelte/icons/alert-circle';
	import Check from 'lucide-svelte/icons/check';

	interface Props {
		/** Whether the modal is open */
		open: boolean;
		/** Callback when token is created */
		onSend?: (token: string, amount: number) => void;
		/** Callback when modal is closed */
		onClose?: () => void;
	}

	let { open = $bindable(), onSend, onClose }: Props = $props();

	let amount = $state<number>(21);
	let memo = $state<string>('');
	let isSending = $state(false);
	let error = $state<string | null>(null);
	let generatedToken = $state<string | null>(null);
	let copied = $state(false);

	// Quick amount buttons
	const quickAmounts = [21, 100, 500, 1000];

	// Derived
	const balance = $derived(cashuStore.totalBalance);
	const canSend = $derived(amount > 0 && amount <= balance && !isSending);

	function handleClose() {
		// Reset state
		amount = 21;
		memo = '';
		error = null;
		generatedToken = null;
		copied = false;
		open = false;
		onClose?.();
	}

	async function handleSend() {
		if (!canSend) return;

		isSending = true;
		error = null;

		try {
			const result = await cashuStore.send(amount, memo || undefined);
			generatedToken = result.token;
			
			// Notify parent
			onSend?.(result.token, amount);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to create token';
		} finally {
			isSending = false;
		}
	}

	async function copyToken() {
		if (!generatedToken) return;
		
		try {
			await navigator.clipboard.writeText(generatedToken);
			copied = true;
			setTimeout(() => { copied = false; }, 2000);
		} catch (e) {
			console.error('Failed to copy:', e);
		}
	}

	function sendInChat() {
		if (generatedToken) {
			onSend?.(generatedToken, amount);
			handleClose();
		}
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
		onclick={handleClose}
		onkeydown={(e) => e.key === 'Escape' && handleClose()}
		role="button"
		tabindex="0"
	>
		<!-- Modal -->
		<Card
			class="w-full max-w-md bg-card shadow-xl"
			onclick={(e) => e.stopPropagation()}
		>
			<CardHeader class="flex flex-row items-center justify-between pb-2">
				<CardTitle class="flex items-center gap-2">
					<Coins class="w-5 h-5 text-amber-500" />
					Send eCash
				</CardTitle>
				<Button variant="ghost" size="icon" onclick={handleClose}>
					<X class="w-4 h-4" />
				</Button>
			</CardHeader>

			<CardContent class="space-y-4">
				{#if !generatedToken}
					<!-- Balance -->
					<div class="flex items-center justify-between p-3 rounded-lg bg-muted/50">
						<span class="text-sm text-muted-foreground">Available balance</span>
						<div class="flex items-center gap-1">
							<Zap class="w-4 h-4 text-amber-500" />
							<span class="font-mono font-medium">{balance}</span>
							<span class="text-sm text-muted-foreground">sats</span>
						</div>
					</div>

					<!-- Amount input -->
					<div class="space-y-2">
						<label for="amount" class="text-sm font-medium">Amount (sats)</label>
						<Input
							id="amount"
							type="number"
							min="1"
							max={balance}
							value={String(amount)}
							oninput={(e) => amount = parseInt((e.target as HTMLInputElement).value) || 0}
							placeholder="Enter amount"
							class="text-lg font-mono"
						/>
						
						<!-- Quick amounts -->
						<div class="flex gap-2">
							{#each quickAmounts as quickAmount}
								<Button
									variant={amount === quickAmount ? 'default' : 'outline'}
									size="sm"
									class="flex-1"
									onclick={() => { amount = quickAmount; }}
									disabled={quickAmount > balance}
								>
									{quickAmount}
								</Button>
							{/each}
						</div>
					</div>

					<!-- Memo input -->
					<div class="space-y-2">
						<label for="memo" class="text-sm font-medium">
							Memo <span class="text-muted-foreground">(optional)</span>
						</label>
						<Input
							id="memo"
							type="text"
							bind:value={memo}
							placeholder="What's this for?"
							maxlength={100}
						/>
					</div>

					<!-- Error -->
					{#if error}
						<div class="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
							<AlertCircle class="w-4 h-4 shrink-0" />
							<span class="text-sm">{error}</span>
						</div>
					{/if}

					<!-- Warning -->
					{#if amount > balance}
						<div class="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
							<AlertCircle class="w-4 h-4 shrink-0" />
							<span class="text-sm">Insufficient balance</span>
						</div>
					{/if}
				{:else}
					<!-- Success state -->
					<div class="space-y-4 text-center">
						<div class="flex items-center justify-center w-16 h-16 mx-auto rounded-full bg-green-500/10">
							<Check class="w-8 h-8 text-green-500" />
						</div>
						<div>
							<p class="text-lg font-medium">Token Created!</p>
							<p class="text-sm text-muted-foreground">
								{amount} sats ready to send
							</p>
						</div>

						<!-- Token preview -->
						<div class="p-3 rounded-lg bg-muted/50 font-mono text-xs break-all max-h-24 overflow-y-auto">
							{generatedToken.slice(0, 100)}...
						</div>
					</div>
				{/if}
			</CardContent>

			<CardFooter class="flex gap-2">
				{#if !generatedToken}
					<Button variant="outline" class="flex-1" onclick={handleClose}>
						Cancel
					</Button>
					<Button
						class="flex-1 bg-amber-500 hover:bg-amber-600"
						onclick={handleSend}
						disabled={!canSend}
					>
						{#if isSending}
							<Spinner size="sm" class="mr-2" />
							Creating...
						{:else}
							<Coins class="w-4 h-4 mr-2" />
							Create Token
						{/if}
					</Button>
				{:else}
					<Button variant="outline" class="flex-1" onclick={copyToken}>
						{copied ? 'Copied!' : 'Copy Token'}
					</Button>
					<Button
						class="flex-1 bg-amber-500 hover:bg-amber-600"
						onclick={sendInChat}
					>
						Send in Chat
					</Button>
				{/if}
			</CardFooter>
		</Card>
	</div>
{/if}
