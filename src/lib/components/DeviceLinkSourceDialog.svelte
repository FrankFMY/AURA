<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { Check, KeyRound, ScanLine, ShieldAlert, X } from 'lucide-svelte';
	import DeviceLinkScanner from './DeviceLinkScanner.svelte';

	interface Props {
		mode: 'scan' | 'approve' | 'sent';
		verificationCode?: string;
		profileName: string;
		identityLabel: string;
		busy: boolean;
		error: string;
		onDetected: (value: string) => void | Promise<void>;
		onScannerError: (message: string) => void;
		onApprove: () => void | Promise<void>;
		onScanAgain: () => void | Promise<void>;
		onCancel: () => void | Promise<void>;
	}

	let {
		mode,
		verificationCode,
		profileName,
		identityLabel,
		busy,
		error,
		onDetected,
		onScannerError,
		onApprove,
		onScanAgain,
		onCancel
	}: Props = $props();
	let dialog = $state.raw<HTMLDivElement>();
	let previousFocus: HTMLElement | null = null;

	onMount(() => {
		previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		return () => previousFocus?.focus();
	});

	$effect(() => {
		mode;
		void tick().then(() => {
			(dialog?.querySelector<HTMLElement>('[data-link-autofocus]') ?? dialog)?.focus();
		});
	});

	function handleDialogKeydown(event: KeyboardEvent): void {
		if (event.key === 'Escape' && !busy) {
			event.preventDefault();
			void onCancel();
			return;
		}
		if (event.key !== 'Tab' || !dialog) return;
		const focusable = Array.from(
			dialog.querySelectorAll<HTMLElement>(
				'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
			)
		).filter((element) => element.offsetParent !== null);
		if (focusable.length === 0) {
			event.preventDefault();
			dialog.focus();
			return;
		}
		const first = focusable[0];
		const last = focusable.at(-1);
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last?.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
</script>

<div class="link-dialog-backdrop" role="presentation">
	<div
		bind:this={dialog}
		class="link-dialog"
		role="dialog"
		aria-modal="true"
		aria-labelledby="device-link-title"
		tabindex="-1"
		onkeydown={handleDialogKeydown}
	>
		{#if mode === 'scan'}
			<DeviceLinkScanner
				onDetected={onDetected}
				onCancel={onCancel}
				onError={onScannerError}
			/>
			{#if error}<div class="inline-error link-scanner-error" role="alert">{error}</div>{/if}
		{:else if mode === 'approve'}
			<header class="link-dialog-header">
				<div>
					<p class="eyebrow">Fresh approval required</p>
					<h2 id="device-link-title">Link this profile?</h2>
				</div>
				<button
					class="icon-button"
					data-link-autofocus
					type="button"
					aria-label="Close device linking"
					disabled={busy}
					onclick={() => void onCancel()}><X size={20} /></button
				>
			</header>
			<div class="link-profile-summary">
				<div class="profile-orb small">{profileName.slice(0, 1).toUpperCase()}</div>
				<div><strong>{profileName}</strong><p class="mono muted">{identityLabel}</p></div>
			</div>
			<div class="link-code-block">
				<span>Confirm this code is shown on the new device</span>
				<strong>{verificationCode}</strong>
			</div>
			<div class="link-warning">
				<ShieldAlert size={20} />
				<p>Approve only a device in front of you. It will receive the exact identity and access to relay history.</p>
			</div>
			{#if error}<div class="inline-error" role="alert">{error}</div>{/if}
			<div class="link-dialog-actions">
				<button class="button secondary" type="button" disabled={busy} onclick={() => void onScanAgain()}>
					<ScanLine size={17} /> Scan again
				</button>
				<button class="button primary" type="button" disabled={busy} onclick={() => void onApprove()}>
					<KeyRound size={17} /> {busy ? 'Confirm on this device…' : 'Approve with Passkey'}
				</button>
			</div>
		{:else}
			<div class="link-sent-state">
				<div class="status-icon"><Check size={24} /></div>
				<p class="eyebrow">Encrypted transfer sent</p>
				<h2 id="device-link-title">Finish on the new device</h2>
				<p class="muted">AURA sent the one-time encrypted profile transfer. It expires with the request.</p>
				<button class="button primary full" data-link-autofocus type="button" onclick={() => void onCancel()}>Done</button>
			</div>
		{/if}
	</div>
</div>
