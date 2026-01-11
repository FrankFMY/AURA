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
	import {
		generateNostrMnemonic,
		getVerificationIndices,
		verifyWords,
		recoverFromMnemonic,
		type GeneratedKeys,
	} from '$lib/services/crypto/mnemonic';
	import Key from 'lucide-svelte/icons/key';
	import Puzzle from 'lucide-svelte/icons/puzzle';
	import Plus from 'lucide-svelte/icons/plus';
	import AlertTriangle from 'lucide-svelte/icons/alert-triangle';
	import Copy from 'lucide-svelte/icons/copy';
	import Check from 'lucide-svelte/icons/check';
	import Eye from 'lucide-svelte/icons/eye';
	import EyeOff from 'lucide-svelte/icons/eye-off';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Shield from 'lucide-svelte/icons/shield';
	import Sparkles from 'lucide-svelte/icons/sparkles';
	import { copyToClipboard } from '$lib/utils';

	type LoginMode =
		| 'select'
		| 'extension'
		| 'nsec'
		| 'generate'
		| 'show-words'
		| 'verify-words'
		| 'success';

	let mode = $state<LoginMode>('select');
	let nsecInput = $state('');
	let showNsec = $state(false);
	let generatedKeys = $state<GeneratedKeys | null>(null);
	let keyCopied = $state(false);

	// Seed phrase wizard state
	let currentWordIndex = $state(0);
	let wordsConfirmed = $state(false);
	let verificationIndices = $state<number[]>([]);
	let verificationInputs = $state<string[]>(['', '', '']);
	let verificationError = $state(false);

	async function handleExtensionLogin() {
		mode = 'extension';
		try {
			await authStore.loginWithExtension();
			goto('/');
		} catch (e) {
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

	function handleGenerateKeys() {
		generatedKeys = generateNostrMnemonic();
		currentWordIndex = 0;
		wordsConfirmed = false;
		mode = 'show-words';
	}

	function handleNextWord() {
		if (currentWordIndex < 11) {
			currentWordIndex++;
		} else {
			wordsConfirmed = true;
		}
	}

	function handlePrevWord() {
		if (currentWordIndex > 0) {
			currentWordIndex--;
		}
	}

	function handleConfirmWords() {
		if (!generatedKeys) return;
		verificationIndices = getVerificationIndices();
		verificationInputs = ['', '', ''];
		verificationError = false;
		mode = 'verify-words';
	}

	async function handleVerifyWords() {
		if (!generatedKeys) return;

		const isValid = verifyWords(
			generatedKeys.words,
			verificationIndices,
			verificationInputs,
		);

		if (isValid) {
			verificationError = false;
			// Login with the generated key
			try {
				await authStore.loginWithPrivateKey(
					generatedKeys.privateKeyHex,
				);
				mode = 'success';
			} catch (e) {
				// Error handled in authStore
			}
		} else {
			verificationError = true;
		}
	}

	async function handleCopyAll() {
		if (!generatedKeys) return;

		const text = `AURA Recovery Phrase (KEEP SECRET!)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${generatedKeys.words.map((w, i) => `${i + 1}. ${w}`).join('\n')}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Public Key (npub): ${generatedKeys.npub}

⚠️ Never share your recovery phrase with anyone!`;

		const success = await copyToClipboard(text);
		if (success) {
			keyCopied = true;
			setTimeout(() => (keyCopied = false), 2000);
		}
	}

	function handleContinue() {
		goto('/');
	}

	function resetToSelect() {
		mode = 'select';
		generatedKeys = null;
		currentWordIndex = 0;
		wordsConfirmed = false;
		verificationInputs = ['', '', ''];
		verificationError = false;
	}

	const hasExtension = authStore.hasExtension();
	const progress = $derived(((currentWordIndex + 1) / 12) * 100);
</script>

<svelte:head>
	<title>Login | AURA</title>
</svelte:head>

<div
	class="flex min-h-screen items-center justify-center p-4 bg-linear-to-br from-background via-background to-primary/5"
>
	<div class="w-full max-w-md">
		<!-- Logo -->
		<div class="mb-8 text-center">
			<div
				class="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-linear-to-br from-primary to-accent shadow-lg shadow-primary/20 animate-pulse-slow"
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
						variant="glow"
						class="w-full justify-start gap-3"
						onclick={handleGenerateKeys}
					>
						<Plus class="h-5 w-5" />
						Create New Account
						<Sparkles class="ml-auto h-4 w-4" />
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
						>Enter your nsec, hex key, or recovery phrase</CardDescription
					>
				</CardHeader>
				<CardContent class="space-y-4">
					<div class="relative">
						<Input
							type={showNsec ? 'text' : 'password'}
							bind:value={nsecInput}
							placeholder="nsec1... or hex key or 12 words"
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
						onclick={resetToSelect}
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
		{:else if mode === 'show-words'}
			<!-- Seed phrase display - one word at a time -->
			<Card>
				<CardHeader class="text-center">
					<CardTitle>Your Recovery Phrase</CardTitle>
					<CardDescription>
						Write down each word in order. This is the ONLY way to
						recover your account.
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-6">
					<!-- Progress bar -->
					<div class="space-y-2">
						<div
							class="flex justify-between text-xs text-muted-foreground"
						>
							<span>Word {currentWordIndex + 1} of 12</span>
							<span>{Math.round(progress)}%</span>
						</div>
						<div class="h-2 rounded-full bg-muted overflow-hidden">
							<div
								class="h-full bg-primary transition-all duration-300"
								style="width: {progress}%"
							></div>
						</div>
					</div>

					<!-- Current word display -->
					{#if generatedKeys}
						<div
							class="relative rounded-xl bg-linear-to-br from-primary/10 to-accent/10 p-8 text-center border border-primary/20"
						>
							<span
								class="absolute top-2 left-3 text-xs font-mono text-muted-foreground"
							>
								#{currentWordIndex + 1}
							</span>
							<p
								class="text-4xl font-bold tracking-wider animate-fade-in"
							>
								{generatedKeys.words[currentWordIndex]}
							</p>
						</div>
					{/if}

					<!-- Navigation -->
					<div class="flex items-center justify-between gap-4">
						<Button
							variant="outline"
							size="icon"
							onclick={handlePrevWord}
							disabled={currentWordIndex === 0}
						>
							<ChevronLeft class="h-5 w-5" />
						</Button>

						<div class="flex gap-1">
							{#each Array(12) as _, i}
								<div
									class="h-2 w-2 rounded-full transition-colors {(
										i <= currentWordIndex
									) ?
										'bg-primary'
									:	'bg-muted'}"
								></div>
							{/each}
						</div>

						<Button
							variant="outline"
							size="icon"
							onclick={handleNextWord}
							disabled={currentWordIndex === 11 && wordsConfirmed}
						>
							<ChevronRight class="h-5 w-5" />
						</Button>
					</div>

					<!-- Copy all button -->
					<Button
						variant="outline"
						class="w-full"
						onclick={handleCopyAll}
					>
						{#if keyCopied}
							<Check class="mr-2 h-4 w-4" />
							Copied!
						{:else}
							<Copy class="mr-2 h-4 w-4" />
							Copy All Words
						{/if}
					</Button>
				</CardContent>
				<CardFooter class="flex gap-3">
					<Button
						variant="outline"
						onclick={resetToSelect}
					>
						Back
					</Button>
					<Button
						variant="glow"
						class="flex-1"
						onclick={handleConfirmWords}
						disabled={currentWordIndex < 11}
					>
						{#if currentWordIndex < 11}
							View All Words First
						{:else}
							I've Written Them Down
						{/if}
					</Button>
				</CardFooter>
			</Card>
		{:else if mode === 'verify-words'}
			<!-- Verify words -->
			<Card>
				<CardHeader class="text-center">
					<CardTitle>Verify Your Phrase</CardTitle>
					<CardDescription>
						Enter the words at these positions to confirm you saved
						them
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if verificationError}
						<div
							class="rounded-lg bg-destructive/10 p-3 text-center text-destructive"
						>
							<AlertTriangle class="mx-auto mb-2 h-5 w-5" />
							<p class="text-sm font-medium">
								Incorrect words. Please try again.
							</p>
						</div>
					{/if}

					{#each verificationIndices as wordIndex, i}
						<div class="space-y-2">
							<label
								for="verify-{i}"
								class="text-sm font-medium flex items-center gap-2"
							>
								<span
									class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground"
								>
									{wordIndex + 1}
								</span>
								Word #{wordIndex + 1}
							</label>
							<Input
								id="verify-{i}"
								type="text"
								bind:value={verificationInputs[i]}
								placeholder="Enter word #{wordIndex + 1}"
								class="font-mono lowercase"
								autocomplete="off"
								autocapitalize="off"
							/>
						</div>
					{/each}

					<div
						class="flex items-start gap-2 rounded-lg bg-muted p-3 text-muted-foreground"
					>
						<Shield class="mt-0.5 h-4 w-4 shrink-0" />
						<p class="text-xs">
							This verification ensures you've saved your recovery
							phrase correctly. Without it, you cannot recover
							your account.
						</p>
					</div>
				</CardContent>
				<CardFooter class="flex gap-3">
					<Button
						variant="outline"
						onclick={() => (mode = 'show-words')}
					>
						Back
					</Button>
					<Button
						variant="glow"
						class="flex-1"
						onclick={handleVerifyWords}
						disabled={verificationInputs.some((v) => !v.trim()) ||
							authStore.isLoading}
					>
						{#if authStore.isLoading}
							<Spinner size="sm" />
						{:else}
							Verify & Continue
						{/if}
					</Button>
				</CardFooter>
			</Card>
		{:else if mode === 'success'}
			<!-- Success -->
			<Card>
				<CardHeader class="text-center">
					<div
						class="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-success/10"
					>
						<Check class="h-8 w-8 text-success" />
					</div>
					<CardTitle class="text-success">Account Created!</CardTitle>
					<CardDescription>
						Your Nostr identity is ready
					</CardDescription>
				</CardHeader>
				<CardContent class="space-y-4">
					{#if generatedKeys}
						<div class="rounded-lg bg-muted p-4 text-center">
							<p class="text-xs text-muted-foreground mb-1">
								Your Public Key
							</p>
							<p class="font-mono text-sm break-all">
								{generatedKeys.npub}
							</p>
						</div>
					{/if}

					<div
						class="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-warning"
					>
						<AlertTriangle class="mt-0.5 h-4 w-4 shrink-0" />
						<p class="text-sm">
							Remember: Your recovery phrase is the ONLY way to
							access your account. Keep it safe and never share
							it!
						</p>
					</div>
				</CardContent>
				<CardFooter>
					<Button
						variant="glow"
						class="w-full"
						onclick={handleContinue}
					>
						<Sparkles class="mr-2 h-4 w-4" />
						Enter AURA
					</Button>
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
		</p>
	</div>
</div>

<style>
	@keyframes fade-in {
		from {
			opacity: 0;
			transform: translateY(10px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.animate-fade-in {
		animation: fade-in 0.3s ease-out;
	}

	@keyframes pulse-slow {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.8;
		}
	}

	.animate-pulse-slow {
		animation: pulse-slow 3s ease-in-out infinite;
	}
</style>
