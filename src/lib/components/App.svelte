<script lang="ts">
	import { onMount } from 'svelte';
	import {
		ArrowRight,
		Check,
		ChevronLeft,
		Copy,
		KeyRound,
		LockKeyhole,
		LogOut,
		MessageCircle,
		Plus,
		Send,
		ShieldCheck,
		SquarePen,
		Trash2,
		UserRound,
		Wifi,
		WifiOff
	} from 'lucide-svelte';
	import { nip19 } from 'nostr-tools';
	import Logo from './Logo.svelte';
	import {
		createPersistentAccount,
		restorePersistentAccount,
		unlockPersistentAccount,
		type BootstrappedAccount
	} from '$lib/app/account-service';
	import {
		createInviteToken,
		generateInviteNonce,
		parseAndVerifyInviteUrl,
		type InvitePayload
	} from '$lib/core/invite';
	import { hasPlatformWebAuthn } from '$lib/custody/webauthn-prf';
	import { secretKeyToRecoveryWords } from '$lib/custody/recovery';
	import type { UnlockedSession } from '$lib/custody/session';
	import { parseNostrPubkey } from '$lib/nostr/identity';
	import { MessengerRuntime, type HydratedMessage } from '$lib/nostr/messenger-runtime';
	import { createNostrPool } from '$lib/nostr/relay-client';
	import { AccountDatabase, type MessageRecord } from '$lib/storage/account-database';
	import {
		AccountRegistry,
		confirmRecoveryCode,
		getActiveAccount,
		removeAccount,
		setActiveAccount,
		type RegisteredAccount
	} from '$lib/storage/account-registry';

	type Phase =
		| 'loading'
		| 'welcome'
		| 'invite'
		| 'invite-error'
		| 'create'
		| 'restore'
		| 'recovery'
		| 'unlock'
		| 'app';
	type View = 'chats' | 'new-chat' | 'profile';
	type ConnectionState = 'connecting' | 'online' | 'offline';

	const LOOKUP_RELAYS = ['wss://relay.damus.io/', 'wss://nos.lol/', 'wss://relay.primal.net/'];
	const DM_RELAYS = ['wss://relay.damus.io/', 'wss://nos.lol/'];
	const RECOVERY_CHECKS = [3, 11, 20];

	let phase = $state<Phase>('loading');
	let view = $state<View>('chats');
	let registry = $state.raw(new AccountRegistry());
	let account = $state.raw<RegisteredAccount>();
	let pending = $state.raw<BootstrappedAccount>();
	let session = $state.raw<UnlockedSession>();
	let database = $state.raw<AccountDatabase>();
	let runtime = $state.raw<MessengerRuntime>();
	let pool = $state.raw<ReturnType<typeof createNostrPool>>();
	let connection = $state<ConnectionState>('offline');
	let displayName = $state('');
	let recoveryInput = $state('');
	let recoveryWords = $state('');
	let recoveryAnswers = $state(['', '', '']);
	let busy = $state(false);
	let error = $state('');
	let notice = $state('');
	let contactInput = $state('');
	let activeConversation = $state('');
	let messages = $state<HydratedMessage[]>([]);
	let chats = $state<{ pubkey: string; lastAt: number; unread: number }[]>([]);
	let composer = $state('');
	let invite = $state.raw<InvitePayload>();
	let inviteError = $state('');
	let inviteUrl = $state('');
	let copied = $state(false);
	let poll: ReturnType<typeof setInterval> | undefined;
	let reconciling = false;

	const hex = (bytes: Uint8Array) =>
		Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	const shortKey = (pubkey: string) => {
		try {
			const npub = nip19.npubEncode(pubkey);
			return `${npub.slice(0, 10)}…${npub.slice(-6)}`;
		} catch {
			return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
		}
	};
	const inviteName = (payload: InvitePayload) => payload.display?.name?.trim() || 'Someone';
	const stateLabel = (state: MessageRecord['state']) => {
		switch (state) {
			case 'network_accepted':
				return 'Sent';
			case 'recipient_confirmed':
				return 'Confirmed';
			case 'retry_wait':
				return 'Retrying';
			case 'network_rejected':
			case 'permanent_failure':
				return 'Not sent';
			case 'received':
				return 'Received';
			case 'restored':
				return 'Restored';
			default:
				return 'Preparing';
		}
	};

	async function reconcileAndRefresh() {
		if (phase !== 'app' || !runtime || reconciling) return;
		reconciling = true;
		try {
			await runtime.reconcileOutbox();
			await refreshData();
		} catch (cause) {
			connection = 'offline';
			notice = friendlyError(cause, 'Queued messages will retry when relays are available.');
		} finally {
			reconciling = false;
		}
	}

	onMount(() => {
		void initialize();
		poll = setInterval(() => {
			if (phase === 'app') void refreshData();
		}, 2_500);
		const onOnline = () => void reconcileAndRefresh();
		window.addEventListener('online', onOnline);
		return () => {
			if (poll) clearInterval(poll);
			window.removeEventListener('online', onOnline);
			runtime?.stop();
			pool?.destroy();
			session?.lock();
			registry?.close();
			database?.close();
		};
	});

	async function initialize() {
		parseInvite();
		account = await getActiveAccount(registry);
		if (!account) {
			account = await registry.accounts.orderBy('updatedAt').last();
			if (account) await setActiveAccount(registry, account.pubkey);
		}
		if (account) {
			phase = 'unlock';
			return;
		}
		phase = invite ? 'invite' : inviteError ? 'invite-error' : 'welcome';
	}

	function parseInvite() {
		if (location.pathname !== '/i' && location.pathname !== '/i/') return;
		try {
			invite = parseAndVerifyInviteUrl(location.href, {
				expectedOrigin: location.origin,
				now: Math.floor(Date.now() / 1000)
			}).payload;
		} catch (cause) {
			inviteError = cause instanceof Error ? cause.message : 'This invitation is invalid.';
		}
	}

	function clearFeedback() {
		error = '';
		notice = '';
	}

	async function createAccount() {
		clearFeedback();
		if (!displayName.trim()) {
			error = 'Enter the name people should see.';
			return;
		}
		busy = true;
		try {
			if (!(await hasPlatformWebAuthn())) {
				throw new Error('This browser cannot create a user-verified device credential.');
			}
			pending = await createPersistentAccount({
				registry,
				displayName: displayName.trim().normalize('NFC'),
				origin: location.origin,
				rpId: location.hostname,
				dmRelays: DM_RELAYS
			});
			recoveryWords = pending.recoveryWords;
			recoveryAnswers = ['', '', ''];
			phase = 'recovery';
		} catch (cause) {
			error = friendlyError(cause, 'A secure profile could not be created.');
		} finally {
			busy = false;
		}
	}

	async function restoreAccount() {
		clearFeedback();
		if (!displayName.trim()) {
			error = 'Enter the name people should see.';
			return;
		}
		busy = true;
		try {
			pending = await restorePersistentAccount({
				registry,
				displayName: displayName.trim().normalize('NFC'),
				recoveryWords: recoveryInput,
				origin: location.origin,
				rpId: location.hostname,
				dmRelays: DM_RELAYS
			});
			recoveryInput = '';
			await confirmRecoveryCode(registry, pending.account.pubkey, Date.now());
			await setActiveAccount(registry, pending.account.pubkey);
			account = await registry.accounts.get(pending.account.pubkey);
			if (!account) throw new Error('Restored account was not persisted.');
			await activate(pending.session);
			pending = undefined;
		} catch (cause) {
			error = friendlyError(cause, 'The Recovery Code could not be restored.');
		} finally {
			busy = false;
		}
	}

	async function confirmRecovery() {
		if (!pending) return;
		clearFeedback();
		const words = recoveryWords.split(' ');
		const valid = RECOVERY_CHECKS.every(
			(index, answerIndex) => recoveryAnswers[answerIndex].trim().toLowerCase() === words[index]
		);
		if (!valid) {
			error = 'Those words do not match. Check your saved Recovery Code.';
			return;
		}
		busy = true;
		try {
			await confirmRecoveryCode(registry, pending.account.pubkey, Date.now());
			await setActiveAccount(registry, pending.account.pubkey);
			account = await registry.accounts.get(pending.account.pubkey);
			if (!account) throw new Error('Account confirmation was not persisted.');
			const pendingSession = pending.session;
			pending = undefined;
			recoveryWords = '';
			recoveryAnswers = ['', '', ''];
			await activate(pendingSession);
		} catch (cause) {
			error = friendlyError(cause, 'Recovery confirmation failed.');
		} finally {
			busy = false;
		}
	}

	async function unlock() {
		if (!account) return;
		clearFeedback();
		busy = true;
		try {
			const unlocked = await unlockPersistentAccount({
				account,
				origin: location.origin,
				rpId: location.hostname
			});
			await activate(unlocked);
		} catch (cause) {
			error = friendlyError(cause, 'This profile could not be unlocked.');
		} finally {
			busy = false;
		}
	}

	async function activate(unlocked: UnlockedSession) {
		if (!account) throw new Error('No account is selected.');
		session = unlocked;
		if (!account.recoveryConfirmed) {
			recoveryWords = unlocked.withSecretKey((secretKey) => secretKeyToRecoveryWords(secretKey));
			pending = { account, session: unlocked, recoveryWords };
			phase = 'recovery';
			return;
		}
		database?.close();
		database = new AccountDatabase(account.pubkey);
		pool?.destroy();
		pool = createNostrPool();
		runtime = new MessengerRuntime({
			session,
			database,
			pool,
			lookupRelays: LOOKUP_RELAYS,
			accountDmRelays: account.dmRelays,
			recoveryConfirmed: account.recoveryConfirmed,
			onTransportError: (cause) => {
				connection = 'offline';
				notice = friendlyError(cause, 'A relay connection closed.');
			}
		});
		connection = 'connecting';
		await runtime.start();
		phase = 'app';
		view = 'chats';
		if (invite) activeConversation = invite.issuer_pubkey;
		await refreshData();
		void runtime
			.publishOwnRelayList()
			.then(() => {
				connection = 'online';
			})
			.catch((cause) => {
				connection = 'offline';
				notice = friendlyError(cause, 'Private relays are temporarily unavailable.');
			});
	}

	async function refreshData() {
		if (!database || !runtime) return;
		const records = await database.messages.toArray();
		const latest = new Map<string, number>();
		for (const record of records) {
			latest.set(
				record.conversationPubkey,
				Math.max(latest.get(record.conversationPubkey) ?? 0, record.createdAt)
			);
		}
		chats = [...latest]
			.map(([pubkey, lastAt]) => ({ pubkey, lastAt, unread: 0 }))
			.sort((a, b) => b.lastAt - a.lastAt);
		if (activeConversation) messages = await runtime.readConversation(activeConversation);
	}

	function openNewChat() {
		clearFeedback();
		contactInput = invite?.issuer_pubkey ?? '';
		view = 'new-chat';
	}

	async function beginChat() {
		clearFeedback();
		try {
			const pubkey = parseNostrPubkey(contactInput);
			if (pubkey === account?.pubkey)
				throw new Error('Choose another person, not your own identity.');
			activeConversation = pubkey;
			view = 'chats';
			messages = (await runtime?.readConversation(pubkey)) ?? [];
		} catch (cause) {
			error = friendlyError(cause, 'That contact identifier is invalid.');
		}
	}

	async function sendMessage() {
		if (!runtime || !activeConversation || !composer.trim()) return;
		clearFeedback();
		busy = true;
		const content = composer.trim();
		try {
			await runtime.send(activeConversation, content);
			composer = '';
			await refreshData();
		} catch (cause) {
			const message = cause instanceof Error ? cause.message : '';
			error = /recipient_not_dm_ready/u.test(message)
				? 'This person has not published a private-message relay list yet. Nothing was sent.'
				: friendlyError(cause, 'The message was not sent.');
		} finally {
			busy = false;
		}
	}

	async function buildInvite() {
		if (!session || !account) return;
		const currentSession = session;
		const currentAccount = account;
		clearFeedback();
		try {
			const issuedAt = Math.floor(Date.now() / 1000);
			const token = currentSession.withSecretKey((secretKey) =>
				createInviteToken(
					{
						v: 1,
						action: 'dm',
						origin: location.origin,
						issuer_pubkey: currentAccount.pubkey,
						display: { name: currentAccount.displayName },
						relay_hints: currentAccount.dmRelays,
						issued_at: issuedAt,
						expires_at: issuedAt + 7 * 24 * 60 * 60,
						nonce: generateInviteNonce()
					},
					hex(secretKey)
				)
			);
			inviteUrl = `${location.origin}/i/#${token}`;
			await navigator.clipboard.writeText(inviteUrl);
			copied = true;
			setTimeout(() => (copied = false), 1_800);
		} catch (cause) {
			error = friendlyError(cause, 'The invitation could not be copied.');
		}
	}

	async function copyPubkey() {
		if (!account) return;
		await navigator.clipboard.writeText(nip19.npubEncode(account.pubkey));
		copied = true;
		setTimeout(() => (copied = false), 1_800);
	}

	function lock() {
		runtime?.stop();
		pool?.destroy();
		pool = undefined;
		database?.close();
		database = undefined;
		session?.lock();
		session = undefined;
		runtime = undefined;
		messages = [];
		phase = 'unlock';
		connection = 'offline';
	}

	async function deleteCurrentAccount() {
		if (!account) return;
		if (!window.confirm('Remove this profile and its local message history from this device?'))
			return;
		const pubkey = account.pubkey;
		lock();
		await removeAccount(registry, pubkey);
		account = undefined;
		invite = undefined;
		phase = 'welcome';
	}

	function friendlyError(cause: unknown, fallback: string) {
		if (!(cause instanceof Error)) return fallback;
		if (/cancel|notallowederror/iu.test(cause.message))
			return 'The device confirmation was cancelled.';
		if (/PRF/iu.test(cause.message))
			return 'This browser or passkey does not support the secure PRF operation AURA requires.';
		return cause.message || fallback;
	}
</script>

<svelte:head>
	<title>AURA — private conversations</title>
	<meta name="description" content="A quiet, private messenger with user-owned identity." />
	<meta name="theme-color" content="#111412" />
</svelte:head>

{#if phase === 'loading'}
	<main class="center-stage" aria-busy="true">
		<Logo size="large" />
		<div class="loading-line"><span></span></div>
		<p class="muted">Preparing your private space…</p>
	</main>
{:else if phase === 'welcome' || phase === 'invite' || phase === 'invite-error'}
	<main class="landing">
		<section class="landing-copy">
			<Logo size="large" />
			<p class="eyebrow">Private conversations, without an account provider</p>
			<h1>Your people.<br /><em>Your identity.</em></h1>
			<p class="lede">
				AURA is a calm, direct messenger. Your identity stays on your device and your messages
				travel as private encrypted events.
			</p>
			<div class="trust-row" aria-label="Security properties">
				<span><ShieldCheck size={17} /> End-to-end encrypted</span>
				<span><KeyRound size={17} /> Recovery you control</span>
			</div>
		</section>
		<section class="entry-card">
			{#if phase === 'invite' && invite}
				<div class="invite-avatar">{inviteName(invite).slice(0, 1).toUpperCase()}</div>
				<p class="eyebrow">Private invitation</p>
				<h2>{inviteName(invite)} wants to talk</h2>
				<p class="muted">
					The invitation is signed by <span class="mono">{shortKey(invite.issuer_pubkey)}</span>.
				</p>
			{:else if phase === 'invite-error'}
				<div class="status-icon danger"><WifiOff size={22} /></div>
				<h2>This invitation cannot be opened</h2>
				<p class="muted">{inviteError}</p>
			{:else}
				<p class="eyebrow">Start quietly</p>
				<h2>Your private space is ready</h2>
				<p class="muted">
					Create a protected identity with your device, or restore one with your 24-word Recovery
					Code.
				</p>
			{/if}
			<div class="stack-actions">
				<button
					class="button primary"
					onclick={() => {
						phase = 'create';
						error = '';
					}}
				>
					Create secure profile <ArrowRight size={18} />
				</button>
				<button
					class="button secondary"
					onclick={() => {
						phase = 'restore';
						error = '';
					}}
				>
					I have a Recovery Code
				</button>
			</div>
			<p class="fine-print">
				AURA never uploads a raw private key. Persistent profiles require a user-verified Passkey
				with PRF support.
			</p>
		</section>
	</main>
{:else if phase === 'create' || phase === 'restore'}
	<main class="form-stage">
		<section class="form-card">
			<button
				class="back-button"
				aria-label="Go back"
				onclick={() => {
					phase = invite ? 'invite' : 'welcome';
					error = '';
				}}><ChevronLeft size={20} /></button
			>
			<Logo />
			<p class="eyebrow">{phase === 'create' ? 'New private identity' : 'Restore identity'}</p>
			<h1>{phase === 'create' ? 'How should people know you?' : 'Bring your identity back'}</h1>
			<p class="muted">
				{phase === 'create'
					? 'This name is included in invitations. You can change your profile later.'
					: 'Your 24 words restore the exact same Nostr identity — no seed derivation or replacement key.'}
			</p>
			<label>
				<span>Display name</span>
				<input
					bind:value={displayName}
					maxlength="80"
					autocomplete="name"
					placeholder="Your name"
				/>
			</label>
			{#if phase === 'restore'}
				<label>
					<span>24-word Recovery Code</span>
					<textarea
						bind:value={recoveryInput}
						rows="5"
						autocomplete="off"
						autocapitalize="none"
						spellcheck="false"
						placeholder="word 1  word 2  …  word 24"></textarea>
				</label>
			{/if}
			{#if error}<div class="inline-error" role="alert">{error}</div>{/if}
			<button
				class="button primary full"
				disabled={busy}
				onclick={phase === 'create' ? createAccount : restoreAccount}
			>
				{busy
					? 'Waiting for your device…'
					: phase === 'create'
						? 'Continue with Passkey'
						: 'Restore with Passkey'}
				<ArrowRight size={18} />
			</button>
			<p class="fine-print">
				<LockKeyhole size={14} /> Your device will ask for Face ID, fingerprint, or screen lock.
			</p>
		</section>
	</main>
{:else if phase === 'recovery' && pending}
	<main class="recovery-stage">
		<section class="recovery-card">
			<div class="status-icon"><ShieldCheck size={24} /></div>
			<p class="eyebrow">One important minute</p>
			<h1>Save your Recovery Code</h1>
			<p class="lede small">
				These 24 words are the only portable copy of your identity. AURA cannot recover them for
				you.
			</p>
			<ol class="word-grid">
				{#each recoveryWords.split(' ') as word, index}
					<li><span>{index + 1}</span>{word}</li>
				{/each}
			</ol>
			<div class="recovery-check">
				<p>Confirm three words from your saved copy:</p>
				<div class="check-grid">
					{#each RECOVERY_CHECKS as wordIndex, answerIndex}
						<label
							><span>Word {wordIndex + 1}</span><input
								bind:value={recoveryAnswers[answerIndex]}
								autocomplete="off"
								autocapitalize="none"
								spellcheck="false"
							/></label
						>
					{/each}
				</div>
			</div>
			{#if error}<div class="inline-error" role="alert">{error}</div>{/if}
			<button class="button primary full" disabled={busy} onclick={confirmRecovery}
				>I saved it safely <Check size={18} /></button
			>
			<p class="fine-print">Do not screenshot or paste these words into cloud notes.</p>
		</section>
	</main>
{:else if phase === 'unlock' && account}
	<main class="unlock-stage">
		<section class="unlock-card">
			<Logo size="large" />
			<div class="profile-orb">{account.displayName.slice(0, 1).toUpperCase()}</div>
			<p class="eyebrow">Welcome back</p>
			<h1>{account.displayName}</h1>
			<p class="mono muted">{shortKey(account.pubkey)}</p>
			{#if error}<div class="inline-error" role="alert">{error}</div>{/if}
			<button class="button primary full" disabled={busy} onclick={unlock}
				><LockKeyhole size={18} /> {busy ? 'Confirming…' : 'Unlock with device'}</button
			>
			<button
				class="text-button"
				onclick={() => {
					phase = 'restore';
					displayName = account?.displayName ?? '';
					error = '';
				}}>Restore a different identity</button
			>
		</section>
	</main>
{:else if phase === 'app' && account}
	<main class="app-shell">
		<aside class="rail">
			<div class="rail-logo"><Logo compact /></div>
			<nav aria-label="Primary navigation">
				<button
					class:active={view === 'chats'}
					onclick={() => {
						view = 'chats';
						error = '';
					}}
					aria-label="Chats"><MessageCircle size={21} /></button
				>
				<button class:active={view === 'new-chat'} onclick={openNewChat} aria-label="New chat"
					><SquarePen size={21} /></button
				>
			</nav>
			<button
				class:active={view === 'profile'}
				onclick={() => {
					view = 'profile';
					error = '';
				}}
				aria-label="Profile"><UserRound size={21} /></button
			>
		</aside>

		{#if view === 'chats'}
			<section class="chat-list-pane" class:hidden-mobile={Boolean(activeConversation)}>
				<header class="pane-header">
					<div>
						<p class="eyebrow">AURA</p>
						<h1>Chats</h1>
					</div>
					<button class="icon-button" aria-label="New chat" onclick={openNewChat}
						><Plus size={20} /></button
					>
				</header>
				<div class="connection-pill" class:offline={connection === 'offline'}>
					{#if connection === 'online'}<Wifi size={14} /> Private relays connected{:else if connection === 'connecting'}<span
							class="pulse"
						></span> Connecting private relays{:else}<WifiOff size={14} /> Working offline{/if}
				</div>
				{#if chats.length === 0}
					<div class="empty-list">
						<div class="quiet-orbit"><MessageCircle size={24} /></div>
						<h2>Your quiet inbox</h2>
						<p>Start with an <span>npub</span> or open a signed invitation.</p>
						<button class="button secondary" onclick={openNewChat}>Start a conversation</button>
					</div>
				{:else}
					<div class="chat-items">
						{#each chats as chat}
							<button
								class="chat-item"
								class:active={activeConversation === chat.pubkey}
								onclick={() => {
									activeConversation = chat.pubkey;
									void refreshData();
								}}
							>
								<span class="avatar">{chat.pubkey.slice(0, 2).toUpperCase()}</span>
								<span class="chat-meta"
									><strong
										>{invite?.issuer_pubkey === chat.pubkey
											? inviteName(invite)
											: shortKey(chat.pubkey)}</strong
									><small>Private conversation</small></span
								>
								<time
									>{new Date(chat.lastAt * 1000).toLocaleDateString([], {
										month: 'short',
										day: 'numeric'
									})}</time
								>
							</button>
						{/each}
					</div>
				{/if}
			</section>

			<section class="conversation-pane" class:hidden-mobile={!activeConversation}>
				{#if activeConversation}
					<header class="conversation-header">
						<button
							class="mobile-back"
							aria-label="Back to chats"
							onclick={() => (activeConversation = '')}><ChevronLeft size={21} /></button
						>
						<span class="avatar small">{activeConversation.slice(0, 2).toUpperCase()}</span>
						<div>
							<strong
								>{invite?.issuer_pubkey === activeConversation
									? inviteName(invite)
									: shortKey(activeConversation)}</strong
							><small>Private relay routing</small>
						</div>
					</header>
					<div class="message-space" aria-live="polite">
						{#if messages.length === 0}
							<div class="conversation-empty">
								<LockKeyhole size={24} />
								<h2>A private beginning</h2>
								<p>Messages appear here only after encryption and durable local persistence.</p>
							</div>
						{:else}
							<div class="message-stack">
								{#each messages as message (message.rumorId)}
									<article class="bubble" class:mine={message.direction === 'outgoing'}>
										<p>{message.content}</p>
										<footer>
											<time
												>{new Date(message.createdAt * 1000).toLocaleTimeString([], {
													hour: '2-digit',
													minute: '2-digit'
												})}</time
											><span>{stateLabel(message.state)}</span>
										</footer>
									</article>
								{/each}
							</div>
						{/if}
					</div>
					{#if error}<div class="composer-error" role="alert">{error}</div>{/if}
					<form
						class="composer"
						onsubmit={(event) => {
							event.preventDefault();
							void sendMessage();
						}}
					>
						<textarea
							bind:value={composer}
							rows="1"
							maxlength="16384"
							placeholder="Write a message"
							aria-label="Message"
							onkeydown={(event) => {
								if (event.key === 'Enter' && !event.shiftKey) {
									event.preventDefault();
									void sendMessage();
								}
							}}></textarea>
						<button type="submit" aria-label="Send message" disabled={busy || !composer.trim()}
							><Send size={19} /></button
						>
					</form>
				{:else}
					<div class="desktop-empty">
						<div class="quiet-orbit large"><MessageCircle size={28} /></div>
						<h2>Choose a conversation</h2>
						<p>Your private messages will open here.</p>
					</div>
				{/if}
			</section>
		{:else if view === 'new-chat'}
			<section class="single-pane">
				<div class="single-content narrow">
					<button class="back-button inline" onclick={() => (view = 'chats')}
						><ChevronLeft size={20} /> Chats</button
					>
					<p class="eyebrow">Direct connection</p>
					<h1>Start a private chat</h1>
					<p class="lede small">
						Paste the person’s <span class="mono">npub</span> or lowercase public key. AURA checks their
						signed private-relay preference before sending anything.
					</p>
					<label
						><span>Contact identifier</span><textarea
							bind:value={contactInput}
							rows="4"
							autocapitalize="none"
							autocomplete="off"
							spellcheck="false"
							placeholder="npub1…"></textarea></label
					>
					{#if error}<div class="inline-error" role="alert">{error}</div>{/if}
					<button class="button primary" onclick={beginChat}
						>Open conversation <ArrowRight size={18} /></button
					>
				</div>
			</section>
		{:else}
			<section class="single-pane">
				<div class="single-content profile-content">
					<p class="eyebrow">Local identity</p>
					<div class="profile-title">
						<div class="profile-orb small">{account.displayName.slice(0, 1).toUpperCase()}</div>
						<div>
							<h1>{account.displayName}</h1>
							<p class="mono muted">{shortKey(account.pubkey)}</p>
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
						<button class="button primary" onclick={buildInvite}
							>{copied ? 'Copied invitation' : 'Copy private invitation'} <Copy size={17} /></button
						>
						<button class="button secondary" onclick={copyPubkey}
							>{copied ? 'Copied' : 'Copy npub'} <Copy size={17} /></button
						>
						<button class="button secondary" onclick={lock}
							>Lock profile <LogOut size={17} /></button
						>
					</div>
					{#if inviteUrl}<label
							><span>Latest invitation</span><textarea readonly rows="3" value={inviteUrl}
							></textarea></label
						>{/if}
					{#if notice}<div class="inline-notice">{notice}</div>{/if}
					{#if error}<div class="inline-error" role="alert">{error}</div>{/if}
					<div class="danger-zone">
						<div>
							<strong>Remove local profile</strong>
							<p>Deletes the encrypted envelope and local message database from this device.</p>
						</div>
						<button class="danger-button" onclick={deleteCurrentAccount}
							><Trash2 size={17} /> Remove</button
						>
					</div>
				</div>
			</section>
		{/if}
	</main>
{/if}
