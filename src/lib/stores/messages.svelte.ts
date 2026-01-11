import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
import ndkService from '$services/ndk';
import { dbHelpers, type Conversation, type UserProfile } from '$db';
import authStore from './auth.svelte';

/** Message with metadata */
export interface Message {
	id: string;
	pubkey: string;
	content: string;
	created_at: number;
	isOutgoing: boolean;
	decrypted: boolean;
	error?: string;
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

	/** Decrypt message content (NIP-04 for now, NIP-44 preferred) */
	async function decryptMessage(event: NDKEvent, otherPubkey: string): Promise<string> {
		try {
			// Try NIP-44 first if available
			if (window.nostr?.nip44) {
				return await window.nostr.nip44.decrypt(otherPubkey, event.content);
			}

			// Fall back to NIP-04
			if (window.nostr?.nip04) {
				return await window.nostr.nip04.decrypt(otherPubkey, event.content);
			}

			// Use NDK decryption
			const signer = ndkService.signer;
			if (signer && 'decrypt' in signer) {
				const user = ndkService.ndk.getUser({ pubkey: otherPubkey });
				return await (signer as any).decrypt(user, event.content);
			}

			throw new Error('No decryption method available');
		} catch (e) {
			console.error('Failed to decrypt message:', e);
			throw e;
		}
	}

	/** Encrypt message content */
	async function encryptMessage(content: string, recipientPubkey: string): Promise<string> {
		try {
			// Try NIP-44 first if available
			if (window.nostr?.nip44) {
				return await window.nostr.nip44.encrypt(recipientPubkey, content);
			}

			// Fall back to NIP-04
			if (window.nostr?.nip04) {
				return await window.nostr.nip04.encrypt(recipientPubkey, content);
			}

			// Use NDK encryption
			const signer = ndkService.signer;
			if (signer && 'encrypt' in signer) {
				const user = ndkService.ndk.getUser({ pubkey: recipientPubkey });
				return await (signer as any).encrypt(user, content);
			}

			throw new Error('No encryption method available');
		} catch (e) {
			console.error('Failed to encrypt message:', e);
			throw e;
		}
	}

	/** Load all conversations */
	async function loadConversations(): Promise<void> {
		if (!authStore.pubkey) return;

		isLoading = true;
		error = null;

		try {
			// Load from cache first
			const cachedConversations = await dbHelpers.getConversations();

			conversations = await Promise.all(
				cachedConversations.map(async (c) => ({
					...c,
					profile: await getProfile(c.pubkey),
					messages: []
				}))
			);

			// Subscribe to DMs
			subscribeToDMs();
		} catch (e) {
			console.error('Failed to load conversations:', e);
			error = e instanceof Error ? e.message : 'Failed to load conversations';
		} finally {
			isLoading = false;
		}
	}

	/** Subscribe to incoming DMs */
	function subscribeToDMs(): void {
		if (!authStore.pubkey || dmSubscriptionId) return;

		const filter: NDKFilter = {
			kinds: [4], // NIP-04 DMs
			'#p': [authStore.pubkey],
			since: Math.floor(Date.now() / 1000) - 86400 // Last 24 hours
		};

		dmSubscriptionId = ndkService.subscribe(filter, { closeOnEose: false }, {
			onEvent: async (event: NDKEvent) => {
				await handleIncomingDM(event);
			}
		});
	}

	/** Handle incoming DM */
	async function handleIncomingDM(event: NDKEvent): Promise<void> {
		if (!authStore.pubkey) return;

		// Determine the other party
		const otherPubkey = event.pubkey === authStore.pubkey
			? event.tags.find((t) => t[0] === 'p')?.[1] || ''
			: event.pubkey;

		if (!otherPubkey) return;

		// Try to decrypt
		let content: string;
		let decrypted = true;
		let decryptError: string | undefined;

		try {
			content = await decryptMessage(event, otherPubkey);
		} catch (e) {
			content = '[Encrypted message]';
			decrypted = false;
			decryptError = e instanceof Error ? e.message : 'Decryption failed';
		}

		const message: Message = {
			id: event.id,
			pubkey: event.pubkey,
			content,
			created_at: event.created_at || Math.floor(Date.now() / 1000),
			isOutgoing: event.pubkey === authStore.pubkey,
			decrypted,
			error: decryptError
		};

		// Find or create conversation
		const existingIndex = conversations.findIndex((c) => c.pubkey === otherPubkey);

		if (existingIndex >= 0) {
			// Add message to existing conversation
			const conv = conversations[existingIndex];
			const messageExists = conv.messages.some((m) => m.id === message.id);

			if (!messageExists) {
				conversations = [
					{
						...conv,
						messages: [...conv.messages, message].sort((a, b) => a.created_at - b.created_at),
						last_message_at: message.created_at,
						last_message_preview: content.slice(0, 50),
						unread_count: activeConversation === otherPubkey ? 0 : conv.unread_count + 1
					},
					...conversations.slice(0, existingIndex),
					...conversations.slice(existingIndex + 1)
				];
			}
		} else {
			// Create new conversation
			const profile = await getProfile(otherPubkey);
			const newConv: ConversationWithMessages = {
				pubkey: otherPubkey,
				profile,
				messages: [message],
				last_message_at: message.created_at,
				last_message_preview: content.slice(0, 50),
				unread_count: activeConversation === otherPubkey ? 0 : 1
			};

			conversations = [newConv, ...conversations];

			// Save to DB
			dbHelpers.saveConversation({
				pubkey: otherPubkey,
				last_message_at: message.created_at,
				last_message_preview: content.slice(0, 50),
				unread_count: newConv.unread_count
			});
		}
	}

	/** Open a conversation */
	async function openConversation(pubkey: string): Promise<void> {
		activeConversation = pubkey;

		// Clear unread count
		const convIndex = conversations.findIndex((c) => c.pubkey === pubkey);
		if (convIndex >= 0) {
			conversations = conversations.map((c) =>
				c.pubkey === pubkey ? { ...c, unread_count: 0 } : c
			);
			dbHelpers.clearUnread(pubkey);
		}

		// Load message history
		await loadMessageHistory(pubkey);
	}

	/** Load message history for a conversation */
	async function loadMessageHistory(pubkey: string): Promise<void> {
		if (!authStore.pubkey) return;

		isLoading = true;

		try {
			const filter: NDKFilter = {
				kinds: [4],
				authors: [authStore.pubkey, pubkey],
				'#p': [authStore.pubkey, pubkey],
				limit: 100
			};

			const events = await ndkService.ndk.fetchEvents(filter);

			for (const event of events) {
				await handleIncomingDM(event);
			}
		} catch (e) {
			console.error('Failed to load message history:', e);
		} finally {
			isLoading = false;
		}
	}

	/** Send a message */
	async function sendMessage(recipientPubkey: string, content: string): Promise<void> {
		if (!authStore.pubkey) throw new Error('Not authenticated');

		isSending = true;

		try {
			// Encrypt the content
			const encrypted = await encryptMessage(content, recipientPubkey);

			// Create and publish the event
			const event = new (await import('@nostr-dev-kit/ndk')).NDKEvent(ndkService.ndk);
			event.kind = 4;
			event.content = encrypted;
			event.tags = [['p', recipientPubkey]];

			await ndkService.publish(event);

			// Add to local messages
			const message: Message = {
				id: event.id,
				pubkey: authStore.pubkey,
				content,
				created_at: event.created_at || Math.floor(Date.now() / 1000),
				isOutgoing: true,
				decrypted: true
			};

			const convIndex = conversations.findIndex((c) => c.pubkey === recipientPubkey);
			if (convIndex >= 0) {
				conversations = conversations.map((c) =>
					c.pubkey === recipientPubkey
						? {
								...c,
								messages: [...c.messages, message],
								last_message_at: message.created_at,
								last_message_preview: content.slice(0, 50)
							}
						: c
				);
			}
		} catch (e) {
			console.error('Failed to send message:', e);
			error = e instanceof Error ? e.message : 'Failed to send message';
			throw e;
		} finally {
			isSending = false;
		}
	}

	/** Start a new conversation */
	async function startConversation(pubkey: string): Promise<void> {
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
	}

	/** Close active conversation */
	function closeConversation(): void {
		activeConversation = null;
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
		activeConversation = null;
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

		// Actions
		loadConversations,
		openConversation,
		sendMessage,
		startConversation,
		closeConversation,
		getActiveConversation,
		cleanup
	};
}

/** Messages store singleton */
export const messagesStore = createMessagesStore();

export default messagesStore;
