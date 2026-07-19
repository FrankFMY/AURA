<script lang="ts">
	import { onMount } from 'svelte';
	import { Camera, ImageUp, Link2, X } from 'lucide-svelte';
	import type QrScanner from 'qr-scanner';

	interface Props {
		onDetected: (value: string) => void | Promise<void>;
		onCancel: () => void | Promise<void>;
		onError: (message: string) => void;
	}

	let { onDetected, onCancel, onError }: Props = $props();
	let video = $state.raw<HTMLVideoElement>();
	let scanner = $state.raw<QrScanner>();
	let pasteValue = $state('');
	let cameraReady = $state(false);
	let cameraFailed = $state(false);
	let consumed = false;
	let mounted = true;

	async function deliver(value: string): Promise<void> {
		if (consumed || !mounted) return;
		const normalized = value.trim();
		if (!normalized) return;
		consumed = true;
		scanner?.stop();
		try {
			await onDetected(normalized);
		} catch {
			consumed = false;
			if (mounted && scanner) {
				try {
					await scanner.start();
					cameraReady = true;
				} catch {
					onError('Camera scanning is unavailable. Paste the link or choose a QR image.');
				}
			}
		}
	}

	onMount(() => {
		mounted = true;
		void (async () => {
			try {
				const { default: QrScannerClass } = await import('qr-scanner');
				if (!mounted || !video) return;
				scanner = new QrScannerClass(video, (result) => void deliver(result.data), {
					preferredCamera: 'environment',
					maxScansPerSecond: 10,
					highlightScanRegion: true,
					highlightCodeOutline: true,
					returnDetailedScanResult: true
				});
				await scanner.start();
				if (mounted) cameraReady = true;
			} catch {
				if (mounted) {
					cameraFailed = true;
					onError('Camera scanning is unavailable. Paste the link or choose a QR image.');
				}
			}
		})();
		return () => {
			mounted = false;
			scanner?.destroy();
			scanner = undefined;
		};
	});

	async function scanImage(event: Event): Promise<void> {
		const input = event.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (!file || consumed) return;
		try {
			const { default: QrScannerClass } = await import('qr-scanner');
			const result = await QrScannerClass.scanImage(file, { returnDetailedScanResult: true });
			await deliver(result.data);
		} catch {
			onError('No valid AURA device-link QR was found in that image.');
		}
	}
</script>

<section class="link-scanner" aria-label="Scan device link">
	<header class="link-dialog-header">
		<div>
			<p class="eyebrow">Link another device</p>
			<h2 id="device-link-title">Scan the QR on your new device</h2>
		</div>
		<button
			class="icon-button"
			data-link-autofocus
			type="button" aria-label="Close device linking" onclick={() => void onCancel()}>
			<X size={20} />
		</button>
	</header>
	<p class="muted">Keep both devices nearby. You will verify the same six-digit code before anything is transferred.</p>
	<div class="scanner-frame" class:ready={cameraReady}>
		<video bind:this={video} muted playsinline aria-label="Camera preview"></video>
		{#if cameraFailed}
			<div class="scanner-wait"><Camera size={24} /><span>Camera unavailable — use a QR image or link.</span></div>
		{:else if !cameraReady}
			<div class="scanner-wait"><Camera size={24} /><span>Starting camera…</span></div>
		{/if}
	</div>
	<div class="scanner-fallbacks">
		<label class="button secondary scanner-file">
			<ImageUp size={17} /> Choose QR image
			<input type="file" accept="image/*" onchange={(event) => void scanImage(event)} />
		</label>
		<form
			onsubmit={(event) => {
				event.preventDefault();
				void deliver(pasteValue);
			}}
		>
			<label>
				<span>Or paste the device-link URL</span>
				<textarea
					bind:value={pasteValue}
					rows="3"
					autocomplete="off"
					autocapitalize="none"
					spellcheck="false"
					placeholder="https://aura.frankfmy.com/link/#…"></textarea>
			</label>
			<button class="button secondary full" type="submit" disabled={!pasteValue.trim()}>
				<Link2 size={17} /> Check link
			</button>
		</form>
	</div>
</section>
