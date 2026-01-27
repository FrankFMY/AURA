<script lang="ts">
	import { onMount } from 'svelte';
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { Button } from '$components/ui/button';
	import { Spinner } from '$components/ui/spinner';
	import { generateQRDataURL, createNostrURI, downloadQRImage } from '$lib/utils/qr';
	import { notificationsStore } from '$stores/notifications.svelte';
	import X from 'lucide-svelte/icons/x';
	import Download from 'lucide-svelte/icons/download';
	import Copy from 'lucide-svelte/icons/copy';
	import Share2 from 'lucide-svelte/icons/share-2';
	import QrCode from 'lucide-svelte/icons/qr-code';

	interface Props {
		npub: string;
		displayName?: string;
		open?: boolean;
		onclose?: () => void;
	}

	let { npub, displayName = 'Profile', open = false, onclose }: Props = $props();

	let qrDataURL = $state<string | null>(null);
	let isLoading = $state(true);
	let error = $state<string | null>(null);

	const nostrURI = $derived(createNostrURI(npub));

	onMount(async () => {
		await generateQR();
	});

	async function generateQR() {
		isLoading = true;
		error = null;

		try {
			qrDataURL = await generateQRDataURL(nostrURI, {
				size: 280,
				margin: 3,
				errorCorrectionLevel: 'M'
			});
		} catch (e) {
			console.error('Failed to generate QR:', e);
			error = 'Failed to generate QR code';
		} finally {
			isLoading = false;
		}
	}

	function handleDownload() {
		if (!qrDataURL) return;
		const filename = `nostr-${displayName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`;
		downloadQRImage(qrDataURL, filename);
		notificationsStore.success('QR Downloaded', 'Saved to your downloads');
	}

	async function handleCopy() {
		try {
			await navigator.clipboard.writeText(nostrURI);
			notificationsStore.success('Copied!', 'Nostr URI copied to clipboard');
		} catch (e) {
			notificationsStore.error('Copy failed', 'Could not copy to clipboard');
		}
	}

	async function handleShare() {
		try {
			if (navigator.share) {
				await navigator.share({
					title: `${displayName} on Nostr`,
					text: `Follow ${displayName} on Nostr`,
					url: nostrURI
				});
			} else {
				await handleCopy();
			}
		} catch (e) {
			if ((e as Error).name !== 'AbortError') {
				await handleCopy();
			}
		}
	}

	function handleClose() {
		onclose?.();
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			handleClose();
		}
	}
</script>

{#if open}
	<!-- Backdrop -->
	<div
		class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
		onclick={handleClose}
		onkeydown={handleKeydown}
		role="button"
		tabindex="-1"
		transition:fade={{ duration: 200 }}
	></div>

	<!-- Modal -->
	<div
		class="fixed left-1/2 top-1/2 z-50 w-full max-w-[calc(100%-2rem)] sm:max-w-sm -translate-x-1/2 -translate-y-1/2 px-2 sm:px-4"
		transition:scale={{ duration: 250, start: 0.95, easing: cubicOut }}
	>
		<div class="rounded-xl border border-border bg-background shadow-2xl">
			<!-- Header -->
			<div class="flex items-center justify-between border-b border-border p-3 sm:p-4">
				<div class="flex items-center gap-2">
					<QrCode class="h-5 w-5 text-primary" />
					<h2 class="font-semibold text-sm sm:text-base truncate">{displayName}</h2>
				</div>
				<Button
					variant="ghost"
					size="icon"
					onclick={handleClose}
					aria-label="Close"
				>
					<X class="h-4 w-4" />
				</Button>
			</div>

			<!-- QR Code -->
			<div class="flex flex-col items-center p-4 sm:p-6">
				{#if isLoading}
					<div class="flex aspect-square w-full max-w-60 sm:max-w-70 items-center justify-center">
						<Spinner size="lg" />
					</div>
				{:else if error}
					<div class="flex aspect-square w-full max-w-60 sm:max-w-70 flex-col items-center justify-center text-center">
						<p class="text-destructive mb-4">{error}</p>
						<Button variant="outline" onclick={generateQR}>
							Retry
						</Button>
					</div>
				{:else if qrDataURL}
					<div class="rounded-xl bg-white p-3 sm:p-4 shadow-inner">
						<img
							src={qrDataURL}
							alt="QR Code for {displayName}"
							class="w-full max-w-60 sm:max-w-70 aspect-square"
						/>
					</div>
				{/if}

				<!-- npub display -->
				<div class="mt-4 w-full">
					<p class="text-center text-xs text-muted-foreground break-all font-mono bg-muted/50 rounded-lg px-3 py-2">
						{npub}
					</p>
				</div>
			</div>

			<!-- Actions -->
			<div class="flex items-center justify-center gap-1.5 sm:gap-2 border-t border-border p-3 sm:p-4">
				<Button
					variant="outline"
					size="sm"
					onclick={handleCopy}
					class="gap-1.5 px-2.5 sm:px-3 sm:gap-2"
				>
					<Copy class="h-4 w-4" />
					<span class="sr-only sm:not-sr-only">Copy</span>
				</Button>
				<Button
					variant="outline"
					size="sm"
					onclick={handleDownload}
					disabled={!qrDataURL}
					class="gap-1.5 px-2.5 sm:px-3 sm:gap-2"
				>
					<Download class="h-4 w-4" />
					<span class="sr-only sm:not-sr-only">Save</span>
				</Button>
				<Button
					variant="glow"
					size="sm"
					onclick={handleShare}
					class="gap-1.5 px-2.5 sm:px-3 sm:gap-2"
				>
					<Share2 class="h-4 w-4" />
					<span class="sr-only sm:not-sr-only">Share</span>
				</Button>
			</div>
		</div>
	</div>
{/if}
