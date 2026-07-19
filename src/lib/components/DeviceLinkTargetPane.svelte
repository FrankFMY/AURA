<script lang="ts">
	import { ArrowRight, Check, Copy, KeyRound, RefreshCw, ShieldCheck, X } from 'lucide-svelte';
	import Logo from './Logo.svelte';

	interface Props {
		status: 'waiting' | 'received' | 'expired' | 'error';
		qrDataUrl: string;
		verificationCode: string;
		receivedName?: string;
		receivedIdentityLabel?: string;
		busy: boolean;
		copied: boolean;
		error: string;
		onCopyLink: () => void | Promise<void>;
		onProtect: () => void | Promise<void>;
		onRestart: () => void | Promise<void>;
		onCancel: () => void | Promise<void>;
	}

	let {
		status,
		qrDataUrl,
		verificationCode,
		receivedName,
		receivedIdentityLabel,
		busy,
		copied,
		error,
		onCopyLink,
		onProtect,
		onRestart,
		onCancel
	}: Props = $props();
</script>

<main class="link-target-stage">
	<section class="link-target-card">
		<header class="link-target-header">
			<Logo />
			<button class="icon-button" type="button" aria-label="Cancel device linking" disabled={busy} onclick={() => void onCancel()}>
				<X size={20} />
			</button>
		</header>
		{#if status === 'waiting'}
			<p class="eyebrow">Link existing profile</p>
			<h1>Scan with your trusted device</h1>
			<p class="muted">In AURA on the device that already has your profile, open Profile → Link another device.</p>
			<div class="link-qr-wrap">
				<img src={qrDataUrl} alt="One-time AURA device-link QR code" />
			</div>
			<div class="link-code-block target">
				<span>Both devices must show this code</span>
				<strong>{verificationCode}</strong>
			</div>
			<div class="link-waiting"><span></span> Waiting for encrypted approval…</div>
			<button class="button secondary full" type="button" onclick={() => void onCopyLink()}>
				<Copy size={17} /> {copied ? 'Link copied' : 'Copy link instead'}
			</button>
		{:else if status === 'received'}
			<div class="status-icon"><ShieldCheck size={24} /></div>
			<p class="eyebrow">Encrypted profile received</p>
			<h1>Protect it on this device</h1>
			<div class="link-profile-summary target">
				<div class="profile-orb small">{receivedName?.slice(0, 1).toUpperCase()}</div>
				<div><strong>{receivedName}</strong><p class="mono muted">{receivedIdentityLabel}</p></div>
			</div>
			<div class="link-code-block target">
				<span>Approved request code</span>
				<strong>{verificationCode}</strong>
			</div>
			<p class="muted">Your device will create a new local Passkey envelope. The source Passkey is not copied.</p>
			{#if error}<div class="inline-error" role="alert">{error}</div>{/if}
			<button class="button primary full" type="button" disabled={busy} onclick={() => void onProtect()}>
				<KeyRound size={18} /> {busy ? 'Waiting for your device…' : 'Continue with Passkey'}
				<ArrowRight size={18} />
			</button>
		{:else}
			<div class="status-icon danger">{status === 'expired' ? '⌛' : '!'}</div>
			<p class="eyebrow">Device link ended</p>
			<h1>{status === 'expired' ? 'This QR expired' : 'Linking could not start'}</h1>
			<p class="muted">{error || 'Create a fresh one-time request and try again.'}</p>
			<button class="button primary full" type="button" onclick={() => void onRestart()}>
				<RefreshCw size={17} /> Create a new QR
			</button>
		{/if}
		<p class="fine-print"><Check size={14} /> One use · five minutes · no Recovery Code</p>
	</section>
</main>
