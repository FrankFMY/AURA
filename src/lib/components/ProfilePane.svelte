<script lang="ts">
	import { Copy, KeyRound, LogOut, ScanLine, ShieldCheck, Trash2 } from 'lucide-svelte';

	interface Props {
		displayName: string;
		identityLabel: string;
		copied?: 'invite' | 'pubkey';
		inviteUrl: string;
		notice: string;
		error: string;
		onBuildInvite: () => void | Promise<void>;
		onLinkDevice: () => void | Promise<void>;
		onCopyPubkey: () => void | Promise<void>;
		onCopyDiagnostics: () => void | Promise<void>;
		onLock: () => void | Promise<void>;
		onDelete: () => void | Promise<void>;
	}

	let {
		displayName,
		identityLabel,
		copied,
		inviteUrl,
		notice,
		error,
		onBuildInvite,
		onLinkDevice,
		onCopyPubkey,
		onCopyDiagnostics,
		onLock,
		onDelete
	}: Props = $props();
</script>

<section class="single-pane">
	<div class="single-content profile-content">
		<p class="eyebrow">Local identity</p>
		<div class="profile-title">
			<div class="profile-orb small">{displayName.slice(0, 1).toUpperCase()}</div>
			<div>
				<h1>{displayName}</h1>
				<p class="mono muted">{identityLabel}</p>
			</div>
		</div>
		<div class="settings-grid">
			<section class="setting-card accent">
				<ShieldCheck size={22} />
				<div>
					<strong>Recovery confirmed</strong>
					<p>Your exact identity can be restored from the saved 24 words.</p>
				</div>
			</section>
			<section class="setting-card">
				<KeyRound size={22} />
				<div>
					<strong>Device protected</strong>
					<p>The encrypted key envelope requires user verification and Passkey PRF.</p>
				</div>
			</section>
		</div>
		<div class="profile-actions">
			<button class="button primary" onclick={() => void onLinkDevice()}>
				Link another device <ScanLine size={17} />
			</button>
			<button class="button secondary" onclick={() => void onBuildInvite()}>
				{copied === 'invite' ? 'Copied invitation' : 'Copy private invitation'}
				<Copy size={17} />
			</button>
			<button class="button secondary" onclick={() => void onCopyPubkey()}>
				{copied === 'pubkey' ? 'Copied identity' : 'Copy npub'}
				<Copy size={17} />
			</button>
			<button class="button secondary" onclick={() => void onLock()}>
				Lock profile <LogOut size={17} />
			</button>
		</div>
		{#if inviteUrl}
			<label>
				<span>Latest invitation</span>
				<textarea readonly rows="3" value={inviteUrl}></textarea>
			</label>
		{/if}
		{#if notice}<div class="inline-notice">{notice}</div>{/if}
		{#if error}<div class="inline-error" role="alert">{error}</div>{/if}
		<details class="profile-support">
			<summary>Support</summary>
			<p>Copies aggregate connection and storage counts without identities or message content.</p>
			<button class="button secondary" onclick={() => void onCopyDiagnostics()}>
				Copy diagnostics <Copy size={17} />
			</button>
		</details>
		<div class="danger-zone">
			<div>
				<strong>Remove local profile</strong>
				<p>Deletes the encrypted envelope and local message database from this device.</p>
			</div>
			<button class="danger-button" onclick={() => void onDelete()}>
				<Trash2 size={17} /> Remove
			</button>
		</div>
	</div>
</section>
