<script lang="ts">
	import { walletStore } from '$stores/wallet.svelte';
	import { cashuStore } from '$stores/cashu.svelte';
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
	import Coins from 'lucide-svelte/icons/coins';
	import Link from 'lucide-svelte/icons/link';
	import Unlink from 'lucide-svelte/icons/unlink';
	import ArrowUpRight from 'lucide-svelte/icons/arrow-up-right';
	import ArrowDownLeft from 'lucide-svelte/icons/arrow-down-left';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import Copy from 'lucide-svelte/icons/copy';
	import Check from 'lucide-svelte/icons/check';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import Plus from 'lucide-svelte/icons/plus';
	import AlertCircle from 'lucide-svelte/icons/alert-circle';
	import { copyToClipboard } from '$lib/utils';

	// eCash state
	let showAddMint = $state(false);
	let newMintUrl = $state('');
	let showMintQuote = $state(false);
	let mintAmount = $state(1000);

	// Handle minting new eCash
	async function handleRequestMint() {
		if (mintAmount <= 0) return;
		try {
			await cashuStore.requestMint(mintAmount);
			showMintQuote = true;
		} catch (e) {
			// Error handled in store
		}
	}

	async function handleCheckMint() {
		const claimed = await cashuStore.checkAndClaimMint();
		if (claimed) {
			showMintQuote = false;
		}
	}

	async function handleAddMint() {
		if (!newMintUrl.trim()) return;
		try {
			await cashuStore.addMint(newMintUrl.trim(), false);
			newMintUrl = '';
			showAddMint = false;
		} catch (e) {
			// Error handled in store
		}
	}

	// eCash transaction icons
	const ecashTxIcon = (type: string) => {
		switch (type) {
			case 'mint':
				return ArrowDownLeft;
			case 'melt':
				return ArrowUpRight;
			case 'send':
				return ArrowUpRight;
			case 'receive':
				return ArrowDownLeft;
			default:
				return Coins;
		}
	};

	const ecashTxColor = (type: string) => {
		switch (type) {
			case 'mint':
			case 'receive':
				return 'text-green-500';
			case 'melt':
			case 'send':
				return 'text-red-500';
			default:
				return 'text-amber-500';
		}
	};

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

		<!-- eCash Section -->
		<div class="mt-8">
			<div class="mb-4 flex items-center gap-2">
				<Coins class="h-5 w-5 text-amber-500" />
				<h2 class="text-lg font-semibold">eCash (Cashu)</h2>
				<Badge variant="outline" class="text-amber-500 border-amber-500/30">Anonymous</Badge>
			</div>

			{#if cashuStore.isConnected}
				<!-- eCash Balance Card -->
				<Card class="mb-6 border-amber-500/20 bg-amber-500/5">
					<CardContent class="pt-6">
						<div class="text-center">
							<p class="text-sm text-muted-foreground">eCash Balance</p>
							<div class="mt-2 flex items-center justify-center gap-2">
								<Coins class="h-8 w-8 text-amber-500" />
								<span class="text-4xl font-bold">{cashuStore.formattedBalance}</span>
							</div>
							<p class="mt-2 text-xs text-muted-foreground">
								Private, instant, no trace
							</p>
						</div>
					</CardContent>
					<CardFooter class="flex gap-3">
						<Button
							variant="outline"
							class="flex-1"
							onclick={() => showMintQuote = !showMintQuote}
						>
							<Plus class="h-4 w-4 mr-1" />
							Mint
						</Button>
						<Button
							variant="ghost"
							size="icon"
							onclick={() => cashuStore.refreshBalance()}
						>
							<RefreshCw class="h-4 w-4 {cashuStore.isLoading ? 'animate-spin' : ''}" />
						</Button>
					</CardFooter>
				</Card>

				<!-- Mint Quote Modal -->
				{#if showMintQuote}
					<Card class="mb-6">
						<CardHeader>
							<CardTitle>Mint eCash</CardTitle>
							<CardDescription>
								Pay the Lightning invoice to receive eCash tokens
							</CardDescription>
						</CardHeader>
						<CardContent class="space-y-4">
							{#if cashuStore.pendingQuote}
								<!-- Show invoice -->
								<div class="space-y-3">
									<div class="rounded-lg bg-muted p-3">
										<p class="text-xs text-muted-foreground mb-1">Pay this invoice:</p>
										<p class="font-mono text-xs break-all">{cashuStore.pendingQuote.invoice}</p>
									</div>
									<div class="flex items-center justify-between">
										<span class="text-sm">Amount</span>
										<span class="font-medium">{cashuStore.pendingQuote.amount} sats</span>
									</div>
									<Button
										variant="outline"
										class="w-full"
										onclick={() => copyToClipboard(cashuStore.pendingQuote!.invoice)}
									>
										<Copy class="h-4 w-4 mr-2" />
										Copy Invoice
									</Button>
								</div>
							{:else}
								<!-- Enter amount -->
								<div class="space-y-2">
									<label for="mintAmount" class="text-sm font-medium">Amount (sats)</label>
									<Input
										id="mintAmount"
										type="number"
										min="1"
										value={String(mintAmount)}
										oninput={(e) => mintAmount = parseInt((e.target as HTMLInputElement).value) || 0}
										placeholder="1000"
									/>
								</div>
							{/if}

							{#if cashuStore.error}
								<div class="flex items-center gap-2 text-destructive text-sm">
									<AlertCircle class="h-4 w-4" />
									<span>{cashuStore.error}</span>
								</div>
							{/if}
						</CardContent>
						<CardFooter class="flex gap-3">
							<Button
								variant="outline"
								onclick={() => { showMintQuote = false; cashuStore.cancelMintQuote(); }}
							>
								Cancel
							</Button>
							{#if cashuStore.pendingQuote}
								<Button
									variant="default"
									class="flex-1 bg-amber-500 hover:bg-amber-600"
									onclick={handleCheckMint}
									disabled={cashuStore.isLoading}
								>
									{#if cashuStore.isLoading}
										<Spinner size="sm" />
									{:else}
										Check Payment
									{/if}
								</Button>
							{:else}
								<Button
									variant="default"
									class="flex-1 bg-amber-500 hover:bg-amber-600"
									onclick={handleRequestMint}
									disabled={cashuStore.isLoading || mintAmount <= 0}
								>
									{#if cashuStore.isLoading}
										<Spinner size="sm" />
									{:else}
										Get Invoice
									{/if}
								</Button>
							{/if}
						</CardFooter>
					</Card>
				{/if}

				<!-- Mints -->
				<div class="mb-4">
					<div class="flex items-center justify-between mb-2">
						<h3 class="font-medium">Mints</h3>
						<Button
							variant="ghost"
							size="sm"
							onclick={() => showAddMint = !showAddMint}
						>
							<Plus class="h-4 w-4 mr-1" />
							Add Mint
						</Button>
					</div>

					{#if showAddMint}
						<Card class="mb-3">
							<CardContent class="pt-4 space-y-3">
								<Input
									bind:value={newMintUrl}
									placeholder="https://mint.example.com"
									class="text-sm"
								/>
								<div class="flex gap-2">
									<Button variant="outline" size="sm" onclick={() => showAddMint = false}>
										Cancel
									</Button>
									<Button
										size="sm"
										class="bg-amber-500 hover:bg-amber-600"
										onclick={handleAddMint}
										disabled={!newMintUrl.trim()}
									>
										Add
									</Button>
								</div>
							</CardContent>
						</Card>
					{/if}

					<div class="space-y-2">
						{#each cashuStore.mints as mint (mint.url)}
							<div class="flex items-center justify-between rounded-lg border border-border p-3">
								<div class="min-w-0 flex-1">
									<p class="font-medium truncate">{mint.name || 'Unknown Mint'}</p>
									<p class="text-xs text-muted-foreground truncate">{mint.url}</p>
								</div>
								<div class="flex items-center gap-2">
									{#if cashuStore.getMintBalance(mint.url) > 0}
										<Badge variant="outline" class="text-amber-500">
											{cashuStore.formatAmount(cashuStore.getMintBalance(mint.url))}
										</Badge>
									{/if}
									{#if mint.trusted}
										<Badge variant="success" class="text-xs">Trusted</Badge>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- eCash Transactions -->
				{#if cashuStore.transactions.length > 0}
					<div class="mb-4">
						<h3 class="font-medium mb-2">eCash Activity</h3>
						<div class="space-y-2">
							{#each cashuStore.transactions.slice(0, 10) as tx (tx.id)}
								{@const Icon = ecashTxIcon(tx.type)}
								<Card>
									<CardContent class="flex items-center gap-4 py-3">
										<div class="rounded-full bg-amber-500/10 p-2 {ecashTxColor(tx.type)}">
											<Icon class="h-4 w-4" />
										</div>
										<div class="flex-1 min-w-0">
											<p class="font-medium capitalize text-sm">{tx.type}</p>
											{#if tx.memo}
												<p class="text-xs text-muted-foreground truncate">{tx.memo}</p>
											{/if}
										</div>
										<div class="text-right">
											<p class="font-mono text-sm {ecashTxColor(tx.type)}">
												{tx.type === 'receive' || tx.type === 'mint' ? '+' : '-'}{tx.amount} sats
											</p>
											<p class="text-xs text-muted-foreground">
												{formatRelativeTime(Math.floor(tx.created_at / 1000))}
											</p>
										</div>
									</CardContent>
								</Card>
							{/each}
						</div>
					</div>
				{/if}
			{:else}
				<!-- eCash Not Connected -->
				<Card class="border-amber-500/20">
					<CardHeader>
						<div class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-500/10">
							<Coins class="h-8 w-8 text-amber-500" />
						</div>
						<CardTitle class="text-center">Anonymous eCash</CardTitle>
						<CardDescription class="text-center">
							Send and receive untraceable payments using Cashu eCash tokens
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div class="rounded-lg bg-muted p-3 text-sm">
							<p class="font-medium">What is eCash?</p>
							<ul class="mt-2 space-y-1 text-muted-foreground list-disc list-inside">
								<li>Fully anonymous - no one can trace your payments</li>
								<li>Instant - no blockchain confirmations needed</li>
								<li>Send in chat - just like sending a message</li>
								<li>Backed by Bitcoin via Lightning Network</li>
							</ul>
						</div>
					</CardContent>
					<CardFooter>
						<Button
							class="w-full bg-amber-500 hover:bg-amber-600"
							onclick={() => cashuStore.init()}
							disabled={cashuStore.isLoading}
						>
							{#if cashuStore.isLoading}
								<Spinner size="sm" />
							{:else}
								<Coins class="h-4 w-4 mr-2" />
								Enable eCash
							{/if}
						</Button>
					</CardFooter>
				</Card>
			{/if}

			<!-- eCash Warning -->
			<div class="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-4">
				<div class="flex items-start gap-3">
					<AlertCircle class="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
					<div class="text-sm">
						<p class="font-medium text-amber-600 dark:text-amber-400">Important</p>
						<p class="text-muted-foreground mt-1">
							eCash tokens are stored locally on your device. If you clear browser data
							or lose access to this device, your tokens will be lost. Always keep
							small amounts.
						</p>
					</div>
				</div>
			</div>
		</div>
	</div>
</div>
