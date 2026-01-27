import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
import ndkService from '$services/ndk';
import { dbHelpers, type Conversation, type UserProfile } from '$db';
import authStore from './auth.svelte';
import { validatePubkey } from '$lib/validators/schemas';
import {
	giftWrap,
	type giftWrap as GiftWrapModule
} from '$lib/services/crypto';
import { pushNotifications } from '$services/push-notifications';

/** Encryption protocol used for a message */
export type EncryptionProtocol = 'nip04' | 'nip17' | 'unknown';

/** Debug: test encryption/decryption roundtrip with a pubkey */
export async function testEncryptionWithPubkey(theirPubkey: string): Promise<{
	success: boolean;
	error?: string;
	details?: string;
}> {
	const testMessage = 'AURA_TEST_' + Date.now();

	try {
		if (!window.nostr?.nip04) {
			return { success: false, error: 'NIP-04 not available' };
		}

		// Encrypt
		const encrypted = await window.nostr.nip04.encrypt(theirPubkey, testMessage);
		console.debug('[Test] Encrypted:', encrypted.slice(0, 50));

		// Decrypt
		const decrypted = await window.nostr.nip04.decrypt(theirPubkey, encrypted);
		console.debug('[Test] Decrypted:', decrypted);

		if (decrypted === testMessage) {
			return {
				success: true,
				details: `Roundtrip OK with pubkey ${theirPubkey.slice(0, 16)}...`
			};
		} else {
			return {
				success: false,
				error: 'Decrypted message does not match',
				details: `Expected: ${testMessage}, Got: ${decrypted}`
			};
		}
	} catch (e) {
		const errorMsg = e instanceof Error ? e.message : String(e);
		return {
			success: false,
			error: errorMsg,
			details: `Failed with pubkey ${theirPubkey.slice(0, 16)}...`
		};
	}
}

/** Message with metadata */
export interface Message {
	id: string;
	pubkey: string;
	content: string;
	created_at: number;
	isOutgoing: boolean;
	decrypted: boolean;
	error?: string;
	/** Which encryption protocol was used */
	protocol: EncryptionProtocol;
}

/** Conversation with messages */
export interface ConversationWithMessages extends Conversation {
	profile: UserProfile | null;
	messages: Message[];
}

/** Create messages store */
function createMessagesStore() {
	let conversations = $state<ConversationWithMessages[]>([]);
	let activeConversation = $state<string | null>(null);
	let isLoading = $state(false);
	let isSending = $state(false);
	let error = $state<string | null>(null);
	let dmSubscriptionId: string | null = null;
	let giftWrapSubscriptionId: string | null = null;
	
	// Track seen event IDs to prevent duplicate processing
	const seenEventIds = new Set<string>();
	// Track if initial load is complete (EOSE received)
	let initialLoadComplete = false;
	// Timestamp when subscription started - events before this are historical
	let subscriptionStartTime = 0;
	
	// User preference for NIP-17 (default true for new conversations)
	let preferNip17 = $state(true);

	// Profile cache
	const profileCache = new Map<string, UserProfile>();

	/** Get profile from cache */
	async function getProfile(pubkey: string): Promise<UserProfile | null> {
		if (profileCache.has(pubkey)) {
			return profileCache.get(pubkey)!;
		}

		const cached = await dbHelpers.getProfile(pubkey);
		if (cached) {
			profileCache.set(pubkey, cached);
			return cached;
		}

		// Fetch in background
		ndkService.fetchProfile(pubkey).then(async () => {
			const profile = await dbHelpers.getProfile(pubkey);
			if (profile) {
				profileCache.set(pubkey, profile);
				// Update conversations with new profile
				conversations = conversations.map((c) => {
					if (c.pubkey === pubkey) {
						return { ...c, profile };
					}
					return c;
				});
			}
		});

		return null;
	}

	/** Detect if content is NIP-04 format (ciphertext?iv=...) */
	function isNip04Format(content: string): boolean {
		// NIP-04 format: base64?iv=base64
		// Also check for URL-encoded version: base64%3Fiv%3Dbase64
		return /^[A-Za-z0-9+/=]+\?iv=[A-Za-z0-9+/=]+$/.test(content) ||
			/^[A-Za-z0-9+/=]+%3Fiv%3D[A-Za-z0-9+/=]+$/i.test(content);
	}

	/** Try to normalize NIP-04 content (handle URL-encoded variants) */
	function normalizeNip04Content(content: string): string {
		// URL decode if needed
		if (content.includes('%3F') || content.includes('%3D')) {
			try {
				return decodeURIComponent(content);
			} catch {
				return content;
			}
		}
		return content;
	}

	/** Detect if content looks like NIP-44 format */
	function isNip44Format(content: string): boolean {
		// NIP-44 is pure base64 without ?iv= separator
		// It's typically longer than 50 chars and starts with version byte
		if (!content || content.includes('?iv=')) return false;
		// Check if it's valid base64
		const base64Regex = /^[A-Za-z0-9+/]+=*$/;
		if (!base64Regex.test(content)) return false;
		// NIP-44 messages are typically at least 100 bytes (version + nonce + ciphertext + mac)
		return content.length >= 50;
	}

	/** Get NIP-44 version from encrypted content */
	function getNip44Version(content: string): number | null {
		try {
			// Decode base64 and check first byte (version)
			const decoded = atob(content);
			if (decoded.length > 0) {
				return decoded.charCodeAt(0);
			}
		} catch {
			// Invalid base64
		}
		return null;
	}

	/** Get content format info for debugging */
	function getContentFormat(content: string): string {
		if (isNip04Format(content)) return 'NIP-04';
		if (isNip44Format(content)) {
			const version = getNip44Version(content);
			return `NIP-44 v${version ?? '?'}`;
		}
		if (content.startsWith('{')) return 'JSON (plaintext)';
		if (content.length < 20) return 'Short/Unknown';
		return 'Unknown';
	}

	/** Decrypt message content (NIP-04 for now, NIP-44 preferred) */
	async function decryptMessage(event: NDKEvent, otherPubkey: string): Promise<string> {
		let result: string | undefined;
		let method: string = 'unknown';
		let lastError: Error | null = null;
		const content = event.content;
		const contentFormat = getContentFormat(content);

		// Detect encryption format
		const isNip04 = isNip04Format(content);
		const isNip44 = isNip44Format(content);

		// Get NIP-44 version for debugging
		const nip44Version = isNip44 ? getNip44Version(content) : null;

		console.debug('[Messages] Attempting decryption:', {
			eventId: event.id.slice(0, 8),
			decryptWithPubkey: otherPubkey,  // FULL pubkey we're decrypting with
			myPubkey: authStore.pubkey,  // Our pubkey for reference
			contentLength: content?.length,
			contentFormat,
			nip44Version,
			contentPreview: content?.slice(0, 60),
			hasNip04: !!window.nostr?.nip04,
			hasNip44: !!window.nostr?.nip44,
			// Check pubkey relationship
			isDecryptingOwnMessage: event.pubkey === authStore.pubkey
		});

		// If content looks like NIP-44, try NIP-44 FIRST
		if (isNip44 && window.nostr?.nip44) {
			try {
				method = 'NIP-44 (detected)';
				console.debug('[Messages] Trying NIP-44 decrypt with:', {
					otherPubkey: otherPubkey.slice(0, 16),
					contentLen: content.length,
					version: nip44Version
				});
				result = await window.nostr.nip44.decrypt(otherPubkey, content);
				if (result && result.trim()) {
					console.debug('[Messages] NIP-44 decryption succeeded, result length:', result.length);
				}
			} catch (e) {
				const errorMsg = e instanceof Error ? e.message : String(e);
				console.debug('[Messages] NIP-44 decryption failed:', {
					error: errorMsg,
					errorType: e instanceof Error ? e.constructor.name : typeof e,
					// Check for common NIP-44 errors
					isVersionError: errorMsg.includes('version'),
					isMacError: errorMsg.includes('MAC') || errorMsg.includes('mac') || errorMsg.includes('tag'),
					isPaddingError: errorMsg.includes('padding'),
					isKeyError: errorMsg.includes('key')
				});
				lastError = e instanceof Error ? e : new Error(String(e));
			}
		}

		// If content looks like NIP-04, try NIP-04
		if ((!result || result.trim() === '') && isNip04 && window.nostr?.nip04) {
			try {
				method = 'NIP-04 (detected)';
				const normalizedContent = normalizeNip04Content(content);
				console.debug('[Messages] Trying NIP-04 decrypt:', {
					otherPubkey,
					myPubkey: authStore.pubkey,
					normalizedContentLen: normalizedContent.length,
					hasIvSeparator: normalizedContent.includes('?iv=')
				});
				result = await window.nostr.nip04.decrypt(otherPubkey, normalizedContent);
				if (result && result.trim()) {
					console.debug('[Messages] NIP-04 decryption succeeded, result:', result.slice(0, 50));
				}
			} catch (e) {
				const errorMsg = e instanceof Error ? e.message : String(e);
				console.debug('[Messages] NIP-04 decryption failed:', {
					error: errorMsg,
					otherPubkey: otherPubkey.slice(0, 16),
					// Common Alby error patterns
					isAlbyError: errorMsg.includes('Failed to'),
					isKeyError: errorMsg.includes('key'),
					isDecryptError: errorMsg.includes('decrypt')
				});
				lastError = e instanceof Error ? e : new Error(String(e));
			}
		}

		// Try NIP-44 as fallback if not already tried
		if ((!result || result.trim() === '') && !isNip44 && window.nostr?.nip44) {
			try {
				method = 'NIP-44 (fallback)';
				result = await window.nostr.nip44.decrypt(otherPubkey, content);
				if (result && result.trim()) {
					console.debug('[Messages] NIP-44 fallback succeeded');
				}
			} catch (e) {
				console.debug('[Messages] NIP-44 fallback failed:', e);
				lastError = e instanceof Error ? e : new Error(String(e));
			}
		}

		// Try NIP-04 as fallback if not already tried
		if ((!result || result.trim() === '') && !isNip04 && window.nostr?.nip04) {
			try {
				method = 'NIP-04 (fallback)';
				const normalizedContent = normalizeNip04Content(content);
				result = await window.nostr.nip04.decrypt(otherPubkey, normalizedContent);
				if (result && result.trim()) {
					console.debug('[Messages] NIP-04 fallback succeeded');
				}
			} catch (e) {
				console.debug('[Messages] NIP-04 fallback decryption failed:', e);
				lastError = e instanceof Error ? e : new Error(String(e));
			}
		}

		// Try NDK decryption as last resort
		if (!result || result.trim() === '') {
			const signer = ndkService.signer;
			if (signer && 'decrypt' in signer && ndkService.ndk) {
				try {
					method = 'NDK';
					const user = ndkService.ndk.getUser({ pubkey: otherPubkey });
					result = await (signer as any).decrypt(user, event.content);
					if (result && result.trim()) {
						console.debug('[Messages] NDK decryption succeeded');
					}
				} catch (e) {
					console.debug('[Messages] NDK decryption failed:', e);
					lastError = e instanceof Error ? e : new Error(String(e));
				}
			}
		}

		// If all methods failed or returned empty
		if (!result || result.trim() === '') {
			// Try to decode base64 to understand the structure
			let rawBytesInfo: string = 'unknown';
			try {
				const decoded = atob(content);
				const bytes = new Uint8Array(decoded.length);
				for (let i = 0; i < decoded.length; i++) {
					bytes[i] = decoded.charCodeAt(i);
				}
				rawBytesInfo = `len=${bytes.length}, first4=[${bytes.slice(0, 4).join(',')}]`;
			} catch {
				rawBytesInfo = 'invalid base64';
			}

			console.warn('[Messages] All decryption methods failed:', {
				method,
				eventId: event.id,
				from: otherPubkey.slice(0, 8),
				encryptedLength: content?.length,
				contentFormat,
				nip44Version,
				rawBytesInfo,
				contentPreview: content?.slice(0, 50),
				lastError: lastError?.message
			});

			if (lastError) {
				throw lastError;
			}
			// Return empty string instead of undefined
			return '';
		}

		return result;
	}

	/** Encrypt message content for NIP-04 (kind:4 DMs)
	 * NIP-04 spec requires NIP-04 encryption, NOT NIP-44
	 */
	async function encryptMessageNip04(content: string, recipientPubkey: string): Promise<string> {
		try {
			// NIP-04 encryption only (for kind:4 compatibility)
			if (window.nostr?.nip04) {
				console.debug('[Messages] Encrypting with NIP-04 for kind:4');
				return await window.nostr.nip04.encrypt(recipientPubkey, content);
			}

			// Use NDK encryption as fallback
			const signer = ndkService.signer;
			if (signer && 'encrypt' in signer && ndkService.ndk) {
				const user = ndkService.ndk.getUser({ pubkey: recipientPubkey });
				return await (signer as any).encrypt(user, content);
			}

			throw new Error('No NIP-04 encryption method available');
		} catch (e) {
			console.error('Failed to encrypt message:', e);
			throw e;
		}
	}

	/** Load all conversations */
	async function loadConversations(): Promise<void> {
		if (!authStore.pubkey) return;
		
		// Prevent multiple simultaneous loads
		if (isLoading) return;

		isLoading = true;
		error = null;

		try {
			// Load from cache first
			const cachedConversations = await dbHelpers.getConversations();

			conversations = await Promise.all(
				cachedConversations.map(async (c) => ({
					...c,
					profile: await getProfile(c.pubkey),
					messages: [],
					// Reset unread count on load - we'll only count truly new messages
					// This prevents phantom unreads from accumulating
					unread_count: 0
				}))
			);
			
			// Also clear unread in DB for all conversations
			for (const c of cachedConversations) {
				await dbHelpers.clearUnread(c.pubkey);
			}

			// Subscribe to DMs (only if not already subscribed)
			subscribeToDMs();
		} catch (e) {
			console.error('Failed to load conversations:', e);
			error = e instanceof Error ? e.message : 'Failed to load conversations';
		} finally {
			isLoading = false;
		}
	}

	/** Subscribe to incoming DMs (NIP-04 and NIP-17) */
	function subscribeToDMs(): void {
		if (!authStore.pubkey || dmSubscriptionId) return;

		// Mark subscription start time - events after this are truly "new"
		subscriptionStartTime = Math.floor(Date.now() / 1000);
		initialLoadComplete = false;

		// Subscribe to NIP-04 DMs (kind:4)
		const nip04Filter: NDKFilter = {
			kinds: [4],
			'#p': [authStore.pubkey],
			since: Math.floor(Date.now() / 1000) - 86400 // Last 24 hours
		};

		dmSubscriptionId = ndkService.subscribe(nip04Filter, { closeOnEose: false }, {
			onEvent: async (event: NDKEvent) => {
				if (seenEventIds.has(event.id)) return;
				seenEventIds.add(event.id);
				
				const isNewMessage = initialLoadComplete && 
					(event.created_at || 0) >= subscriptionStartTime - 5;
				
				await handleIncomingDM(event, true, isNewMessage, 'nip04');
			},
			onEose: () => {
				initialLoadComplete = true;
			}
		});

		// Subscribe to NIP-17 Gift Wraps (kind:1059)
		const nip17Filter: NDKFilter = {
			kinds: [1059], // Gift Wrap
			'#p': [authStore.pubkey],
			since: Math.floor(Date.now() / 1000) - 86400
		};

		giftWrapSubscriptionId = ndkService.subscribe(nip17Filter, { closeOnEose: false }, {
			onEvent: async (event: NDKEvent) => {
				if (seenEventIds.has(event.id)) return;
				seenEventIds.add(event.id);
				
				const isNewMessage = initialLoadComplete && 
					(event.created_at || 0) >= subscriptionStartTime - 5;
				
				await handleIncomingGiftWrap(event, true, isNewMessage);
			}
		});
	}

	/** Handle incoming NIP-17 Gift Wrap */
	async function handleIncomingGiftWrap(
		event: NDKEvent,
		persist: boolean = true,
		incrementUnread: boolean = false
	): Promise<void> {
		if (!authStore.pubkey || !ndkService.hasPrivateKey) return;

		try {
			// Convert event to format expected by gift-wrap module
			const giftWrapEvent = {
				id: event.id,
				pubkey: event.pubkey,
				created_at: event.created_at || Math.floor(Date.now() / 1000),
				kind: event.kind,
				tags: event.tags,
				content: event.content,
				sig: event.sig || ''
			};

			// Unwrap the gift wrap
			const privkey = ndkService.privateKey;
			if (!privkey) return;
			const privkeyBytes = giftWrap.hexToPrivkey(privkey);
			const { rumor, senderPubkey } = giftWrap.unwrapMessage(giftWrapEvent, privkeyBytes);

			// Create message from rumor
			const message: Message = {
				id: event.id, // Use gift wrap ID as message ID
				pubkey: senderPubkey,
				content: rumor.content,
				created_at: rumor.created_at,
				isOutgoing: senderPubkey === authStore.pubkey,
				decrypted: true,
				protocol: 'nip17'
			};

			// Find the other party (recipient if outgoing, sender if incoming)
			const otherPubkey = message.isOutgoing
				? rumor.tags.find(t => t[0] === 'p')?.[1] || ''
				: senderPubkey;

			if (!otherPubkey) return;

			// Add to conversation
			await addMessageToConversation(message, otherPubkey, persist, incrementUnread);
		} catch (e) {
			console.error('Failed to unwrap gift wrap:', e);
			// Don't throw - just skip this message
		}
	}

	/** Handle incoming DM (NIP-04)
	 * @param event - The NDK event
	 * @param persist - Whether to persist to DB
	 * @param incrementUnread - Whether to increment unread count (only for truly new messages)
	 * @param protocol - Which protocol was used
	 */
	async function handleIncomingDM(
		event: NDKEvent,
		persist: boolean = true,
		incrementUnread: boolean = false,
		protocol: EncryptionProtocol = 'nip04'
	): Promise<void> {
		if (!authStore.pubkey) return;

		// Get the p tag recipient
		const pTag = event.tags.find((t) => t[0] === 'p')?.[1];
		const isOutgoing = event.pubkey === authStore.pubkey;

		// For NIP-04 DMs:
		// - Outgoing: we are sender (event.pubkey = us), recipient is in p-tag
		// - Incoming: sender is event.pubkey, we are recipient (p-tag should = us)

		// Validate that we are involved in this message
		const weAreSender = event.pubkey === authStore.pubkey;
		const weAreRecipient = pTag === authStore.pubkey;

		if (!weAreSender && !weAreRecipient) {
			// This message is not for us - we can't decrypt it
			console.warn('[Messages] DM not involving us, skipping:', {
				eventId: event.id.slice(0, 8),
				eventPubkey: event.pubkey.slice(0, 16),
				pTag: pTag?.slice(0, 16),
				myPubkey: authStore.pubkey.slice(0, 16)
			});
			return;
		}

		// Determine the other party (the one we need to decrypt with)
		const otherPubkey = isOutgoing ? pTag : event.pubkey;

		console.debug('[Messages] Processing DM:', {
			eventId: event.id.slice(0, 8),
			eventPubkey: event.pubkey,  // FULL pubkey for debugging
			pTag: pTag,  // FULL p-tag for debugging
			myPubkey: authStore.pubkey,  // FULL my pubkey
			isOutgoing,
			weAreSender,
			weAreRecipient,
			otherPubkey: otherPubkey,  // FULL other pubkey we'll decrypt with
			contentLen: event.content?.length,
			contentFormat: getContentFormat(event.content || '')
		});

		if (!otherPubkey) {
			console.warn('[Messages] No otherPubkey found for DM', event.id.slice(0, 8));
			return;
		}

		// Try to decrypt
		let content: string;
		let decrypted = true;
		let decryptError: string | undefined;

		try {
			content = await decryptMessage(event, otherPubkey);

			// Debug: log incoming message content (especially for call messages)
			if (content && (content.includes('call_invite') || content.includes('call_response'))) {
				console.log('[Messages] Received call message:', {
					from: otherPubkey.slice(0, 8),
					content: content.slice(0, 100),
					isOutgoing: event.pubkey === authStore.pubkey
				});
			}
		} catch (e) {
			content = '[Encrypted message]';
			decrypted = false;
			decryptError = e instanceof Error ? e.message : 'Decryption failed';
			console.error('[Messages] Decryption error for message from', otherPubkey.slice(0, 8), e);
		}

		const message: Message = {
			id: event.id,
			pubkey: event.pubkey,
			content,
			created_at: event.created_at || Math.floor(Date.now() / 1000),
			isOutgoing: event.pubkey === authStore.pubkey,
			decrypted,
			error: decryptError,
			protocol
		};

		await addMessageToConversation(message, otherPubkey, persist, incrementUnread);
	}

	/** Add message to conversation (shared by NIP-04 and NIP-17 handlers) */
	async function addMessageToConversation(
		message: Message,
		otherPubkey: string,
		persist: boolean = true,
		incrementUnread: boolean = false
	): Promise<void> {
		const existingIndex = conversations.findIndex((c) => c.pubkey === otherPubkey);

		if (existingIndex >= 0) {
			// Add message to existing conversation
			const conv = conversations[existingIndex];
			const messageExists = conv.messages.some((m) => m.id === message.id);

			if (!messageExists) {
				// Only increment unread if:
				// 1. This is a truly new message (incrementUnread = true)
				// 2. Conversation is not currently active
				// 3. Message is not from us (outgoing)
				const shouldIncrement = incrementUnread &&
					activeConversation !== otherPubkey &&
					!message.isOutgoing;

				const newUnreadCount = shouldIncrement ? conv.unread_count + 1 : conv.unread_count;

				// Send push notification for new incoming messages
				if (shouldIncrement && conv.profile) {
					const authorName = conv.profile.display_name || conv.profile.name || otherPubkey.slice(0, 8);
					const preview = message.decrypted ? (message.content || 'New message') : 'Encrypted message';
					pushNotifications.notifyDM(authorName, preview, otherPubkey);
				}
				
				// Only update preview if this message is chronologically newer
				const shouldUpdatePreview = message.created_at >= (conv.last_message_at || 0);
				const newLastMessageAt = shouldUpdatePreview ? message.created_at : conv.last_message_at;
				const newLastMessagePreview = shouldUpdatePreview ? (message.content || '').slice(0, 50) : conv.last_message_preview;
				
				conversations = [
					{
						...conv,
						messages: [...conv.messages, message].sort((a, b) => a.created_at - b.created_at),
						last_message_at: newLastMessageAt,
						last_message_preview: newLastMessagePreview,
						unread_count: newUnreadCount
					},
					...conversations.slice(0, existingIndex),
					...conversations.slice(existingIndex + 1)
				];

				if (persist && shouldUpdatePreview) {
					await dbHelpers.saveConversation({
						pubkey: otherPubkey,
						last_message_at: newLastMessageAt,
						last_message_preview: newLastMessagePreview,
						unread_count: newUnreadCount
					});
				}
			}
		} else {
			// Create new conversation
			const profile = await getProfile(otherPubkey);
			
			// Only set unread to 1 if this is a truly new incoming message
			const newUnreadCount = (incrementUnread && !message.isOutgoing && activeConversation !== otherPubkey) ? 1 : 0;
			
			const newConv: ConversationWithMessages = {
				pubkey: otherPubkey,
				profile,
				messages: [message],
				last_message_at: message.created_at,
				last_message_preview: (message.content || '').slice(0, 50),
				unread_count: newUnreadCount
			};

			conversations = [newConv, ...conversations];

			// Save to DB
			if (persist) {
				await dbHelpers.saveConversation({
					pubkey: otherPubkey,
					last_message_at: message.created_at,
					last_message_preview: (message.content || '').slice(0, 50),
					unread_count: newConv.unread_count
				});
			}
		}
	}

	/** Open a conversation */
	async function openConversation(pubkeyOrNpub: string): Promise<void> {
		// Convert npub to hex if needed
		const pubkey = validatePubkey(pubkeyOrNpub);
		if (!pubkey) {
			error = 'Invalid public key or npub format';
			throw new Error('Invalid public key or npub format');
		}

		activeConversation = pubkey;

		// Debug: Test encryption roundtrip with this pubkey
		if (window.nostr?.nip04) {
			testEncryptionWithPubkey(pubkey).then(result => {
				console.log('[Messages] Encryption test with', pubkey.slice(0, 16), ':', result);
			});
		}

		// Clear unread count in memory and DB
		const convIndex = conversations.findIndex((c) => c.pubkey === pubkey);
		if (convIndex >= 0) {
			conversations = conversations.map((c) =>
				c.pubkey === pubkey ? { ...c, unread_count: 0 } : c
			);
			// Await the DB update to ensure it persists
			await dbHelpers.clearUnread(pubkey);
		}

		// Load message history
		await loadMessageHistory(pubkey);

		// Ensure unread is cleared after loading history (defensive)
		await dbHelpers.clearUnread(pubkey);
	}

	/** Load message history for a conversation */
	async function loadMessageHistory(pubkeyOrNpub: string): Promise<void> {
		if (!authStore.pubkey) return;

		// Convert npub to hex if needed (defensive - should already be hex from caller)
		const pubkey = validatePubkey(pubkeyOrNpub);
		if (!pubkey) {
			console.error('Invalid pubkey in loadMessageHistory:', pubkeyOrNpub);
			return;
		}

		isLoading = true;

		try {
			if (!ndkService.ndk) {
				console.warn('[Messages] NDK not initialized');
				return;
			}

			// Load NIP-04 messages (kind:4)
			const nip04Filter: NDKFilter = {
				kinds: [4],
				authors: [authStore.pubkey, pubkey],
				'#p': [authStore.pubkey, pubkey],
				limit: 100
			};

			const nip04Events = await ndkService.ndk.fetchEvents(nip04Filter);

			for (const event of nip04Events) {
				seenEventIds.add(event.id);
				await handleIncomingDM(event, false, false, 'nip04');
			}

			// Load NIP-17 Gift Wraps (kind:1059) if private key available
			if (ndkService.hasPrivateKey) {
				const nip17Filter: NDKFilter = {
					kinds: [1059],
					'#p': [authStore.pubkey],
					limit: 100
				};

				const nip17Events = await ndkService.ndk.fetchEvents(nip17Filter);

				for (const event of nip17Events) {
					if (seenEventIds.has(event.id)) continue;
					seenEventIds.add(event.id);
					await handleIncomingGiftWrap(event, false, false);
				}
			}

			// Update conversation persistence after batch load
			// Always set unread_count to 0 since we're viewing the conversation
			const conv = conversations.find(c => c.pubkey === pubkey);
			if (conv) {
				await dbHelpers.saveConversation({
					pubkey: conv.pubkey,
					last_message_at: conv.last_message_at,
					last_message_preview: conv.last_message_preview,
					unread_count: 0 // Force 0 since conversation is open
				});
			}
		} catch (e) {
			console.error('Failed to load message history:', e);
		} finally {
			isLoading = false;
		}
	}

	/** Send a message using NIP-17 (preferred) or NIP-04 (fallback) */
	async function sendMessage(recipientPubkeyOrNpub: string, content: string): Promise<void> {
		if (!authStore.pubkey) throw new Error('Not authenticated');

		// Convert npub to hex if needed
		const recipientPubkey = validatePubkey(recipientPubkeyOrNpub);
		if (!recipientPubkey) {
			error = 'Invalid recipient public key or npub format';
			throw new Error('Invalid recipient public key or npub format');
		}

		isSending = true;

		try {
			let message: Message;
			let usedProtocol: EncryptionProtocol = 'nip04';

			// Try NIP-17 if we have a private key and prefer it
			if (preferNip17 && ndkService.hasPrivateKey) {
				try {
					message = await sendNip17Message(recipientPubkey, content);
					usedProtocol = 'nip17';
				} catch (e) {
					console.warn('NIP-17 failed, falling back to NIP-04:', e);
					message = await sendNip04Message(recipientPubkey, content);
					usedProtocol = 'nip04';
				}
			} else {
				// Use NIP-04 (extension or legacy)
				message = await sendNip04Message(recipientPubkey, content);
			}

			message.protocol = usedProtocol;

			// Add to conversation
			const convIndex = conversations.findIndex((c) => c.pubkey === recipientPubkey);
			if (convIndex >= 0) {
				const updatedConv = {
					...conversations[convIndex],
					messages: [...conversations[convIndex].messages, message],
					last_message_at: message.created_at,
					last_message_preview: (content || '').slice(0, 50)
				};

				conversations = conversations.map((c) =>
					c.pubkey === recipientPubkey ? updatedConv : c
				);

				// Persist updated conversation metadata
				dbHelpers.saveConversation({
					pubkey: recipientPubkey,
					last_message_at: message.created_at,
					last_message_preview: (content || '').slice(0, 50),
					unread_count: updatedConv.unread_count
				});
			}
		} catch (e) {
			console.error('Failed to send message:', e);
			error = e instanceof Error ? e.message : 'Failed to send message';
			throw e;
		} finally {
			isSending = false;
		}
	}

	/** Send message using NIP-17 Gift Wrap */
	async function sendNip17Message(recipientPubkey: string, content: string): Promise<Message> {
		const privkey = ndkService.privateKey;
		if (!privkey || !authStore.pubkey) {
			throw new Error('Private key required for NIP-17');
		}

		const privkeyBytes = giftWrap.hexToPrivkey(privkey);
		const NDKEvent = (await import('@nostr-dev-kit/ndk')).NDKEvent;
		
		// Create wrapped message for recipient
		const { giftWrap: wrappedEvent, rumor } = giftWrap.wrapMessage(
			content,
			privkeyBytes,
			recipientPubkey
		);

		// Convert to NDK event and publish for recipient
		const event = new NDKEvent(ndkService.ndk);
		event.kind = wrappedEvent.kind;
		event.content = wrappedEvent.content;
		event.tags = wrappedEvent.tags;
		event.created_at = wrappedEvent.created_at;
		event.pubkey = wrappedEvent.pubkey;
		event.sig = wrappedEvent.sig;

		await event.publish();

		// Also send a copy to ourselves for multi-device sync
		// This allows other devices to see sent messages
		const { giftWrap: selfWrap } = giftWrap.wrapMessage(
			content,
			privkeyBytes,
			authStore.pubkey // wrap for ourselves
		);

		const selfEvent = new NDKEvent(ndkService.ndk);
		selfEvent.kind = selfWrap.kind;
		selfEvent.content = selfWrap.content;
		selfEvent.tags = selfWrap.tags;
		selfEvent.created_at = selfWrap.created_at;
		selfEvent.pubkey = selfWrap.pubkey;
		selfEvent.sig = selfWrap.sig;

		// Publish self-wrap (fire and forget, don't block on this)
		selfEvent.publish().catch(e => console.warn('Failed to publish self-wrap:', e));

		return {
			id: wrappedEvent.id,
			pubkey: authStore.pubkey,
			content,
			created_at: rumor.created_at,
			isOutgoing: true,
			decrypted: true,
			protocol: 'nip17'
		};
	}

	/** Send message using NIP-04 (legacy) */
	async function sendNip04Message(recipientPubkey: string, content: string): Promise<Message> {
		if (!authStore.pubkey) throw new Error('Not authenticated');

		// Encrypt the content using NIP-04 (required for kind:4 compatibility)
		const encrypted = await encryptMessageNip04(content, recipientPubkey);

		// Create and publish the event
		const NDKEvent = (await import('@nostr-dev-kit/ndk')).NDKEvent;
		const event = new NDKEvent(ndkService.ndk);
		event.kind = 4;
		event.content = encrypted;
		event.tags = [['p', recipientPubkey]];

		await ndkService.publish(event);

		return {
			id: event.id,
			pubkey: authStore.pubkey,
			content,
			created_at: event.created_at || Math.floor(Date.now() / 1000),
			isOutgoing: true,
			decrypted: true,
			protocol: 'nip04'
		};
	}

	/** Start a new conversation */
	async function startConversation(pubkeyOrNpub: string): Promise<void> {
		// Convert npub to hex if needed
		const pubkey = validatePubkey(pubkeyOrNpub);
		if (!pubkey) {
			error = 'Invalid public key or npub format';
			throw new Error('Invalid public key or npub format');
		}

		// Check if conversation already exists
		const existing = conversations.find((c) => c.pubkey === pubkey);
		if (existing) {
			await openConversation(pubkey);
			return;
		}

		// Create new conversation
		const profile = await getProfile(pubkey);
		const newConv: ConversationWithMessages = {
			pubkey,
			profile,
			messages: [],
			last_message_at: 0,
			unread_count: 0
		};

		conversations = [newConv, ...conversations];
		activeConversation = pubkey;

		// Load any existing message history
		await loadMessageHistory(pubkey);
	}

	/** Close active conversation */
	function closeConversation(): void {
		activeConversation = null;
	}

	/** Delete a conversation (local only) */
	async function deleteConversation(pubkeyOrNpub: string): Promise<void> {
		const pubkey = validatePubkey(pubkeyOrNpub);
		if (!pubkey) {
			throw new Error('Invalid public key');
		}

		// Close if active
		if (activeConversation === pubkey) {
			activeConversation = null;
		}

		// Remove from memory
		conversations = conversations.filter(c => c.pubkey !== pubkey);

		// Remove from database
		await dbHelpers.deleteConversation(pubkey);
	}

	/** Get active conversation data */
	function getActiveConversation(): ConversationWithMessages | null {
		if (!activeConversation) return null;
		return conversations.find((c) => c.pubkey === activeConversation) || null;
	}

	/** Cleanup */
	function cleanup(): void {
		if (dmSubscriptionId) {
			ndkService.unsubscribe(dmSubscriptionId);
			dmSubscriptionId = null;
		}
		if (giftWrapSubscriptionId) {
			ndkService.unsubscribe(giftWrapSubscriptionId);
			giftWrapSubscriptionId = null;
		}
		activeConversation = null;
		// Don't clear seenEventIds - we want to persist knowledge of seen events
		// Reset initial load state so next subscription can properly track new vs old
		initialLoadComplete = false;
	}

	/** Set preference for NIP-17 */
	function setPreferNip17(value: boolean): void {
		preferNip17 = value;
	}

	return {
		// State
		get conversations() {
			return conversations;
		},
		get activeConversation() {
			return activeConversation;
		},
		get isLoading() {
			return isLoading;
		},
		get isSending() {
			return isSending;
		},
		get error() {
			return error;
		},
		get totalUnreadCount() {
			return conversations.reduce((sum, c) => sum + c.unread_count, 0);
		},
		get preferNip17() {
			return preferNip17;
		},

		// Actions
		loadConversations,
		openConversation,
		sendMessage,
		startConversation,
		closeConversation,
		deleteConversation,
		getActiveConversation,
		cleanup,
		setPreferNip17
	};
}

/** Messages store singleton */
export const messagesStore = createMessagesStore();

export default messagesStore;
