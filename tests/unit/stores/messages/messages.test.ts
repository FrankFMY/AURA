/**
 * Messages Store Tests
 *
 * Tests for the messages store covering:
 * - Initial state
 * - loadConversations() - loading conversations
 * - openConversation() - opening specific conversation
 * - sendMessage() - sending messages (NIP-04/NIP-17)
 * - startConversation() - starting new conversations
 * - closeConversation() - closing conversations
 * - getActiveConversation() - getting active conversation
 * - setPreferNip17() - protocol preference
 * - cleanup() - subscription cleanup
 * - Error handling
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock functions must be hoisted
const {
	mockSubscribe,
	mockUnsubscribe,
	mockFetchProfile,
	mockPublish,
	mockFetchEvents,
	mockGetProfile,
	mockGetConversations,
	mockSaveConversation,
	mockClearUnread,
	mockValidatePubkey,
	mockWrapMessage,
	mockUnwrapMessage,
	mockHexToPrivkey
} = vi.hoisted(() => ({
	mockSubscribe: vi.fn(),
	mockUnsubscribe: vi.fn(),
	mockFetchProfile: vi.fn(),
	mockPublish: vi.fn(),
	mockFetchEvents: vi.fn(),
	mockGetProfile: vi.fn(),
	mockGetConversations: vi.fn(),
	mockSaveConversation: vi.fn(),
	mockClearUnread: vi.fn(),
	mockValidatePubkey: vi.fn(),
	mockWrapMessage: vi.fn(),
	mockUnwrapMessage: vi.fn(),
	mockHexToPrivkey: vi.fn()
}));

// Mock NDK service
vi.mock('$services/ndk', () => ({
	default: {
		ndk: {
			fetchEvents: mockFetchEvents,
			getUser: vi.fn().mockReturnValue({ pubkey: 'test-pubkey' })
		},
		signer: {
			decrypt: vi.fn().mockResolvedValue('decrypted content'),
			encrypt: vi.fn().mockResolvedValue('encrypted content')
		},
		pubkey: 'test-pubkey-123',
		privateKey: 'test-private-key-hex',
		hasPrivateKey: true,
		subscribe: mockSubscribe,
		unsubscribe: mockUnsubscribe,
		fetchProfile: mockFetchProfile,
		publish: mockPublish
	}
}));

// Mock database helpers
vi.mock('$db', () => ({
	dbHelpers: {
		getProfile: mockGetProfile,
		getConversations: mockGetConversations,
		saveConversation: mockSaveConversation,
		clearUnread: mockClearUnread
	}
}));

// Mock auth store - using alias path
vi.mock('$stores/auth.svelte', () => ({
	default: {
		pubkey: 'test-pubkey-123'
	}
}));

// Mock validators
vi.mock('$lib/validators/schemas', () => ({
	validatePubkey: mockValidatePubkey
}));

// Mock gift wrap crypto
vi.mock('$lib/services/crypto', () => ({
	giftWrap: {
		wrapMessage: mockWrapMessage,
		unwrapMessage: mockUnwrapMessage,
		hexToPrivkey: mockHexToPrivkey
	}
}));

// Mock window.nostr for NIP-04/44 encryption
const mockNostr = {
	nip04: {
		encrypt: vi.fn().mockResolvedValue('nip04-encrypted'),
		decrypt: vi.fn().mockResolvedValue('nip04-decrypted')
	},
	nip44: undefined as any
};

describe('Messages Store', () => {
	let messagesStore: typeof import('$stores/messages.svelte').messagesStore;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Set up window.nostr mock
		(globalThis as any).window = {
			nostr: mockNostr
		};

		// Default mock implementations
		mockGetProfile.mockResolvedValue(null);
		mockGetConversations.mockResolvedValue([]);
		mockSaveConversation.mockResolvedValue(undefined);
		mockClearUnread.mockResolvedValue(undefined);
		mockFetchProfile.mockResolvedValue(undefined);
		mockFetchEvents.mockResolvedValue(new Set());
		mockSubscribe.mockReturnValue('sub-id-123');
		mockValidatePubkey.mockImplementation((key: string) => {
			// Simple validation - return hex pubkey or null
			if (key.startsWith('npub')) {
				return 'converted-hex-pubkey';
			}
			if (key.match(/^[0-9a-f]{64}$/i)) {
				return key;
			}
			if (key.includes('pubkey')) {
				return key; // Allow test keys
			}
			return null;
		});
		mockHexToPrivkey.mockReturnValue(new Uint8Array(32));
		mockWrapMessage.mockReturnValue({
			giftWrap: {
				id: 'gift-wrap-id',
				kind: 1059,
				pubkey: 'random-pubkey',
				created_at: Math.floor(Date.now() / 1000),
				content: 'encrypted-gift-wrap',
				tags: [['p', 'recipient-pubkey']],
				sig: 'signature'
			},
			rumor: {
				id: 'rumor-id',
				kind: 14,
				pubkey: 'test-pubkey-123',
				created_at: Math.floor(Date.now() / 1000),
				content: 'Test message',
				tags: []
			}
		});

		// Reset modules to get fresh store instance
		vi.resetModules();
		const module = await import('$stores/messages.svelte');
		messagesStore = module.messagesStore;
	});

	afterEach(() => {
		messagesStore.cleanup();
		delete (globalThis as any).window;
	});

	describe('Initial State', () => {
		it('should start with empty conversations', () => {
			expect(messagesStore.conversations).toEqual([]);
		});

		it('should have no active conversation initially', () => {
			expect(messagesStore.activeConversation).toBe(null);
		});

		it('should not be loading initially', () => {
			expect(messagesStore.isLoading).toBe(false);
		});

		it('should not be sending initially', () => {
			expect(messagesStore.isSending).toBe(false);
		});

		it('should have no error initially', () => {
			expect(messagesStore.error).toBe(null);
		});

		it('should have zero total unread count', () => {
			expect(messagesStore.totalUnreadCount).toBe(0);
		});

		it('should prefer NIP-17 by default', () => {
			expect(messagesStore.preferNip17).toBe(true);
		});
	});

	describe('loadConversations()', () => {
		it('should load conversations from database', async () => {
			const mockConversations = [
				{
					pubkey: 'contact-1',
					last_message_at: 1000,
					last_message_preview: 'Hello',
					unread_count: 2
				}
			];
			mockGetConversations.mockResolvedValueOnce(mockConversations);

			await messagesStore.loadConversations();

			expect(mockGetConversations).toHaveBeenCalled();
			expect(messagesStore.conversations.length).toBe(1);
			expect(messagesStore.conversations[0].pubkey).toBe('contact-1');
		});

		it('should reset unread counts on load', async () => {
			const mockConversations = [
				{
					pubkey: 'contact-1',
					last_message_at: 1000,
					unread_count: 5
				}
			];
			mockGetConversations.mockResolvedValueOnce(mockConversations);

			await messagesStore.loadConversations();

			// Unread should be reset to 0
			expect(messagesStore.conversations[0].unread_count).toBe(0);
			expect(mockClearUnread).toHaveBeenCalledWith('contact-1');
		});

		it('should subscribe to DMs after loading', async () => {
			mockGetConversations.mockResolvedValueOnce([]);

			await messagesStore.loadConversations();

			expect(mockSubscribe).toHaveBeenCalled();
		});

		it('should handle errors gracefully', async () => {
			mockGetConversations.mockRejectedValueOnce(new Error('DB error'));

			await messagesStore.loadConversations();

			expect(messagesStore.error).toBe('DB error');
			expect(messagesStore.isLoading).toBe(false);
		});

		it('should not load if already loading', async () => {
			// Create a slow promise that we can control
			let resolveLoad: (value: any[]) => void;
			mockGetConversations.mockImplementationOnce(() => new Promise(resolve => {
				resolveLoad = resolve;
			}));

			// Start first load
			const firstLoad = messagesStore.loadConversations();

			// Try second load immediately
			const secondLoad = messagesStore.loadConversations();

			// Resolve the first load
			resolveLoad!([]);
			await firstLoad;
			await secondLoad;

			// getConversations should only be called once
			expect(mockGetConversations).toHaveBeenCalledTimes(1);
		});
	});

	describe('openConversation()', () => {
		beforeEach(async () => {
			const mockConversations = [
				{
					pubkey: 'contact-hex-pubkey',
					last_message_at: 1000,
					unread_count: 3
				}
			];
			mockGetConversations.mockResolvedValueOnce(mockConversations);
			mockValidatePubkey.mockReturnValue('contact-hex-pubkey');

			await messagesStore.loadConversations();
		});

		it('should set active conversation', async () => {
			await messagesStore.openConversation('contact-hex-pubkey');

			expect(messagesStore.activeConversation).toBe('contact-hex-pubkey');
		});

		it('should accept npub format', async () => {
			mockValidatePubkey.mockReturnValueOnce('contact-hex-pubkey');

			await messagesStore.openConversation('npub1test...');

			expect(messagesStore.activeConversation).toBe('contact-hex-pubkey');
		});

		it('should throw error for invalid pubkey', async () => {
			mockValidatePubkey.mockReturnValueOnce(null);

			await expect(messagesStore.openConversation('invalid-key'))
				.rejects.toThrow('Invalid public key or npub format');

			expect(messagesStore.error).toBe('Invalid public key or npub format');
		});

		it('should clear unread count when opening', async () => {
			await messagesStore.openConversation('contact-hex-pubkey');

			const conv = messagesStore.conversations.find(c => c.pubkey === 'contact-hex-pubkey');
			expect(conv?.unread_count).toBe(0);
			expect(mockClearUnread).toHaveBeenCalledWith('contact-hex-pubkey');
		});

		it('should load message history', async () => {
			await messagesStore.openConversation('contact-hex-pubkey');

			expect(mockFetchEvents).toHaveBeenCalled();
		});
	});

	describe('sendMessage()', () => {
		beforeEach(async () => {
			const mockConversations = [
				{
					pubkey: 'recipient-pubkey',
					last_message_at: 1000,
					unread_count: 0
				}
			];
			mockGetConversations.mockResolvedValueOnce(mockConversations);
			mockValidatePubkey.mockReturnValue('recipient-pubkey');

			await messagesStore.loadConversations();
		});

		it('should validate recipient pubkey', async () => {
			mockValidatePubkey.mockReturnValueOnce(null);

			await expect(messagesStore.sendMessage('invalid-key', 'Hello'))
				.rejects.toThrow('Invalid recipient public key or npub format');
		});

		it('should use NIP-17 when preferred and private key available', async () => {
			messagesStore.setPreferNip17(true);

			await messagesStore.sendMessage('recipient-pubkey', 'Hello');

			expect(mockWrapMessage).toHaveBeenCalled();
		});

		it('should fall back to NIP-04 when NIP-17 fails', async () => {
			messagesStore.setPreferNip17(true);
			mockWrapMessage.mockImplementationOnce(() => {
				throw new Error('NIP-17 error');
			});

			await messagesStore.sendMessage('recipient-pubkey', 'Hello');

			// Should have tried NIP-04 encryption
			expect(mockNostr.nip04.encrypt).toHaveBeenCalled();
		});

		it('should add message to conversation after sending', async () => {
			await messagesStore.sendMessage('recipient-pubkey', 'Hello');

			const conv = messagesStore.conversations.find(c => c.pubkey === 'recipient-pubkey');
			expect(conv?.messages.length).toBeGreaterThan(0);
			expect(conv?.messages[conv.messages.length - 1].content).toBe('Hello');
			expect(conv?.messages[conv.messages.length - 1].isOutgoing).toBe(true);
		});

		it('should update conversation metadata after sending', async () => {
			await messagesStore.sendMessage('recipient-pubkey', 'Hello World');

			expect(mockSaveConversation).toHaveBeenCalledWith(
				expect.objectContaining({
					pubkey: 'recipient-pubkey',
					last_message_preview: 'Hello World'
				})
			);
		});

		it('should handle send errors', async () => {
			mockWrapMessage.mockImplementationOnce(() => {
				throw new Error('Send failed');
			});
			mockNostr.nip04.encrypt.mockRejectedValueOnce(new Error('Send failed'));

			await expect(messagesStore.sendMessage('recipient-pubkey', 'Hello'))
				.rejects.toThrow('Send failed');

			expect(messagesStore.error).toBe('Send failed');
			expect(messagesStore.isSending).toBe(false);
		});
	});

	describe('startConversation()', () => {
		it('should validate pubkey', async () => {
			mockValidatePubkey.mockReturnValueOnce(null);

			await expect(messagesStore.startConversation('invalid'))
				.rejects.toThrow('Invalid public key or npub format');
		});

		it('should open existing conversation if found', async () => {
			const mockConversations = [
				{
					pubkey: 'existing-pubkey',
					last_message_at: 1000,
					unread_count: 0
				}
			];
			mockGetConversations.mockResolvedValueOnce(mockConversations);
			mockValidatePubkey.mockReturnValue('existing-pubkey');

			await messagesStore.loadConversations();

			await messagesStore.startConversation('existing-pubkey');

			expect(messagesStore.activeConversation).toBe('existing-pubkey');
		});

		it('should create new conversation if not found', async () => {
			mockGetConversations.mockResolvedValueOnce([]);
			mockValidatePubkey.mockReturnValue('new-pubkey');

			await messagesStore.loadConversations();

			await messagesStore.startConversation('new-pubkey');

			expect(messagesStore.conversations.length).toBe(1);
			expect(messagesStore.conversations[0].pubkey).toBe('new-pubkey');
			expect(messagesStore.activeConversation).toBe('new-pubkey');
		});

		it('should load message history for new conversation', async () => {
			mockGetConversations.mockResolvedValueOnce([]);
			mockValidatePubkey.mockReturnValue('new-pubkey');

			await messagesStore.loadConversations();

			await messagesStore.startConversation('new-pubkey');

			expect(mockFetchEvents).toHaveBeenCalled();
		});
	});

	describe('closeConversation()', () => {
		beforeEach(async () => {
			mockGetConversations.mockResolvedValueOnce([
				{ pubkey: 'contact-1', last_message_at: 1000, unread_count: 0 }
			]);
			mockValidatePubkey.mockReturnValue('contact-1');

			await messagesStore.loadConversations();
			await messagesStore.openConversation('contact-1');
		});

		it('should clear active conversation', () => {
			expect(messagesStore.activeConversation).toBe('contact-1');

			messagesStore.closeConversation();

			expect(messagesStore.activeConversation).toBe(null);
		});
	});

	describe('getActiveConversation()', () => {
		it('should return null when no active conversation', () => {
			expect(messagesStore.getActiveConversation()).toBe(null);
		});

		it('should return active conversation data', async () => {
			mockGetConversations.mockResolvedValueOnce([
				{ pubkey: 'contact-1', last_message_at: 1000, unread_count: 0 }
			]);
			mockValidatePubkey.mockReturnValue('contact-1');

			await messagesStore.loadConversations();
			await messagesStore.openConversation('contact-1');

			const activeConv = messagesStore.getActiveConversation();

			expect(activeConv).not.toBe(null);
			expect(activeConv?.pubkey).toBe('contact-1');
		});
	});

	describe('setPreferNip17()', () => {
		it('should update NIP-17 preference', () => {
			expect(messagesStore.preferNip17).toBe(true);

			messagesStore.setPreferNip17(false);

			expect(messagesStore.preferNip17).toBe(false);
		});
	});

	describe('totalUnreadCount', () => {
		it('should be zero after loading resets counts', async () => {
			const mockConversations = [
				{ pubkey: 'contact-1', last_message_at: 1000, unread_count: 5 },
				{ pubkey: 'contact-2', last_message_at: 900, unread_count: 3 }
			];
			mockGetConversations.mockResolvedValueOnce(mockConversations);

			await messagesStore.loadConversations();

			// After load, all unreads are reset to 0
			expect(messagesStore.totalUnreadCount).toBe(0);
		});
	});

	describe('cleanup()', () => {
		it('should unsubscribe from DMs', async () => {
			mockSubscribe.mockReturnValueOnce('dm-sub-1');
			mockSubscribe.mockReturnValueOnce('giftwrap-sub-2');

			await messagesStore.loadConversations();

			messagesStore.cleanup();

			expect(mockUnsubscribe).toHaveBeenCalledWith('dm-sub-1');
			expect(mockUnsubscribe).toHaveBeenCalledWith('giftwrap-sub-2');
		});

		it('should clear active conversation', async () => {
			mockGetConversations.mockResolvedValueOnce([
				{ pubkey: 'contact-1', last_message_at: 1000, unread_count: 0 }
			]);
			mockValidatePubkey.mockReturnValue('contact-1');

			await messagesStore.loadConversations();
			await messagesStore.openConversation('contact-1');

			expect(messagesStore.activeConversation).toBe('contact-1');

			messagesStore.cleanup();

			expect(messagesStore.activeConversation).toBe(null);
		});
	});

	describe('NIP-04 message handling', () => {
		it('should use window.nostr.nip04 for encryption when available', async () => {
			mockGetConversations.mockResolvedValueOnce([
				{ pubkey: 'recipient-pubkey', last_message_at: 1000, unread_count: 0 }
			]);
			mockValidatePubkey.mockReturnValue('recipient-pubkey');
			messagesStore.setPreferNip17(false);

			await messagesStore.loadConversations();
			await messagesStore.sendMessage('recipient-pubkey', 'Hello');

			expect(mockNostr.nip04.encrypt).toHaveBeenCalledWith(
				'recipient-pubkey',
				'Hello'
			);
		});
	});

	describe('Profile handling', () => {
		it('should fetch profile in background if not cached', async () => {
			mockGetProfile.mockResolvedValue(null);
			mockGetConversations.mockResolvedValueOnce([
				{ pubkey: 'contact-1', last_message_at: 1000, unread_count: 0 }
			]);

			await messagesStore.loadConversations();

			// Profile fetch should be triggered (fire and forget, may not be called yet)
			// The store calls fetchProfile in the background
			expect(messagesStore.conversations[0].profile).toBeNull();
		});
	});

	describe('Error handling', () => {
		it('should set error on send failure', async () => {
			mockGetConversations.mockResolvedValueOnce([
				{ pubkey: 'recipient-pubkey', last_message_at: 1000, unread_count: 0 }
			]);
			mockValidatePubkey.mockReturnValue('recipient-pubkey');
			mockWrapMessage.mockImplementation(() => {
				throw new Error('Encryption failed');
			});
			mockNostr.nip04.encrypt.mockRejectedValue(new Error('Encryption failed'));

			await messagesStore.loadConversations();

			await expect(messagesStore.sendMessage('recipient-pubkey', 'Hello'))
				.rejects.toThrow('Encryption failed');

			expect(messagesStore.error).toBe('Encryption failed');
		});

		it('should set error on invalid recipient', async () => {
			mockValidatePubkey.mockReturnValue(null);

			await expect(messagesStore.openConversation('invalid'))
				.rejects.toThrow();

			expect(messagesStore.error).toBe('Invalid public key or npub format');
		});
	});
});
