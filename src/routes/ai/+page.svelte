<script lang="ts">
	/**
	 * AI Chat Page
	 * 
	 * Decentralized AI chat powered by NIP-90 DVMs.
	 * Pay-per-use with Lightning/eCash.
	 */
	import { onMount, onDestroy, tick } from 'svelte';
	import { dvmStore, type ChatMessage } from '$stores/dvm.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { walletStore } from '$stores/wallet.svelte';
	import { cashuStore } from '$stores/cashu.svelte';
	import { goto } from '$app/navigation';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import { Textarea } from '$components/ui/textarea';
	import { Card, CardContent, CardHeader, CardFooter } from '$components/ui/card';
	import { Badge } from '$components/ui/badge';
	import { Spinner } from '$components/ui/spinner';
	import { Avatar, AvatarFallback } from '$components/ui/avatar';
	import { EmptyState } from '$components/ui/empty-state';
	import { DVMJobStatus } from '$lib/services/dvm';
	import Bot from 'lucide-svelte/icons/bot';
	import User from 'lucide-svelte/icons/user';
	import Send from 'lucide-svelte/icons/send';
	import Zap from 'lucide-svelte/icons/zap';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import Settings from 'lucide-svelte/icons/settings';
	import X from 'lucide-svelte/icons/x';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import AlertCircle from 'lucide-svelte/icons/alert-circle';
	import Check from 'lucide-svelte/icons/check';

	// State
	let inputValue = $state('');
	let messagesContainer: HTMLDivElement | undefined = $state();
	let showSettings = $state(false);
	let bidAmount = $state(dvmStore.defaultBid);

	// Scroll to bottom when new messages arrive
	$effect(() => {
		if (dvmStore.messages.length > 0) {
			scrollToBottom();
		}
	});

	onMount(() => {
		if (!authStore.isAuthenticated) {
			goto('/login');
			return;
		}
		
		// Add welcome message if first time
		if (dvmStore.messages.length === 0) {
			dvmStore.addSystemMessage(
				'Welcome to AURA AI! I\'m powered by decentralized DVMs (Data Vending Machines) on Nostr. ' +
				'Your queries are paid for with Lightning sats - no accounts, no tracking. Ask me anything!'
			);
		}
	});

	onDestroy(() => {
		// Don't cleanup to preserve chat history
	});

	async function scrollToBottom() {
		await tick();
		if (messagesContainer) {
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}
	}

	async function handleSend() {
		if (!inputValue.trim() || dvmStore.isProcessing) return;
		
		const message = inputValue;
		inputValue = '';
		
		await dvmStore.sendMessage(message);
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	function getStatusIcon(status: DVMJobStatus | undefined) {
		switch (status) {
			case DVMJobStatus.PENDING:
			case DVMJobStatus.PROCESSING:
				return 'loading';
			case DVMJobStatus.SUCCESS:
				return 'success';
			case DVMJobStatus.ERROR:
				return 'error';
			case DVMJobStatus.PAYMENT_REQUIRED:
				return 'payment';
			default:
				return 'none';
		}
	}

	function formatCost(cost: number | undefined): string {
		if (!cost) return '';
		return `${cost} sats`;
	}

	// Calculate available balance
	const availableBalance = $derived(
		(walletStore.balance || 0) + cashuStore.totalBalance
	);
</script>

<svelte:head>
	<title>AI Chat | AURA</title>
</svelte:head>

<div class="flex h-dvh flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
	<!-- Header -->
	<div class="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
		<div class="flex items-center justify-between p-4">
			<div class="flex items-center gap-2">
				<Bot class="h-6 w-6 text-primary" />
				<h1 class="text-xl font-bold">AI Chat</h1>
				<Badge variant="secondary" class="text-xs">NIP-90</Badge>
			</div>
			<div class="flex items-center gap-2">
				<Badge variant="outline" class="gap-1">
					<Zap class="h-3 w-3" />
					{availableBalance} sats
				</Badge>
				<Button
					variant="ghost"
					size="icon"
					onclick={() => showSettings = !showSettings}
				>
					<Settings class="h-5 w-5" />
				</Button>
				<Button
					variant="ghost"
					size="icon"
					onclick={() => dvmStore.clearChat()}
					disabled={dvmStore.messages.length === 0}
				>
					<Trash2 class="h-5 w-5" />
				</Button>
			</div>
		</div>

		<!-- Settings Panel -->
		{#if showSettings}
			<div class="border-t border-border p-4 bg-muted/50">
				<div class="flex items-center justify-between mb-3">
					<h3 class="font-medium">Settings</h3>
					<Button variant="ghost" size="icon" onclick={() => showSettings = false}>
						<X class="h-4 w-4" />
					</Button>
				</div>
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
					<div class="space-y-1">
						<label for="bid-amount" class="text-sm font-medium">Max bid per request (sats)</label>
						<Input
							id="bid-amount"
							type="number"
							value={String(bidAmount)}
							oninput={(e) => {
								bidAmount = parseInt((e.target as HTMLInputElement).value) || 100;
								dvmStore.setDefaultBid(bidAmount);
							}}
							min="1"
							max="10000"
						/>
					</div>
					<fieldset class="space-y-1">
						<legend class="text-sm font-medium">Auto-pay invoices</legend>
						<div class="flex items-center gap-2">
							<button
								class="px-3 py-2 rounded-md text-sm transition-colors
									{dvmStore.autoPayEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted'}"
								onclick={() => dvmStore.setAutoPay(true)}
							>
								Enabled
							</button>
							<button
								class="px-3 py-2 rounded-md text-sm transition-colors
									{!dvmStore.autoPayEnabled ? 'bg-primary text-primary-foreground' : 'bg-muted'}"
								onclick={() => dvmStore.setAutoPay(false)}
							>
								Disabled
							</button>
						</div>
					</fieldset>
				</div>
			</div>
		{/if}
	</div>

	<!-- Messages -->
	<div
		bind:this={messagesContainer}
		class="flex-1 overflow-y-auto p-4 space-y-4"
	>
		{#if dvmStore.messages.length === 0}
			<EmptyState
				icon={Sparkles}
				title="Start a conversation"
				description="Ask anything! Your messages are processed by decentralized AI providers and paid with Lightning."
				variant="muted"
				size="lg"
			/>
		{:else}
			{#each dvmStore.messages as message (message.id)}
				<div class="flex gap-3 {message.role === 'user' ? 'justify-end' : ''}">
					{#if message.role !== 'user'}
						<Avatar size="sm" class="shrink-0">
							<AvatarFallback class="bg-primary/10 text-primary">
								{#if message.role === 'system'}
									<Sparkles class="h-4 w-4" />
								{:else}
									<Bot class="h-4 w-4" />
								{/if}
							</AvatarFallback>
						</Avatar>
					{/if}

					<div class="max-w-[80%] {message.role === 'user' ? 'order-first' : ''}">
						<div
							class="rounded-lg px-4 py-2 {message.role === 'user'
								? 'bg-primary text-primary-foreground'
								: message.role === 'system'
									? 'bg-muted/50 border border-border'
									: 'bg-muted'}"
						>
							{#if message.status === DVMJobStatus.PENDING || message.status === DVMJobStatus.PROCESSING}
								<div class="flex items-center gap-2">
									<Spinner size="sm" />
									<span class="text-muted-foreground">
										{message.status === DVMJobStatus.PENDING ? 'Waiting for DVM...' : 'Processing...'}
									</span>
								</div>
							{:else if message.status === DVMJobStatus.ERROR}
								<div class="flex items-center gap-2 text-destructive">
									<AlertCircle class="h-4 w-4" />
									<span>{message.error || 'An error occurred'}</span>
								</div>
							{:else if message.status === DVMJobStatus.PAYMENT_REQUIRED}
								<div class="flex items-center gap-2 text-yellow-500">
									<Zap class="h-4 w-4" />
									<span>{message.error}</span>
								</div>
							{:else}
								<p class="whitespace-pre-wrap wrap-break-word">{message.content}</p>
							{/if}
						</div>

						<!-- Message metadata -->
						<div class="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
							{#if message.role === 'assistant' && message.status === DVMJobStatus.SUCCESS}
								<span class="flex items-center gap-1">
									<Check class="h-3 w-3 text-green-500" />
									{#if message.cost}
										<span>{formatCost(message.cost)}</span>
									{/if}
								</span>
							{/if}
							<span>
								{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
							</span>
						</div>
					</div>

					{#if message.role === 'user'}
						<Avatar size="sm" class="shrink-0">
							<AvatarFallback class="bg-primary text-primary-foreground">
								<User class="h-4 w-4" />
							</AvatarFallback>
						</Avatar>
					{/if}
				</div>
			{/each}
		{/if}
	</div>

	<!-- Input -->
	<div class="border-t border-border p-4 bg-background">
		{#if dvmStore.isProcessing}
			<div class="flex justify-center mb-2">
				<Button
					variant="outline"
					size="sm"
					onclick={() => dvmStore.cancel()}
				>
					<X class="h-4 w-4 mr-1" />
					Cancel
				</Button>
			</div>
		{/if}

		<!-- Retry button for errors -->
		{#if dvmStore.messages.length > 0}
			{@const lastMessage = dvmStore.messages[dvmStore.messages.length - 1]}
			{#if lastMessage.status === DVMJobStatus.ERROR && !dvmStore.isProcessing}
				<div class="flex justify-center mb-2">
					<Button
						variant="outline"
						size="sm"
						onclick={() => dvmStore.retryLast()}
					>
						<RotateCcw class="h-4 w-4 mr-1" />
						Retry
					</Button>
				</div>
			{/if}
		{/if}

		<div class="flex gap-2">
			<Textarea
				bind:value={inputValue}
				placeholder="Type your message..."
				class="min-h-[44px] max-h-32 resize-none"
				rows={1}
				onkeydown={handleKeydown}
				disabled={dvmStore.isProcessing}
			/>
			<Button
				variant="glow"
				size="icon"
				onclick={handleSend}
				disabled={!inputValue.trim() || dvmStore.isProcessing}
			>
				<Send class="h-5 w-5" />
			</Button>
		</div>

		<p class="text-xs text-muted-foreground mt-2 text-center">
			Powered by decentralized DVMs. Max {dvmStore.defaultBid} sats per request.
		</p>
	</div>
</div>
