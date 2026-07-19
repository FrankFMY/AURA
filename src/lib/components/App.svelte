<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		ArrowRight,
		Check,
		ChevronLeft,
		KeyRound,
		LockKeyhole,
		MessageCircle,
		ShieldCheck,
		UserRound,
		WifiOff
	} from 'lucide-svelte';
	import { nip19 } from 'nostr-tools';
	import ChatListPane from './ChatListPane.svelte';
	import ConversationPane from './ConversationPane.svelte';
	import Logo from './Logo.svelte';
	import ProfilePane from './ProfilePane.svelte';
	import {
		createPersistentAccount,
		restorePersistentAccount,
		unlockPersistentAccount,
		type BootstrappedAccount
	} from '$lib/app/account-service';
	import { collectLocalDiagnostics } from '$lib/app/diagnostics';
	import {
		contactDisplayLabel,
		inviteDisplayName as inviteName,
		messageStateLabel as stateLabel,
		shortNostrKey as shortKey
	} from '$lib/app/messenger-view';
	import {
		CoalescingTaskRunner,
		ConversationDraftStore,
		isCurrentRefreshContext,
		isCurrentSessionOperation,
		isNearConversationEnd,
		resizeComposer,
		scrollToConversationEnd,
		shouldClearSubmittedDraft,
		shouldSendComposerKey
	} from '$lib/app/conversation-ui';
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
	import { AccountDatabase } from '$lib/storage/account-database';
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
	type View = 'chats' | 'profile';
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
	let sendBusy = $state(false);
	let error = $state('');
	let notice = $state('');
	let contactInput = $state('');
	let contactError = $state('');
	let newChatOpen = $state(false);
	let activeConversation = $state('');
	let messages = $state<HydratedMessage[]>([]);
	let chats = $state<{ pubkey: string; lastAt: number; unread: number }[]>([]);
	let composer = $state('');
	let invite = $state.raw<InvitePayload>();
	let inviteError = $state('');
	let inviteUrl = $state('');
	let copied = $state<'invite' | 'pubkey'>();
	let copyResetTimer: ReturnType<typeof setTimeout> | undefined;
	let displayNameInput = $state.raw<HTMLInputElement>();
	let contactInputElement = $state.raw<HTMLTextAreaElement>();
	let composerInput = $state.raw<HTMLTextAreaElement>();
	let messageSpace = $state.raw<HTMLDivElement>();
	let mobileComposer = $state(false);
	let unseenBelow = $state(0);
	let poll: ReturnType<typeof setInterval> | undefined;
	let reconciling = false;
	let pendingForceEnd = '';
	let sessionGeneration = 0;
	let accountOperationGeneration = 0;
	let diagnosticsGeneration = 0;
	let componentGeneration = 0;
	const refreshRunner = new CoalescingTaskRunner(performRefresh, handleBackgroundRefreshError);
	const draftStore = new ConversationDraftStore();
	const messageErrors = new Map<string, string>();
	let presentedChats = $derived(
		chats.map((chat) => ({ ...chat, label: contactDisplayLabel(chat.pubkey, invite) }))
	);
	let conversationLabel = $derived(
		activeConversation ? contactDisplayLabel(activeConversation, invite) : ''
	);
	let presentedMessages = $derived(
		messages.map((message) => ({
			rumorId: message.rumorId,
			direction: message.direction,
			content: message.content,
			createdAt: message.createdAt,
			stateLabel: stateLabel(message.state)
		}))
	);

	$effect(() => {
		if (composerInput) resizeComposer(composerInput);
	});

	async function reconcileAndRefresh() {
		if (phase !== 'app' || !runtime || !session || reconciling) return;
		const runtimeInstance = runtime;
		const sessionInstance = session;
		const operationContext = {
			generation: sessionGeneration,
			runtime: runtimeInstance,
			session: sessionInstance
		};
		const operationIsCurrent = (): boolean => {
			if (!runtime || !session) return false;
			return isCurrentSessionOperation(operationContext, {
				generation: sessionGeneration,
				runtime,
				session
			});
		};
		reconciling = true;
		try {
			await runtimeInstance.reconcileOutbox();
			if (!operationIsCurrent()) return;
			await refreshData();
		} catch (cause) {
			if (!operationIsCurrent()) return;
			connection = 'offline';
			notice = friendlyError(cause, 'Queued messages will retry when relays are available.');
		} finally {
			if (operationIsCurrent()) reconciling = false;
		}
	}

	onMount(() => {
		const mountedGeneration = ++componentGeneration;
		const componentIsCurrent = (): boolean => componentGeneration === mountedGeneration;
		const mobileMedia = window.matchMedia('(max-width: 680px)');
		const updateMobileComposer = () => {
			mobileComposer = mobileMedia.matches;
		};
		const updateVisualViewport = () => {
			const viewport = window.visualViewport;
			const height = Math.max(1, Math.round(viewport?.height ?? window.innerHeight));
			const offsetTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
			const keyboardOpen =
				mobileMedia.matches &&
				window.innerHeight - height > Math.max(160, Math.round(window.innerHeight * 0.2));
			document.documentElement.style.setProperty('--aura-viewport-height', `${height}px`);
			document.documentElement.style.setProperty('--aura-viewport-top', `${offsetTop}px`);
			document.documentElement.toggleAttribute('data-aura-keyboard-open', keyboardOpen);
		};
		updateMobileComposer();
		updateVisualViewport();
		mobileMedia.addEventListener('change', updateMobileComposer);
		window.visualViewport?.addEventListener('resize', updateVisualViewport);
		window.visualViewport?.addEventListener('scroll', updateVisualViewport);
		window.addEventListener('resize', updateVisualViewport);
		void initialize(componentIsCurrent).catch((cause) => {
			if (!componentIsCurrent()) return;
			account = undefined;
			phase = invite ? 'invite' : inviteError ? 'invite-error' : 'welcome';
			error = friendlyError(cause, 'This device profile could not be loaded.');
		});
		poll = setInterval(() => {
			if (phase === 'app') void refreshData().catch(handleBackgroundRefreshError);
		}, 2_500);
		const onOnline = () => void reconcileAndRefresh();
		window.addEventListener('online', onOnline);
		return () => {
			if (poll) clearInterval(poll);
			poll = undefined;
			mobileMedia.removeEventListener('change', updateMobileComposer);
			window.visualViewport?.removeEventListener('resize', updateVisualViewport);
			window.visualViewport?.removeEventListener('scroll', updateVisualViewport);
			window.removeEventListener('resize', updateVisualViewport);
			window.removeEventListener('online', onOnline);
			refreshRunner.cancelQueued();
			document.documentElement.style.removeProperty('--aura-viewport-height');
			document.documentElement.style.removeProperty('--aura-viewport-top');
			document.documentElement.removeAttribute('data-aura-keyboard-open');
			componentGeneration += 1;
			sessionGeneration += 1;
			accountOperationGeneration += 1;
			const currentSession = session;
			const pendingSession = pending?.session;
			const currentRuntime = runtime;
			const currentPool = pool;
			const currentDatabase = database;
			session = undefined;
			runtime = undefined;
			pool = undefined;
			database = undefined;
			currentSession?.lock();
			if (pendingSession && pendingSession !== currentSession) pendingSession.lock();
			clearSensitiveUiState();
			account = undefined;
			try {
				currentRuntime?.stop();
			} catch {
				// Key material is already zeroized; continue cleanup.
			}
			try {
				currentPool?.destroy();
			} catch {
				// Continue cleanup.
			}
			try {
				currentDatabase?.close();
			} catch {
				// Continue cleanup.
			}
			registry?.close();
		};
	});

	async function initialize(componentIsCurrent: () => boolean) {
		if (!componentIsCurrent()) return;
		parseInvite();
		let selectedAccount = await getActiveAccount(registry);
		if (!componentIsCurrent()) return;
		if (!selectedAccount) {
			selectedAccount = await registry.accounts.orderBy('updatedAt').last();
			if (!componentIsCurrent()) return;
			if (selectedAccount) {
				await setActiveAccount(registry, selectedAccount.pubkey, componentIsCurrent);
				if (!componentIsCurrent()) return;
			}
		}
		account = selectedAccount;
		phase = selectedAccount
			? 'unlock'
			: invite
				? 'invite'
				: inviteError
					? 'invite-error'
					: 'welcome';
	}

	function parseInvite() {
		if (location.pathname !== '/i' && location.pathname !== '/i/') return;
		const invitationUrl = location.href;
		history.replaceState(history.state, '', `${location.pathname}${location.search}`);
		try {
			invite = parseAndVerifyInviteUrl(invitationUrl, {
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

	function startAccountOperation(): () => boolean {
		const generation = ++accountOperationGeneration;
		busy = true;
		return () => accountOperationGeneration === generation;
	}

	function abandonPendingAccount(): void {
		const pendingSession = pending?.session;
		if (pendingSession) {
			if (session === pendingSession) session = undefined;
			pendingSession.lock();
		}
		pending = undefined;
		recoveryInput = '';
		recoveryWords = '';
		recoveryAnswers = ['', '', ''];
	}

	async function openOnboarding(nextPhase: 'create' | 'restore') {
		accountOperationGeneration += 1;
		busy = false;
		abandonPendingAccount();
		phase = nextPhase;
		error = '';
		if (nextPhase === 'restore') recoveryInput = '';
		await tick();
		displayNameInput?.focus();
	}

	function leaveOnboarding(): void {
		accountOperationGeneration += 1;
		busy = false;
		abandonPendingAccount();
		error = '';
		phase = invite ? 'invite' : 'welcome';
	}

	async function restoreDifferentIdentity(): Promise<void> {
		accountOperationGeneration += 1;
		busy = false;
		abandonPendingAccount();
		displayName = account?.displayName ?? '';
		error = '';
		phase = 'restore';
		await tick();
		displayNameInput?.focus();
	}

	async function createAccount() {
		if (busy) return;
		clearFeedback();
		if (!displayName.trim()) {
			error = 'Enter the name people should see.';
			return;
		}
		const operationIsCurrent = startAccountOperation();
		try {
			if (!(await hasPlatformWebAuthn())) {
				throw new Error('This browser cannot create a user-verified device credential.');
			}
			if (!operationIsCurrent()) return;
			const created = await createPersistentAccount({
				registry,
				displayName: displayName.trim().normalize('NFC'),
				origin: location.origin,
				rpId: location.hostname,
				dmRelays: DM_RELAYS,
				isCurrent: operationIsCurrent
			});
			if (!operationIsCurrent()) {
				created.session.lock();
				return;
			}
			pending = created;
			recoveryWords = created.recoveryWords;
			recoveryAnswers = ['', '', ''];
			phase = 'recovery';
		} catch (cause) {
			if (operationIsCurrent())
				error = friendlyError(cause, 'A secure profile could not be created.');
		} finally {
			if (operationIsCurrent()) busy = false;
		}
	}

	async function restoreAccount() {
		if (busy) return;
		clearFeedback();
		if (!displayName.trim()) {
			error = 'Enter the name people should see.';
			return;
		}
		const operationIsCurrent = startAccountOperation();
		let restored: BootstrappedAccount | undefined;
		try {
			restored = await restorePersistentAccount({
				registry,
				displayName: displayName.trim().normalize('NFC'),
				recoveryWords: recoveryInput,
				origin: location.origin,
				rpId: location.hostname,
				dmRelays: DM_RELAYS,
				isCurrent: operationIsCurrent
			});
			if (!operationIsCurrent()) {
				restored.session.lock();
				return;
			}
			pending = restored;
			recoveryInput = '';
			await confirmRecoveryCode(registry, restored.account.pubkey, Date.now(), operationIsCurrent);
			if (!operationIsCurrent()) {
				restored.session.lock();
				return;
			}
			await setActiveAccount(registry, restored.account.pubkey, operationIsCurrent);
			if (!operationIsCurrent()) {
				restored.session.lock();
				return;
			}
			const restoredAccount = await registry.accounts.get(restored.account.pubkey);
			if (!operationIsCurrent()) {
				restored.session.lock();
				return;
			}
			if (!restoredAccount) throw new Error('Restored account was not persisted.');
			account = restoredAccount;
			await activate(restored.session);
			if (!operationIsCurrent()) return;
			pending = undefined;
			restored = undefined;
		} catch (cause) {
			restored?.session.lock();
			if (restored && pending?.session === restored.session) pending = undefined;
			if (operationIsCurrent())
				error = friendlyError(cause, 'The Recovery Code could not be restored.');
		} finally {
			if (operationIsCurrent()) busy = false;
		}
	}

	async function confirmRecovery() {
		if (!pending || busy) return;
		clearFeedback();
		const words = recoveryWords.split(' ');
		const valid = RECOVERY_CHECKS.every(
			(index, answerIndex) => recoveryAnswers[answerIndex].trim().toLowerCase() === words[index]
		);
		if (!valid) {
			error = 'Those words do not match. Check your saved Recovery Code.';
			return;
		}
		const pendingProfile = pending;
		const operationIsCurrent = startAccountOperation();
		try {
			await confirmRecoveryCode(
				registry,
				pendingProfile.account.pubkey,
				Date.now(),
				operationIsCurrent
			);
			if (!operationIsCurrent()) return;
			await setActiveAccount(registry, pendingProfile.account.pubkey, operationIsCurrent);
			if (!operationIsCurrent()) return;
			const confirmedAccount = await registry.accounts.get(pendingProfile.account.pubkey);
			if (!operationIsCurrent()) return;
			if (!confirmedAccount) throw new Error('Account confirmation was not persisted.');
			account = confirmedAccount;
			const pendingSession = pendingProfile.session;
			pending = undefined;
			recoveryWords = '';
			recoveryAnswers = ['', '', ''];
			await activate(pendingSession);
		} catch (cause) {
			if (operationIsCurrent()) error = friendlyError(cause, 'Recovery confirmation failed.');
		} finally {
			if (operationIsCurrent()) busy = false;
		}
	}

	async function unlock() {
		if (!account || busy) return;
		clearFeedback();
		const currentAccount = account;
		const operationIsCurrent = startAccountOperation();
		let unlocked: UnlockedSession | undefined;
		try {
			unlocked = await unlockPersistentAccount({
				account: currentAccount,
				origin: location.origin,
				rpId: location.hostname,
				isCurrent: operationIsCurrent
			});
			if (!operationIsCurrent()) {
				unlocked.lock();
				return;
			}
			await activate(unlocked);
		} catch (cause) {
			unlocked?.lock();
			if (operationIsCurrent()) error = friendlyError(cause, 'This profile could not be unlocked.');
		} finally {
			if (operationIsCurrent()) busy = false;
		}
	}

	async function activate(unlocked: UnlockedSession) {
		if (!account) throw new Error('No account is selected.');
		const currentAccount = account;
		const previousSession = session;
		const activationGeneration = ++sessionGeneration;
		if (previousSession && previousSession !== unlocked) previousSession.lock();
		session = unlocked;
		if (!currentAccount.recoveryConfirmed) {
			recoveryWords = unlocked.withSecretKey((secretKey) => secretKeyToRecoveryWords(secretKey));
			pending = { account: currentAccount, session: unlocked, recoveryWords };
			phase = 'recovery';
			return;
		}

		let databaseInstance: AccountDatabase | undefined;
		let poolInstance: ReturnType<typeof createNostrPool> | undefined;
		let runtimeInstance: MessengerRuntime | undefined;
		const activationIsCurrent = (): boolean =>
			sessionGeneration === activationGeneration &&
			session === unlocked &&
			account?.pubkey === currentAccount.pubkey &&
			runtime === runtimeInstance;
		const disposeActivation = (wasCurrent: boolean): void => {
			if (wasCurrent && sessionGeneration === activationGeneration) sessionGeneration += 1;
			unlocked.lock();
			if (pending?.session === unlocked) {
				pending = undefined;
				recoveryWords = '';
				recoveryAnswers = ['', '', ''];
			}
			try {
				runtimeInstance?.stop();
			} catch {
				// Key material is already zeroized; continue best-effort resource cleanup.
			}
			try {
				poolInstance?.destroy();
			} catch {
				// Continue cleanup.
			}
			try {
				databaseInstance?.close();
			} catch {
				// Continue cleanup.
			}
			if (runtime === runtimeInstance) runtime = undefined;
			if (pool === poolInstance) pool = undefined;
			if (database === databaseInstance) database = undefined;
			if (session === unlocked) session = undefined;
			if (wasCurrent) {
				connection = 'offline';
				phase = 'unlock';
			}
		};

		try {
			const previousRuntime = runtime;
			const previousDatabase = database;
			const previousPool = pool;
			runtime = undefined;
			database = undefined;
			pool = undefined;
			try {
				previousRuntime?.stop();
			} catch {
				// Previous session is already zeroized; continue replacement cleanup.
			}
			try {
				previousDatabase?.close();
			} catch {
				// Continue replacement cleanup.
			}
			try {
				previousPool?.destroy();
			} catch {
				// Continue replacement cleanup.
			}
			databaseInstance = new AccountDatabase(currentAccount.pubkey);
			database = databaseInstance;
			poolInstance = createNostrPool();
			pool = poolInstance;
			runtimeInstance = new MessengerRuntime({
				session,
				database,
				pool,
				lookupRelays: LOOKUP_RELAYS,
				accountDmRelays: currentAccount.dmRelays,
				recoveryConfirmed: currentAccount.recoveryConfirmed,
				onTransportError: (cause) => {
					if (!activationIsCurrent()) return;
					connection = 'offline';
					notice = friendlyError(cause, 'A relay connection closed.');
				}
			});
			runtime = runtimeInstance;
			connection = 'connecting';
			await runtimeInstance.start();
			if (!activationIsCurrent()) {
				disposeActivation(false);
				return;
			}
			phase = 'app';
			view = 'chats';
			if (invite) activeConversation = invite.issuer_pubkey;
			await refreshData(Boolean(activeConversation));
			if (!activationIsCurrent()) {
				disposeActivation(false);
				return;
			}
		} catch (cause) {
			const wasCurrent = sessionGeneration === activationGeneration && session === unlocked;
			disposeActivation(wasCurrent);
			throw cause;
		}

		void runtimeInstance
			.publishOwnRelayList()
			.then(() => {
				if (!activationIsCurrent()) return;
				connection = 'online';
			})
			.catch((cause) => {
				if (!activationIsCurrent()) return;
				connection = 'offline';
				notice = friendlyError(cause, 'Private relays are temporarily unavailable.');
			});
	}

	function revealLatestMessages(): void {
		if (!messageSpace) return;
		scrollToConversationEnd(messageSpace);
		unseenBelow = 0;
	}

	function handleConversationScroll(): void {
		if (messageSpace && isNearConversationEnd(messageSpace)) unseenBelow = 0;
	}

	function closeConversation(): void {
		activeConversation = '';
		unseenBelow = 0;
	}

	function handleComposerInput(value: string, element: HTMLTextAreaElement): void {
		draftStore.save(activeConversation, value);
		resizeComposer(element);
	}

	function handleComposerKeydown(event: KeyboardEvent): void {
		if (
			shouldSendComposerKey(
				{
					key: event.key,
					shiftKey: event.shiftKey,
					isComposing: event.isComposing,
					keyCode: event.keyCode
				},
				{ mobile: mobileComposer }
			)
		) {
			event.preventDefault();
			void sendMessage();
		}
	}

	function refreshData(forceEnd = false): Promise<void> {
		if (forceEnd && activeConversation) pendingForceEnd = activeConversation;
		return refreshRunner.request();
	}

	async function performRefresh(): Promise<void> {
		if (!database || !runtime) return;
		const databaseInstance = database;
		const runtimeInstance = runtime;
		const conversation = activeConversation;
		const capturedContext = {
			database: databaseInstance,
			runtime: runtimeInstance,
			conversation
		};
		const contextIsCurrent = (): boolean => {
			if (!database || !runtime) return false;
			return isCurrentRefreshContext(capturedContext, {
				database,
				runtime,
				conversation: activeConversation
			});
		};
		const previousCount = messages.length;
		const loaded = await (async () => {
			try {
				const records = await databaseInstance.messages.toArray();
				if (!contextIsCurrent()) return undefined;
				const nextMessages = conversation
					? await runtimeInstance.readConversation(conversation)
					: undefined;
				return { records, nextMessages };
			} catch (cause) {
				if (!contextIsCurrent()) return undefined;
				throw cause;
			}
		})();
		if (!loaded || !contextIsCurrent()) return;
		const latest = new Map<string, number>();
		for (const record of loaded.records) {
			latest.set(
				record.conversationPubkey,
				Math.max(latest.get(record.conversationPubkey) ?? 0, record.createdAt)
			);
		}
		const nextChats = [...latest]
			.map(([pubkey, lastAt]) => ({ pubkey, lastAt, unread: 0 }))
			.sort((a, b) => b.lastAt - a.lastAt);
		const shouldFollow =
			pendingForceEnd === conversation || !messageSpace || isNearConversationEnd(messageSpace);
		chats = nextChats;
		if (loaded.nextMessages) {
			messages = loaded.nextMessages;
			await tick();
			if (!contextIsCurrent()) return;
			if (shouldFollow) {
				revealLatestMessages();
				if (pendingForceEnd === conversation) pendingForceEnd = '';
			} else if (loaded.nextMessages.length > previousCount) {
				unseenBelow += loaded.nextMessages.length - previousCount;
			}
		}
	}

	function handleBackgroundRefreshError(cause: unknown): void {
		if (phase !== 'app') return;
		connection = 'offline';
		notice = friendlyError(cause, 'Local conversation refresh failed.');
	}

	async function openConversation(pubkey: string): Promise<void> {
		const changedConversation = activeConversation !== pubkey;
		activeConversation = pubkey;
		if (changedConversation) messages = [];
		composer = draftStore.load(pubkey);
		error = messageErrors.get(pubkey) ?? '';
		notice = '';
		unseenBelow = 0;
		await refreshData(true);
		await tick();
		if (composerInput) resizeComposer(composerInput);
	}

	async function openConversationFromList(pubkey: string): Promise<void> {
		try {
			await openConversation(pubkey);
		} catch (cause) {
			handleBackgroundRefreshError(cause);
			if (view === 'chats' && activeConversation === pubkey) {
				error = friendlyError(cause, 'This conversation could not be refreshed yet.');
			}
		}
	}

	function showChats(): void {
		view = 'chats';
		newChatOpen = false;
		contactError = '';
		error = activeConversation ? (messageErrors.get(activeConversation) ?? '') : '';
		notice = '';
	}

	async function openNewChat() {
		clearFeedback();
		contactError = '';
		contactInput = invite?.issuer_pubkey ?? '';
		newChatOpen = true;
		view = 'chats';
		await tick();
		contactInputElement?.focus();
	}

	async function beginChat() {
		clearFeedback();
		let pubkey: string;
		try {
			pubkey = parseNostrPubkey(contactInput);
			if (pubkey === account?.pubkey)
				throw new Error('Choose another person, not your own identity.');
		} catch (cause) {
			contactError = friendlyError(cause, 'That contact identifier is invalid.');
			return;
		}
		contactError = '';
		newChatOpen = false;
		contactInput = '';
		view = 'chats';
		await openConversationFromList(pubkey);
	}

	function cancelNewChat(): void {
		newChatOpen = false;
		contactInput = '';
		contactError = '';
	}

	async function sendMessage() {
		if (sendBusy || !runtime || !session || !activeConversation || !composer.trim()) return;
		const runtimeInstance = runtime;
		const sessionInstance = session;
		const operationContext = {
			generation: sessionGeneration,
			runtime: runtimeInstance,
			session: sessionInstance
		};
		const operationIsCurrent = (): boolean => {
			if (!runtime || !session) return false;
			return isCurrentSessionOperation(operationContext, {
				generation: sessionGeneration,
				runtime,
				session
			});
		};
		const conversation = activeConversation;
		const submittedDraft = composer;
		const content = submittedDraft.trim();
		clearFeedback();
		messageErrors.delete(conversation);
		sendBusy = true;
		try {
			await runtimeInstance.send(conversation, content);
			if (!operationIsCurrent()) return;
			if (shouldClearSubmittedDraft(draftStore.load(conversation), submittedDraft)) {
				draftStore.save(conversation, '');
			}
			messageErrors.delete(conversation);
			if (activeConversation === conversation) {
				if (shouldClearSubmittedDraft(composer, submittedDraft)) composer = '';
				await tick();
				if (!operationIsCurrent()) return;
				if (composerInput) resizeComposer(composerInput);
			}
			try {
				await refreshData(activeConversation === conversation);
			} catch (cause) {
				if (operationIsCurrent()) handleBackgroundRefreshError(cause);
			}
		} catch (cause) {
			if (!operationIsCurrent()) return;
			const message = cause instanceof Error ? cause.message : '';
			const failure = /recipient_not_dm_ready/u.test(message)
				? 'This person has not published a private-message relay list yet. Nothing was sent.'
				: friendlyError(cause, 'The message was not sent.');
			messageErrors.set(conversation, failure);
			if (view === 'chats' && activeConversation === conversation) error = failure;
		} finally {
			if (operationIsCurrent()) sendBusy = false;
		}
	}

	function showCopied(kind: 'invite' | 'pubkey'): void {
		if (copyResetTimer) clearTimeout(copyResetTimer);
		copied = kind;
		copyResetTimer = setTimeout(() => {
			copied = undefined;
			copyResetTimer = undefined;
		}, 1_800);
	}

	async function buildInvite() {
		if (!session || !account) return;
		const currentSession = session;
		const currentAccount = account;
		const operationGeneration = sessionGeneration;
		const mountedGeneration = componentGeneration;
		const operationIsCurrent = (): boolean =>
			componentGeneration === mountedGeneration &&
			sessionGeneration === operationGeneration &&
			session === currentSession &&
			account?.pubkey === currentAccount.pubkey;
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
					secretKey
				)
			);
			if (!operationIsCurrent()) return;
			const nextInviteUrl = `${location.origin}/i/#${token}`;
			await navigator.clipboard.writeText(nextInviteUrl);
			if (!operationIsCurrent()) return;
			inviteUrl = nextInviteUrl;
			showCopied('invite');
		} catch (cause) {
			if (operationIsCurrent()) error = friendlyError(cause, 'The invitation could not be copied.');
		}
	}

	async function copyPubkey() {
		if (!session || !account) return;
		const currentSession = session;
		const currentPubkey = account.pubkey;
		const operationGeneration = sessionGeneration;
		const mountedGeneration = componentGeneration;
		const operationIsCurrent = (): boolean =>
			componentGeneration === mountedGeneration &&
			sessionGeneration === operationGeneration &&
			session === currentSession &&
			account?.pubkey === currentPubkey;
		clearFeedback();
		try {
			await navigator.clipboard.writeText(nip19.npubEncode(currentPubkey));
			if (!operationIsCurrent()) return;
			showCopied('pubkey');
		} catch (cause) {
			if (operationIsCurrent()) error = friendlyError(cause, 'The identity could not be copied.');
		}
	}

	async function copyDiagnostics() {
		if (!session || !account || !database) return;
		const currentSession = session;
		const currentAccount = account;
		const currentDatabase = database;
		const operationGeneration = sessionGeneration;
		const requestGeneration = ++diagnosticsGeneration;
		const mountedGeneration = componentGeneration;
		const operationIsCurrent = (): boolean =>
			componentGeneration === mountedGeneration &&
			sessionGeneration === operationGeneration &&
			diagnosticsGeneration === requestGeneration &&
			session === currentSession &&
			database === currentDatabase &&
			account?.pubkey === currentAccount.pubkey;
		clearFeedback();
		try {
			const report = await collectLocalDiagnostics(currentDatabase, {
				connection,
				recoveryConfirmed: currentAccount.recoveryConfirmed
			});
			if (!operationIsCurrent()) return;
			await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
			if (!operationIsCurrent()) return;
			notice = 'Copied redacted local diagnostics.';
		} catch {
			if (operationIsCurrent()) {
				error = 'The local diagnostics could not be copied.';
			}
		}
	}

	function clearSensitiveUiState(): void {
		diagnosticsGeneration += 1;
		if (copyResetTimer) clearTimeout(copyResetTimer);
		copyResetTimer = undefined;
		pending = undefined;
		displayName = '';
		recoveryInput = '';
		recoveryWords = '';
		recoveryAnswers = ['', '', ''];
		busy = false;
		sendBusy = false;
		error = '';
		notice = '';
		contactInput = '';
		contactError = '';
		newChatOpen = false;
		activeConversation = '';
		messages = [];
		chats = [];
		composer = '';
		displayNameInput = undefined;
		contactInputElement = undefined;
		composerInput = undefined;
		messageSpace = undefined;
		unseenBelow = 0;
		pendingForceEnd = '';
		draftStore.clear();
		messageErrors.clear();
		invite = undefined;
		inviteError = '';
		inviteUrl = '';
		copied = undefined;
		view = 'chats';
		reconciling = false;
	}

	function lock() {
		sessionGeneration += 1;
		accountOperationGeneration += 1;
		refreshRunner.cancelQueued();
		const currentSession = session;
		const currentRuntime = runtime;
		const currentPool = pool;
		const currentDatabase = database;
		session = undefined;
		runtime = undefined;
		pool = undefined;
		database = undefined;
		currentSession?.lock();
		try {
			currentRuntime?.stop();
		} catch {
			// Key material is already zeroized; continue cleanup.
		}
		try {
			currentPool?.destroy();
		} catch {
			// Continue cleanup.
		}
		try {
			currentDatabase?.close();
		} catch {
			// Continue cleanup.
		}
		clearSensitiveUiState();
		phase = 'unlock';
		connection = 'offline';
	}

	async function deleteCurrentAccount() {
		if (!account || busy) return;
		if (!window.confirm('Remove this profile and its local message history from this device?'))
			return;
		const deletingAccount = account;
		const pubkey = deletingAccount.pubkey;
		lock();
		const operationIsCurrent = startAccountOperation();
		try {
			await removeAccount(registry, pubkey, undefined, operationIsCurrent);
			if (!operationIsCurrent()) return;
			account = undefined;
			invite = undefined;
			phase = 'welcome';
		} catch (cause) {
			if (!operationIsCurrent()) return;
			let remainingAccount: RegisteredAccount = deletingAccount;
			try {
				remainingAccount = (await registry.accounts.get(pubkey)) ?? deletingAccount;
			} catch {
				remainingAccount = deletingAccount;
			}
			if (!operationIsCurrent()) return;
			account = remainingAccount;
			phase = 'unlock';
			error = friendlyError(cause, 'The local profile could not be removed completely.');
		} finally {
			if (operationIsCurrent()) busy = false;
		}
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
				<h2>Self-declared invitation from {inviteName(invite)}</h2>
				<p class="muted">
					The signature proves control of the Nostr identity below, not the displayed name. Verify
					it through another channel if identity matters.
				</p>
				<p class="mono invite-identity">{nip19.npubEncode(invite.issuer_pubkey)}</p>
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
			{#if error}<div class="inline-error" role="alert">{error}</div>{/if}
			<div class="stack-actions">
				<button class="button primary" onclick={() => void openOnboarding('create')}>
					Create secure profile <ArrowRight size={18} />
				</button>
				<button class="button secondary" onclick={() => void openOnboarding('restore')}>
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
		<form
			class="form-card"
			onsubmit={(event) => {
				event.preventDefault();
				void (phase === 'create' ? createAccount() : restoreAccount());
			}}
		>
			<button
				type="button"
				class="back-button"
				aria-label="Go back"
				disabled={busy}
				onclick={leaveOnboarding}><ChevronLeft size={20} /></button
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
					bind:this={displayNameInput}
					bind:value={displayName}
					required
					aria-invalid={Boolean(error)}
					aria-describedby={error ? 'onboarding-error' : undefined}
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
						required
						aria-invalid={Boolean(error)}
						aria-describedby={error ? 'onboarding-error' : undefined}
						rows="5"
						autocomplete="off"
						autocapitalize="none"
						spellcheck="false"
						placeholder="word 1  word 2  …  word 24"></textarea>
				</label>
			{/if}
			{#if error}<div id="onboarding-error" class="inline-error" role="alert">{error}</div>{/if}
			<button type="submit" class="button primary full" disabled={busy}>
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
		</form>
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
			<button class="text-button" disabled={busy} onclick={() => void restoreDifferentIdentity()}
				>Restore a different identity</button
			>
		</section>
	</main>
{:else if phase === 'app' && account}
	<main class="app-shell" class:conversation-open={view === 'chats' && Boolean(activeConversation)}>
		{#if !mobileComposer || view !== 'chats' || !activeConversation}
			<aside class="rail">
				<div class="rail-logo"><Logo compact /></div>
				<nav aria-label="Primary navigation">
					<button
						class:active={view === 'chats'}
						aria-current={view === 'chats' ? 'page' : undefined}
						onclick={showChats}
						aria-label="Chats"><MessageCircle size={21} /></button
					>
				</nav>
				<button
					class:active={view === 'profile'}
					aria-current={view === 'profile' ? 'page' : undefined}
					onclick={() => {
						view = 'profile';
						error = '';
					}}
					aria-label="Profile"><UserRound size={21} /></button
				>
			</aside>
		{/if}

		{#if view === 'chats'}
			<ChatListPane
				bind:contactInput
				bind:contactInputElement
				{activeConversation}
				chats={presentedChats}
				{connection}
				{newChatOpen}
				{contactError}
				onOpenNewChat={openNewChat}
				onCancelNewChat={cancelNewChat}
				onBeginChat={beginChat}
				onOpenConversation={openConversationFromList}
			/>

			<ConversationPane
				bind:composer
				bind:composerInput
				bind:messageSpace
				{activeConversation}
				{conversationLabel}
				messages={presentedMessages}
				{unseenBelow}
				{error}
				{sendBusy}
				{mobileComposer}
				onBack={closeConversation}
				onScroll={handleConversationScroll}
				onRevealLatest={revealLatestMessages}
				onSend={sendMessage}
				onComposerInput={handleComposerInput}
				onComposerKeydown={handleComposerKeydown}
			/>
		{:else}
			<ProfilePane
				displayName={account.displayName}
				identityLabel={shortKey(account.pubkey)}
				{copied}
				{inviteUrl}
				{notice}
				{error}
				onBuildInvite={buildInvite}
				onCopyPubkey={copyPubkey}
				onCopyDiagnostics={copyDiagnostics}
				onLock={lock}
				onDelete={deleteCurrentAccount}
			/>
		{/if}
	</main>
{/if}
