<script lang="ts">
	/**
	 * CashuTokenBubble
	 *
	 * Displays a Cashu eCash token in chat as a beautiful card.
	 * Shows amount and allows the recipient to claim.
	 */
	import { _ } from 'svelte-i18n';
	import { cashuStore } from '$stores/cashu.svelte';
	import { Button } from '$components/ui/button';
	import { Spinner } from '$components/ui/spinner';
	import Coins from 'lucide-svelte/icons/coins';
	import Check from 'lucide-svelte/icons/check';
	import AlertCircle from 'lucide-svelte/icons/alert-circle';
	import Zap from 'lucide-svelte/icons/zap';

	interface Props {
		/** The Cashu token string */
		token: string;
		/** Whether this is an outgoing (sent by current user) token */
		isOutgoing?: boolean;
		/** Sender's pubkey (for incoming tokens) */
		senderPubkey?: string;
	}

	let { token, isOutgoing = false, senderPubkey }: Props = $props();

	let status = $state<'pending' | 'claiming' | 'claimed' | 'error'>('pending');
	let errorMessage = $state<string | null>(null);
	let validationResult = $state<{
		valid: boolean;
		amount: number;
		mint: string;
		memo?: string;
		error?: string;
	} | null>(null);

	// Validate token on mount
	$effect(() => {
		validateToken();
	});

	async function validateToken() {
		validationResult = await cashuStore.validateToken(token);
	}

	async function claimToken() {
		if (status !== 'pending' || !validationResult?.valid) return;

		status = 'claiming';
		errorMessage = null;

		try {
			await cashuStore.receive(token, senderPubkey);
			status = 'claimed';
		} catch (e) {
			status = 'error';
			errorMessage = e instanceof Error ? e.message : 'Failed to claim token';
		}
	}
</script>

<div
	class="inline-flex flex-col gap-2 rounded-xl p-3 max-w-[280px]
		{isOutgoing 
			? 'bg-primary/10 border border-primary/20' 
			: 'bg-amber-500/10 border border-amber-500/20'}"
>
	<!-- Header -->
	<div class="flex items-center gap-2">
		<div
			class="flex items-center justify-center w-8 h-8 rounded-full
				{isOutgoing ? 'bg-primary/20' : 'bg-amber-500/20'}"
		>
			<Coins class="w-4 h-4 {isOutgoing ? 'text-primary' : 'text-amber-500'}" />
		</div>
		<div class="flex-1">
			<p class="text-sm font-medium {isOutgoing ? 'text-primary' : 'text-amber-600 dark:text-amber-400'}">
				{isOutgoing ? $_('components.cashu.sent') : $_('components.cashu.received')}
			</p>
			{#if validationResult?.memo}
				<p class="text-xs text-muted-foreground truncate">{validationResult.memo}</p>
			{/if}
		</div>
	</div>

	<!-- Amount -->
	{#if validationResult?.valid}
		<div class="flex items-center justify-center gap-1 py-2">
			<Zap class="w-5 h-5 text-amber-500" />
			<span class="text-2xl font-bold">{validationResult.amount}</span>
			<span class="text-sm text-muted-foreground">{$_('components.cashu.sats')}</span>
		</div>
	{:else if validationResult?.error}
		<div class="flex items-center gap-2 py-2 text-destructive">
			<AlertCircle class="w-4 h-4" />
			<span class="text-sm">{$_('components.cashu.invalidToken')}</span>
		</div>
	{:else}
		<div class="flex justify-center py-2">
			<Spinner size="sm" />
		</div>
	{/if}

	<!-- Action button (only for incoming tokens) -->
	{#if !isOutgoing && validationResult?.valid}
		{#if status === 'pending'}
			<Button
				variant="default"
				size="sm"
				class="w-full bg-amber-500 hover:bg-amber-600 text-white"
				onclick={claimToken}
			>
				<Coins class="w-4 h-4 mr-2" />
				{$_('components.cashu.claim', { values: { amount: validationResult.amount } })}
			</Button>
		{:else if status === 'claiming'}
			<Button variant="outline" size="sm" class="w-full" disabled>
				<Spinner size="sm" class="mr-2" />
				{$_('components.cashu.claiming')}
			</Button>
		{:else if status === 'claimed'}
			<div class="flex items-center justify-center gap-2 py-1 text-green-600 dark:text-green-400">
				<Check class="w-4 h-4" />
				<span class="text-sm font-medium">{$_('components.cashu.claimed')}</span>
			</div>
		{:else if status === 'error'}
			<div class="space-y-2">
				<div class="flex items-center gap-2 text-destructive">
					<AlertCircle class="w-4 h-4" />
					<span class="text-xs">{errorMessage}</span>
				</div>
				<Button variant="outline" size="sm" class="w-full" onclick={claimToken}>
					{$_('components.cashu.tryAgain')}
				</Button>
			</div>
		{/if}
	{/if}

	<!-- Outgoing status -->
	{#if isOutgoing}
		<p class="text-xs text-center text-muted-foreground">
			{$_('components.cashu.waitingToClaim')}
		</p>
	{/if}
</div>
