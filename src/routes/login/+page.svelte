<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$stores/auth.svelte';
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
	import { Spinner } from '$components/ui/spinner';
	import Key from 'lucide-svelte/icons/key';
	import Puzzle from 'lucide-svelte/icons/puzzle';
	import Plus from 'lucide-svelte/icons/plus';
	import AlertTriangle from 'lucide-svelte/icons/alert-triangle';
	import Copy from 'lucide-svelte/icons/copy';
	import Check from 'lucide-svelte/icons/check';
	import Eye from 'lucide-svelte/icons/eye';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import { copyToClipboard } from '$lib/utils';

	type LoginMode = 'select' | 'extension' | 'nsec' | 'generate';

	let mode = $state<LoginMode>('select');
	let nsecInput = $state('');
	let showNsec = $state(false);
	let generatedKeys = $state<{ nsec: string; npub: string } | null>(null);
	let keyCopied = $state(false);
	let seedSaved = $state(false);

	async function handleExtensionLogin() {
		mode = 'extension';
		try {
			await authStore.loginWithExtension();
			goto('/');
		} catch (e) {
			// Error is handled in authStore
			mode = 'select';
		}
	}

	async function handleNsecLogin() {
		if (!nsecInput.trim()) return;

		try {
			await authStore.loginWithPrivateKey(nsecInput);
			goto('/');
		} catch (e) {
			// Error is handled in authStore
		}
	}

	async function handleGenerateKeys() {
		try {
			generatedKeys = await authStore.generateAndLogin();
		} catch (e) {
			// Error is handled in authStore
		}
	}

	async function handleCopyNsec() {
		if (!generatedKeys) return;

		const success = await copyToClipboard(generatedKeys.nsec);
		if (success) {
			keyCopied = true;
			setTimeout(() => (keyCopied = false), 2000);
		}
	}

	function handleContinue() {
		goto('/');
	}

	const hasExtension = authStore.hasExtension();
</script>

<svelte:head>
	<title>Login | AURA</title>
</svelte:head>

<div class="flex min-h-screen items-center justify-center p-4">
	<div class="w-full max-w-md">
		<!-- Logo -->
		<div class="mb-8 text-center">
			<div
				class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-br from-primary to-accent shadow-lg shadow-primary/20"
			>
				<span class="text-3xl font-bold text-primary-foreground">A</span
				>
			</div>
			<h1 class="text-3xl font-bold text-gradient-primary">AURA</h1>
			<p class="mt-2 text-muted-foreground">
				Decentralized Social Messenger
			</p>
		</div>

		{#if mode === 'select'}
			<!-- Login options -->
			<Card class="border-gradient">
				<CardHeader>
					<CardTitle>Welcome</CardTitle>
					<CardDescription
						>Choose how you want to login</CardDescription
					>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if hasExtension}
						<Button
							variant="default"
							class="w-full justify-start gap-3"
							onclick={handleExtensionLogin}
							disabled={authStore.isLoading}
						>
							<Puzzle class="h-5 w-5" />
							Login with Browser Extension
							{#if authStore.isLoading}
								<Spinner
									size="sm"
									class="ml-auto"
								/>
							{/if}
						</Button>
					{:else}
						<Button
							variant="outline"
							class="w-full justify-start gap-3"
							disabled
						>
							<Puzzle class="h-5 w-5" />
							<span class="flex-1 text-left">
								<span class="block">Browser Extension</span>
								<span class="text-xs text-muted-foreground"
									>Not detected</span
								>
							</span>
						</Button>
					{/if}

					<Button
						variant="outline"
						class="w-full justify-start gap-3"
						onclick={() => (mode = 'nsec')}
					>
						<Key class="h-5 w-5" />
						Login with Private Key (nsec)
					</Button>

					<div class="relative">
						<div class="absolute inset-0 flex items-center">
							<span class="w-full border-t"></span>
						</div>
						<div
							class="relative flex justify-center text-xs uppercase"
						>
							<span class="bg-card px-2 text-muted-foreground"
								>or</span
							>
						</div>
					</div>

					<Button
						variant="secondary"
						class="w-full justify-start gap-3"
						onclick={() => (mode = 'generate')}
					>
						<Plus class="h-5 w-5" />
						Create New Account
					</Button>
				</CardContent>

				{#if authStore.error}
					<CardFooter>
						<p class="w-full text-center text-sm text-destructive">
							{authStore.error}
						</p>
					</CardFooter>
				{/if}
			</Card>
		{:else if mode === 'nsec'}
			<!-- Login with nsec -->
			<Card>
				<CardHeader>
					<CardTitle>Login with Private Key</CardTitle>
					<CardDescription
						>Enter your nsec or hex private key</CardDescription
					>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="relative">
						<Input
							type={showNsec ? 'text' : 'password'}
							bind:value={nsecInput}
							placeholder="nsec1... or hex key"
							class="pr-10 font-mono"
						/>
						<button
							type="button"
							class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
							onclick={() => (showNsec = !showNsec)}
						>
							{#if showNsec}
								<EyeOff class="h-4 w-4" />
							{:else}
								<Eye class="h-4 w-4" />
							{/if}
						</button>
					</div>

					<div
						class="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-warning"
					>
						<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
						<p class="text-sm">
							Your private key will not be stored. You'll need to
							enter it again if you clear your browser data.
						</p>
					</div>
				</CardContent>
				<CardFooter class="flex gap-3">
					<Button
						variant="outline"
						onclick={() => (mode = 'select')}
					>
						Back
					</Button>
					<Button
						variant="glow"
						class="flex-1"
						onclick={handleNsecLogin}
						disabled={!nsecInput.trim() || authStore.isLoading}
					>
						{#if authStore.isLoading}
							<Spinner size="sm" />
						{:else}
							Login
						{/if}
					</Button>
				</CardFooter>
			</Card>
		{:else if mode === 'generate'}
			<!-- Generate new keys -->
			<Card>
				<CardHeader>
					<CardTitle>
						{generatedKeys ? 'Save Your Keys!' : (
							'Create New Account'
						)}
					</CardTitle>
					<CardDescription>
						{generatedKeys ?
							'Write down your private key - this is the ONLY way to recover your account'
						:	'Generate a new Nostr identity'}
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if !generatedKeys}
						<div class="rounded-lg bg-muted p-4 text-sm">
							<p class="mb-2 font-medium">
								What you need to know:
							</p>
							<ul
								class="list-inside list-disc space-y-1 text-muted-foreground"
							>
								<li>
									Your private key (nsec) is your password
								</li>
								<li>
									There's no "forgot password" - lose it and
									you lose access
								</li>
								<li>Never share your nsec with anyone</li>
								<li>Your public key (npub) is your username</li>
							</ul>
						</div>
					{:else}
						<div class="space-y-4">
							<div
								class="rounded-lg border border-destructive/50 bg-destructive/10 p-4"
							>
								<p class="mb-2 font-semibold text-destructive">
									Private Key (nsec)
								</p>
								<div class="flex items-center gap-2">
									<code
										class="flex-1 break-all rounded bg-background/50 p-2 font-mono text-xs"
									>
										{showNsec ?
											generatedKeys.nsec
										:	'••••••••••••••••••••••••••••••••'}
									</code>
									<Button
										variant="ghost"
										size="icon"
										onclick={() => (showNsec = !showNsec)}
									>
										{#if showNsec}
											<EyeOff class="h-4 w-4" />
										{:else}
											<Eye class="h-4 w-4" />
										{/if}
									</Button>
								</div>
								<Button
									variant="outline"
									size="sm"
									class="mt-2 w-full"
									onclick={handleCopyNsec}
								>
									{#if keyCopied}
										<Check class="h-4 w-4" />
										Copied!
									{:else}
										<Copy class="h-4 w-4" />
										Copy Private Key
									{/if}
								</Button>
							</div>

							<div class="rounded-lg bg-muted p-4">
								<p
									class="mb-2 font-semibold text-muted-foreground"
								>
									Public Key (npub)
								</p>
								<code
									class="block break-all rounded bg-background/50 p-2 font-mono text-xs"
								>
									{generatedKeys.npub}
								</code>
							</div>

							<label class="flex items-center gap-2">
								<input
									type="checkbox"
									bind:checked={seedSaved}
									class="h-4 w-4 rounded border-border text-primary"
								/>
								<span class="text-sm">
									I have saved my private key in a safe place
								</span>
							</label>
						</div>
					{/if}
				</CardContent>
				<CardFooter class="flex gap-3">
					<Button
						variant="outline"
						onclick={() => {
							mode = 'select';
							generatedKeys = null;
							seedSaved = false;
						}}
					>
						Back
					</Button>
					{#if generatedKeys}
						<Button
							variant="glow"
							class="flex-1"
							onclick={handleContinue}
							disabled={!seedSaved}
						>
							Continue to AURA
						</Button>
					{:else}
						<Button
							variant="glow"
							class="flex-1"
							onclick={handleGenerateKeys}
							disabled={authStore.isLoading}
						>
							{#if authStore.isLoading}
								<Spinner size="sm" />
							{:else}
								Generate Keys
							{/if}
						</Button>
					{/if}
				</CardFooter>
			</Card>
		{/if}

		<!-- Footer links -->
		<p class="mt-8 text-center text-sm text-muted-foreground">
			Don't have an extension?
			<a
				href="https://getalby.com"
				target="_blank"
				rel="noopener noreferrer"
				class="text-accent hover:underline"
			>
				Get Alby
			</a>
			or
			<a
				href="https://github.com/ArcadeLabsInc/arc"
				target="_blank"
				rel="noopener noreferrer"
				class="text-accent hover:underline"
			>
				Arc
			</a>
		</p>
	</div>
</div>
