<script lang="ts">
	import { walletStore } from '$stores/wallet.svelte';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import {
		Card,
		CardHeader,
		CardTitle,
		CardDescription,
		CardContent,
		CardFooter,
	} from '$components/ui/card';
	import { Badge } from '$components/ui/badge';
	import { Spinner } from '$components/ui/spinner';
	import { formatRelativeTime } from '$lib/utils';
	import Wallet from 'lucide-svelte/icons/wallet';
	import Zap from 'lucide-svelte/icons/zap';
	import Link from 'lucide-svelte/icons/link';
	import Unlink from 'lucide-svelte/icons/unlink';
	import ArrowUpRight from 'lucide-svelte/icons/arrow-up-right';
	import ArrowDownLeft from 'lucide-svelte/icons/arrow-down-left';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import Copy from 'lucide-svelte/icons/copy';
	import Check from 'lucide-svelte/icons/check';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import { copyToClipboard } from '$lib/utils';

	let nwcInput = $state('');
	let showConnect = $state(false);
	let copied = $state(false);
	let payInvoiceInput = $state('');
	let showPayInvoice = $state(false);

	async function handleConnect() {
		if (!nwcInput.trim()) return;

		try {
			await walletStore.connect(nwcInput);
			nwcInput = '';
			showConnect = false;
		} catch (e) {
			// Error is handled in store
		}
	}

	async function handleDisconnect() {
		await walletStore.disconnect();
	}

	async function handleRefreshBalance() {
		try {
			await walletStore.fetchBalance();
		} catch (e) {
			// Error handled in store
		}
	}

	async function handlePayInvoice() {
		if (!payInvoiceInput.trim()) return;

		try {
			await walletStore.payInvoice(payInvoiceInput);
			payInvoiceInput = '';
			showPayInvoice = false;
		} catch (e) {
			// Error handled in store
		}
	}

	async function handleCopyNwcUrl() {
		// This would need the NWC URL stored somewhere accessible
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	const transactionIcon = (type: string) => {
		switch (type) {
			case 'send':
				return ArrowUpRight;
			case 'receive':
				return ArrowDownLeft;
			case 'zap':
				return Zap;
			default:
				return Wallet;
		}
	};

	const transactionColor = (type: string) => {
		switch (type) {
			case 'send':
				return 'text-destructive';
			case 'receive':
				return 'text-success';
			case 'zap':
				return 'text-warning';
			default:
				return 'text-foreground';
		}
	};
</script>

<svelte:head>
	<title>Wallet | AURA</title>
</svelte:head>

<div class="min-h-screen pb-16 md:pb-0">
	<header
		class="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur"
	>
		<div class="flex h-14 items-center justify-between px-4">
			<h1 class="text-xl font-bold">Wallet</h1>
			{#if walletStore.isConnected}
				<Button
					variant="ghost"
					size="icon"
					onclick={handleRefreshBalance}
				>
					<RefreshCw
						class="h-5 w-5 {walletStore.isLoading ? 'animate-spin'
						:	''}"
					/>
				</Button>
			{/if}
		</div>
	</header>

	<div class="mx-auto max-w-2xl p-4">
		{#if walletStore.isConnected}
			<!-- Balance card -->
			<Card class="mb-6 border-gradient">
				<CardContent class="pt-6">
					<div class="text-center">
						<p class="text-sm text-muted-foreground">
							Available Balance
						</p>
						<div
							class="mt-2 flex items-center justify-center gap-2"
						>
							<Zap class="h-8 w-8 text-warning" />
							<span class="text-4xl font-bold">
								{walletStore.formatSats(walletStore.balance)}
							</span>
						</div>
						<Badge
							variant="success"
							class="mt-2"
						>
							Connected via NWC
						</Badge>
					</div>
				</CardContent>
				<CardFooter class="flex gap-3">
					<Button
						variant="outline"
						class="flex-1"
						onclick={() => (showPayInvoice = !showPayInvoice)}
					>
						<ArrowUpRight class="h-4 w-4" />
						Send
					</Button>
					<Button
						variant="destructive"
						class="flex-1"
						onclick={handleDisconnect}
					>
						<Unlink class="h-4 w-4" />
						Disconnect
					</Button>
				</CardFooter>
			</Card>

			{#if showPayInvoice}
				<Card class="mb-6">
					<CardHeader>
						<CardTitle>Pay Lightning Invoice</CardTitle>
						<CardDescription
							>Paste a BOLT11 invoice to pay</CardDescription
						>
					</CardHeader>
					<CardContent>
						<Input
							bind:value={payInvoiceInput}
							placeholder="lnbc..."
							class="font-mono text-sm"
						/>
					</CardContent>
					<CardFooter class="flex gap-3">
						<Button
							variant="outline"
							onclick={() => (showPayInvoice = false)}
						>
							Cancel
						</Button>
						<Button
							variant="glow"
							class="flex-1"
							onclick={handlePayInvoice}
							disabled={!payInvoiceInput.trim() ||
								walletStore.isLoading}
						>
							{#if walletStore.isLoading}
								<Spinner size="sm" />
							{:else}
								Pay Invoice
							{/if}
						</Button>
					</CardFooter>
				</Card>
			{/if}

			<!-- Transactions -->
			<div class="mb-4 flex items-center justify-between">
				<h2 class="text-lg font-semibold">Recent Activity</h2>
			</div>

			{#if walletStore.transactions.length === 0}
				<Card>
					<CardContent class="py-8 text-center">
						<Zap class="mx-auto h-12 w-12 text-muted-foreground" />
						<p class="mt-4 text-muted-foreground">
							No transactions yet
						</p>
						<p class="text-sm text-muted-foreground">
							Start zapping notes to see activity here
						</p>
					</CardContent>
				</Card>
			{:else}
				<div class="space-y-2">
					{#each walletStore.transactions as tx (tx.id)}
						{@const Icon = transactionIcon(tx.type)}
						<Card>
							<CardContent class="flex items-center gap-4 py-4">
								<div
									class="rounded-full bg-muted p-2 {transactionColor(
										tx.type,
									)}"
								>
									<Icon class="h-5 w-5" />
								</div>
								<div class="flex-1">
									<p class="font-medium capitalize">
										{tx.type}
									</p>
									{#if tx.description}
										<p
											class="text-sm text-muted-foreground"
										>
											{tx.description}
										</p>
									{/if}
								</div>
								<div class="text-right">
									<p
										class="font-mono font-medium {transactionColor(
											tx.type,
										)}"
									>
										{tx.type === 'incoming' ?
											'+'
										:	'-'}{tx.amount} sats
									</p>
									<p class="text-xs text-muted-foreground">
										{formatRelativeTime(
											Math.floor(tx.timestamp / 1000),
										)}
									</p>
								</div>
							</CardContent>
						</Card>
					{/each}
				</div>
			{/if}
		{:else}
			<!-- Connect wallet -->
			<Card class="border-gradient">
				<CardHeader>
					<div
						class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10"
					>
						<Wallet class="h-8 w-8 text-primary" />
					</div>
					<CardTitle class="text-center"
						>Connect Your Wallet</CardTitle
					>
					<CardDescription class="text-center">
						Connect a Lightning wallet to send zaps and make
						payments
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if showConnect}
						<div class="space-y-4">
							<Input
								bind:value={nwcInput}
								placeholder="nostr+walletconnect://..."
								class="font-mono text-sm"
							/>
							<div class="rounded-lg bg-muted p-3 text-sm">
								<p class="font-medium">How to get NWC URL:</p>
								<ol
									class="mt-2 list-inside list-decimal space-y-1 text-muted-foreground"
								>
									<li>
										Open your Lightning wallet (Alby,
										Mutiny, etc.)
									</li>
									<li>
										Go to Settings → Nostr Wallet Connect
									</li>
									<li>Create a new connection for AURA</li>
									<li>Copy the connection string</li>
								</ol>
							</div>
						</div>
					{:else}
						<div class="space-y-3">
							<a
								href="https://getalby.com"
								target="_blank"
								rel="noopener noreferrer"
								class="flex items-center justify-between rounded-lg border border-border p-4 transition-colors hover:bg-muted"
							>
								<div class="flex items-center gap-3">
									<div
										class="flex h-10 w-10 items-center justify-center rounded-full bg-[#FFDF6F] text-black font-bold"
									>
										A
									</div>
									<div>
										<p class="font-medium">Alby</p>
										<p
											class="text-sm text-muted-foreground"
										>
											Browser extension
										</p>
									</div>
								</div>
								<ExternalLink
									class="h-4 w-4 text-muted-foreground"
								/>
							</a>

							<a
								href="https://mutinywallet.com"
								target="_blank"
								rel="noopener noreferrer"
								class="flex items-center justify-between rounded-lg border border-border p-4 transition-colors hover:bg-muted"
							>
								<div class="flex items-center gap-3">
									<div
										class="flex h-10 w-10 items-center justify-center rounded-full bg-[#E74C3C] text-white font-bold"
									>
										M
									</div>
									<div>
										<p class="font-medium">Mutiny Wallet</p>
										<p
											class="text-sm text-muted-foreground"
										>
											Self-custodial PWA
										</p>
									</div>
								</div>
								<ExternalLink
									class="h-4 w-4 text-muted-foreground"
								/>
							</a>
						</div>
					{/if}

					{#if walletStore.error}
						<p class="text-sm text-destructive">
							{walletStore.error}
						</p>
					{/if}
				</CardContent>
				<CardFooter>
					{#if showConnect}
						<div class="flex w-full gap-3">
							<Button
								variant="outline"
								onclick={() => (showConnect = false)}
							>
								Back
							</Button>
							<Button
								variant="glow"
								class="flex-1"
								onclick={handleConnect}
								disabled={!nwcInput.trim() ||
									walletStore.isLoading}
							>
								{#if walletStore.isLoading}
									<Spinner size="sm" />
								{:else}
									<Link class="h-4 w-4" />
									Connect Wallet
								{/if}
							</Button>
						</div>
					{:else}
						<Button
							variant="glow"
							class="w-full"
							onclick={() => (showConnect = true)}
						>
							<Link class="h-4 w-4" />
							Connect with NWC
						</Button>
					{/if}
				</CardFooter>
			</Card>

			<div class="mt-6 rounded-lg border border-border bg-card p-4">
				<h3 class="font-medium">What is NWC?</h3>
				<p class="mt-2 text-sm text-muted-foreground">
					Nostr Wallet Connect (NWC) is a protocol that allows AURA to
					interact with your Lightning wallet without ever having
					access to your funds. You control the spending limits and
					can revoke access anytime.
				</p>
			</div>
		{/if}
	</div>
</div>
