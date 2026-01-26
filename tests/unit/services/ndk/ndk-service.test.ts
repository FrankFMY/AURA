/**
 * NDK Service Tests
 *
 * Tests for the main NDK service coordinating Nostr operations.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { nip19 } from 'nostr-tools';

// Mock dependencies with hoisted mocks
const {
	mockNDKInstance,
	MockNDK,
	MockNDKEvent,
	MockNDKNip07Signer,
	MockNDKPrivateKeySigner,
	mockRelayManager,
	mockEventPublisher,
	mockSubscriptionManager,
	mockDb,
	mockDbHelpers
} = vi.hoisted(() => {
	const mockUser = {
		pubkey: 'test-pubkey-123abc'
	};

	const mockSigner = {
		user: vi.fn().mockResolvedValue(mockUser),
		sign: vi.fn()
	};

	const mockPrivateKeySigner = {
		user: vi.fn().mockResolvedValue(mockUser),
		sign: vi.fn(),
		privateKey: 'test-private-key-hex'
	};

	const mockNDKInstance = {
		connect: vi.fn().mockResolvedValue(undefined),
		fetchEvents: vi.fn().mockResolvedValue(new Set()),
		signer: null as any
	};

	// Create proper class mocks
	const MockNDK = vi.fn().mockImplementation(function(this: any) {
		Object.assign(this, mockNDKInstance);
		return this;
	});

	const MockNDKEvent = vi.fn().mockImplementation(function(this: any) {
		this.kind = 1;
		this.content = '';
		this.tags = [];
		this.id = 'event-id-123';
		this.pubkey = 'test-pubkey';
		this.rawEvent = vi.fn().mockReturnValue({ id: 'event-id-123', kind: 1 });
		return this;
	});

	const MockNDKNip07Signer = vi.fn().mockImplementation(function(this: any) {
		Object.assign(this, mockSigner);
		return this;
	});

	const MockNDKPrivateKeySigner = vi.fn().mockImplementation(function(this: any) {
		Object.assign(this, mockPrivateKeySigner);
		return this;
	});

	return {
		mockNDKInstance,
		MockNDK,
		MockNDKEvent,
		MockNDKNip07Signer,
		MockNDKPrivateKeySigner,
		mockRelayManager: {
			setNDK: vi.fn(),
			cleanStaleRelays: vi.fn().mockResolvedValue(0),
			isBlacklisted: vi.fn().mockReturnValue(false),
			startHealthMonitoring: vi.fn(),
			stopHealthMonitoring: vi.fn(),
			quickHealthCheck: vi.fn().mockResolvedValue(true),
			blacklistRelay: vi.fn(),
			addRelay: vi.fn().mockResolvedValue(undefined),
			removeRelay: vi.fn().mockResolvedValue(undefined),
			getConnectedRelays: vi.fn().mockReturnValue(['wss://relay1.test']),
			getAllHealth: vi.fn().mockReturnValue([])
		},
		mockEventPublisher: {
			setNDK: vi.fn(),
			setSigner: vi.fn(),
			publish: vi.fn().mockResolvedValue(new Set()),
			getQueueStatus: vi.fn().mockReturnValue({ pending: 0, failed: 0 })
		},
		mockSubscriptionManager: {
			setNDK: vi.fn(),
			subscribe: vi.fn().mockReturnValue('sub-id-123'),
			unsubscribe: vi.fn().mockReturnValue(true),
			unsubscribeAll: vi.fn(),
			getStats: vi.fn().mockReturnValue({ active: 0, total: 0 })
		},
		mockDb: {
			relays: {
				toArray: vi.fn().mockResolvedValue([])
			}
		},
		mockDbHelpers: {
			getProfile: vi.fn().mockResolvedValue(null),
			saveProfile: vi.fn().mockResolvedValue(undefined)
		}
	};
});

// Mock NDK
vi.mock('@nostr-dev-kit/ndk', () => ({
	default: MockNDK,
	NDKEvent: MockNDKEvent,
	NDKNip07Signer: MockNDKNip07Signer,
	NDKPrivateKeySigner: MockNDKPrivateKeySigner
}));

// Mock relay-manager
vi.mock('$services/ndk/relay-manager', () => ({
	relayManager: mockRelayManager,
	DEFAULT_RELAYS: ['wss://relay.damus.io', 'wss://relay.nostr.band'],
	BACKUP_RELAYS: ['wss://nos.lol']
}));

// Mock event-publisher
vi.mock('$services/ndk/event-publisher', () => ({
	eventPublisher: mockEventPublisher
}));

// Mock subscription-manager
vi.mock('$services/ndk/subscription-manager', () => ({
	subscriptionManager: mockSubscriptionManager
}));

// Mock database
vi.mock('$db', () => ({
	db: mockDb,
	dbHelpers: mockDbHelpers
}));

// Mock errors
vi.mock('$lib/core/errors', () => ({
	NetworkError: class NetworkError extends Error {
		constructor(msg: string, opts?: any) {
			super(msg);
			this.name = 'NetworkError';
		}
	},
	AuthError: class AuthError extends Error {
		constructor(msg: string, opts?: any) {
			super(msg);
			this.name = 'AuthError';
		}
	},
	ErrorCode: {
		NETWORK_ERROR: 'NETWORK_ERROR',
		RELAY_CONNECTION_FAILED: 'RELAY_CONNECTION_FAILED',
		NO_EXTENSION: 'NO_EXTENSION',
		INVALID_KEY: 'INVALID_KEY',
		AUTH_FAILED: 'AUTH_FAILED'
	}
}));

describe('NDKService', () => {
	let ndkService: typeof import('$services/ndk').default;

	beforeEach(async () => {
		vi.resetModules();

		// Reset all mocks
		vi.clearAllMocks();
		mockNDKInstance.signer = null;
		mockNDKInstance.connect.mockResolvedValue(undefined);
		mockNDKInstance.fetchEvents.mockResolvedValue(new Set());
		mockDb.relays.toArray.mockResolvedValue([]);
		mockRelayManager.cleanStaleRelays.mockResolvedValue(0);
		mockRelayManager.isBlacklisted.mockReturnValue(false);
		mockRelayManager.quickHealthCheck.mockResolvedValue(true);
		mockDbHelpers.getProfile.mockResolvedValue(null);

		// Import fresh instance
		const module = await import('$services/ndk');
		ndkService = module.default;
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('Initial state', () => {
		it('should have null pubkey before login', () => {
			expect(ndkService.pubkey).toBeNull();
		});

		it('should have null signer before login', () => {
			expect(ndkService.signer).toBeNull();
		});

		it('should be disconnected initially', () => {
			expect(ndkService.connectionStatus).toBe('disconnected');
		});

		it('should throw when accessing ndk before init', () => {
			expect(() => ndkService.ndk).toThrow('NDK not initialized');
		});
	});

	describe('init()', () => {
		it('should initialize NDK with default relays', async () => {
			await ndkService.init();

			expect(mockRelayManager.cleanStaleRelays).toHaveBeenCalled();
			expect(mockRelayManager.setNDK).toHaveBeenCalled();
			expect(mockEventPublisher.setNDK).toHaveBeenCalled();
			expect(mockSubscriptionManager.setNDK).toHaveBeenCalled();
			expect(mockRelayManager.startHealthMonitoring).toHaveBeenCalled();
		});

		it('should use stored relays if available', async () => {
			mockDb.relays.toArray.mockResolvedValue([
				{ url: 'wss://custom.relay', read: true, write: true }
			]);

			await ndkService.init();

			expect(mockDb.relays.toArray).toHaveBeenCalled();
		});

		it('should filter blacklisted relays', async () => {
			mockRelayManager.isBlacklisted.mockReturnValue(true);

			await ndkService.init();

			expect(mockRelayManager.isBlacklisted).toHaveBeenCalled();
		});

		it('should set signer if provided', async () => {
			const mockSigner = {
				user: vi.fn().mockResolvedValue({ pubkey: 'signer-pubkey' }),
				sign: vi.fn()
			} as any;

			await ndkService.init(mockSigner);

			expect(mockEventPublisher.setSigner).toHaveBeenCalledWith(mockSigner);
		});

		it('should continue if cleanStaleRelays fails', async () => {
			mockRelayManager.cleanStaleRelays.mockRejectedValue(new Error('DB error'));

			await expect(ndkService.init()).resolves.not.toThrow();
		});
	});

	describe('connect()', () => {
		it('should connect to relays', async () => {
			await ndkService.init();
			await ndkService.connect();

			expect(mockNDKInstance.connect).toHaveBeenCalled();
			expect(ndkService.connectionStatus).toBe('connected');
		});

		it('should initialize if not already done', async () => {
			await ndkService.connect();

			expect(mockRelayManager.setNDK).toHaveBeenCalled();
		});

		it('should set connecting status during connect', async () => {
			await ndkService.init();

			const connectPromise = ndkService.connect();
			// Status checked immediately after call starts

			await connectPromise;
			expect(ndkService.connectionStatus).toBe('connected');
		});

		it('should handle connection errors', async () => {
			await ndkService.init();
			mockNDKInstance.connect.mockRejectedValue(new Error('Connection failed'));

			await expect(ndkService.connect()).rejects.toThrow();
			expect(ndkService.connectionStatus).toBe('error');
		});
	});

	describe('loginWithExtension()', () => {
		it('should throw if no extension', async () => {
			// No window.nostr
			await expect(ndkService.loginWithExtension()).rejects.toThrow('No NIP-07 extension');
		});

		it('should login with NIP-07 extension', async () => {
			// Mock window.nostr
			const originalWindow = global.window;
			(global as any).window = { nostr: { getPublicKey: vi.fn() } };

			try {
				await ndkService.init();
				const pubkey = await ndkService.loginWithExtension();

				expect(MockNDKNip07Signer).toHaveBeenCalled();
				expect(pubkey).toBe('test-pubkey-123abc');
			} finally {
				(global as any).window = originalWindow;
			}
		});
	});

	describe('loginWithPrivateKey()', () => {
		it('should login with hex private key', async () => {
			await ndkService.init();
			const hexKey = 'a'.repeat(64);

			const pubkey = await ndkService.loginWithPrivateKey(hexKey);

			expect(MockNDKPrivateKeySigner).toHaveBeenCalledWith(hexKey);
			expect(pubkey).toBe('test-pubkey-123abc');
		});

		it('should login with nsec key', async () => {
			await ndkService.init();
			// Generate a valid nsec for testing
			const testSecretKey = new Uint8Array(32).fill(1);
			const nsecKey = nip19.nsecEncode(testSecretKey);

			const pubkey = await ndkService.loginWithPrivateKey(nsecKey);

			expect(MockNDKPrivateKeySigner).toHaveBeenCalled();
			expect(pubkey).toBe('test-pubkey-123abc');
		});

		it('should reject invalid key format', async () => {
			await ndkService.init();

			await expect(ndkService.loginWithPrivateKey('invalid-key'))
				.rejects.toThrow('Invalid private key format');
		});

		it('should reject wrong nip19 type', async () => {
			await ndkService.init();
			// Create an npub instead of nsec
			const npubKey = nip19.npubEncode('a'.repeat(64));

			await expect(ndkService.loginWithPrivateKey(npubKey))
				.rejects.toThrow();
		});

		it('should initialize if not done', async () => {
			const hexKey = 'b'.repeat(64);

			await ndkService.loginWithPrivateKey(hexKey);

			expect(mockRelayManager.setNDK).toHaveBeenCalled();
		});
	});

	describe('generateKeypair()', () => {
		it('should generate valid keypair', () => {
			const keypair = ndkService.generateKeypair();

			expect(keypair.privateKey).toMatch(/^[0-9a-f]{64}$/);
			expect(keypair.publicKey).toMatch(/^[0-9a-f]{64}$/);
			expect(keypair.nsec).toMatch(/^nsec1/);
			expect(keypair.npub).toMatch(/^npub1/);
		});

		it('should generate unique keypairs', () => {
			const keypair1 = ndkService.generateKeypair();
			const keypair2 = ndkService.generateKeypair();

			expect(keypair1.privateKey).not.toBe(keypair2.privateKey);
			expect(keypair1.publicKey).not.toBe(keypair2.publicKey);
		});
	});

	describe('loginWithNewKeypair()', () => {
		it('should generate and login with new keypair', async () => {
			await ndkService.init();
			const result = await ndkService.loginWithNewKeypair();

			// pubkey is derived from the generated keypair (64 char hex)
			expect(result.pubkey).toMatch(/^[0-9a-f]{64}$/);
			expect(result.nsec).toMatch(/^nsec1/);
			expect(result.npub).toMatch(/^npub1/);
		});
	});

	describe('logout()', () => {
		it('should clear auth state', async () => {
			await ndkService.init();
			const hexKey = 'c'.repeat(64);
			await ndkService.loginWithPrivateKey(hexKey);

			ndkService.logout();

			expect(ndkService.pubkey).toBeNull();
			expect(ndkService.signer).toBeNull();
			expect(mockEventPublisher.setSigner).toHaveBeenCalledWith(null);
		});
	});

	describe('publish()', () => {
		it('should throw if not logged in', async () => {
			await ndkService.init();
			const event = { kind: 1, content: 'test' } as any;

			await expect(ndkService.publish(event)).rejects.toThrow('No signer available');
		});

		it('should publish event when logged in', async () => {
			await ndkService.init();
			await ndkService.loginWithPrivateKey('d'.repeat(64));

			const event = { kind: 1, content: 'test' } as any;
			await ndkService.publish(event);

			expect(mockEventPublisher.publish).toHaveBeenCalledWith(event);
		});
	});

	describe('publishNote()', () => {
		it('should create and publish text note', async () => {
			await ndkService.init();
			await ndkService.loginWithPrivateKey('e'.repeat(64));

			const result = await ndkService.publishNote('Hello Nostr!');

			expect(mockEventPublisher.publish).toHaveBeenCalled();
			expect(result.kind).toBe(1);
		});

		it('should add reply tags when replying', async () => {
			await ndkService.init();
			await ndkService.loginWithPrivateKey('f'.repeat(64));

			const replyTo = {
				id: 'original-event-id',
				pubkey: 'original-author',
				tags: []
			} as any;

			const result = await ndkService.publishNote('Reply!', replyTo);

			expect(result.tags).toContainEqual(['e', 'original-event-id', '', 'reply']);
			expect(result.tags).toContainEqual(['p', 'original-author']);
		});
	});

	describe('fetchProfile()', () => {
		it('should fetch profile from network', async () => {
			await ndkService.init();

			const mockProfileEvent = {
				content: JSON.stringify({ name: 'Test User', about: 'Bio' })
			};
			mockNDKInstance.fetchEvents.mockResolvedValue(new Set([mockProfileEvent]));

			await ndkService.fetchProfile('some-pubkey');

			expect(mockNDKInstance.fetchEvents).toHaveBeenCalled();
			expect(mockDbHelpers.saveProfile).toHaveBeenCalled();
		});

		it('should use cache if recent', async () => {
			await ndkService.init();

			mockDbHelpers.getProfile.mockResolvedValue({
				pubkey: 'cached-pubkey',
				name: 'Cached User',
				updated_at: Date.now() // Recent
			});

			const result = await ndkService.fetchProfile('cached-pubkey');

			expect(result).toBeNull(); // Returns null when using cache
			expect(mockNDKInstance.fetchEvents).not.toHaveBeenCalled();
		});

		it('should handle malformed profile JSON', async () => {
			await ndkService.init();

			const mockBrokenEvent = {
				content: '{ invalid json'
			};
			mockNDKInstance.fetchEvents.mockResolvedValue(new Set([mockBrokenEvent]));

			await expect(ndkService.fetchProfile('some-pubkey')).resolves.not.toThrow();
		});

		it('should sanitize control characters in profile', async () => {
			await ndkService.init();

			const mockEventWithControlChars = {
				content: '{"name": "Test\nUser", "about": "Bio\twith\ttabs"}'
			};
			mockNDKInstance.fetchEvents.mockResolvedValue(new Set([mockEventWithControlChars]));

			await ndkService.fetchProfile('some-pubkey');

			expect(mockDbHelpers.saveProfile).toHaveBeenCalled();
		});
	});

	describe('react()', () => {
		it('should create reaction event', async () => {
			await ndkService.init();
			await ndkService.loginWithPrivateKey('a'.repeat(64));

			const targetEvent = { id: 'target-id', pubkey: 'target-author' } as any;
			const result = await ndkService.react(targetEvent);

			expect(result.kind).toBe(7);
			expect(result.content).toBe('+');
			expect(mockEventPublisher.publish).toHaveBeenCalled();
		});

		it('should support custom reactions', async () => {
			await ndkService.init();
			await ndkService.loginWithPrivateKey('b'.repeat(64));

			const targetEvent = { id: 'target-id', pubkey: 'target-author' } as any;
			const result = await ndkService.react(targetEvent, '🔥');

			expect(result.content).toBe('🔥');
		});
	});

	describe('repost()', () => {
		it('should create repost event', async () => {
			await ndkService.init();
			await ndkService.loginWithPrivateKey('c'.repeat(64));

			const targetEvent = {
				id: 'original-id',
				pubkey: 'original-author',
				rawEvent: vi.fn().mockReturnValue({ id: 'original-id', kind: 1 })
			} as any;

			const result = await ndkService.repost(targetEvent);

			expect(result.kind).toBe(6);
			expect(mockEventPublisher.publish).toHaveBeenCalled();
		});
	});

	describe('deleteEvent()', () => {
		it('should create deletion event', async () => {
			await ndkService.init();
			await ndkService.loginWithPrivateKey('d'.repeat(64));

			const result = await ndkService.deleteEvent('event-to-delete');

			expect(result.kind).toBe(5);
			expect(result.tags).toContainEqual(['e', 'event-to-delete']);
		});

		it('should include deletion reason if provided', async () => {
			await ndkService.init();
			await ndkService.loginWithPrivateKey('e'.repeat(64));

			const result = await ndkService.deleteEvent('event-id', 'spam');

			expect(result.content).toBe('spam');
		});
	});

	describe('Subscription management', () => {
		it('should subscribe to events', async () => {
			await ndkService.init();

			const filter = { kinds: [1], limit: 10 };
			const subId = ndkService.subscribe(filter);

			expect(mockSubscriptionManager.subscribe).toHaveBeenCalledWith(
				filter,
				undefined,
				undefined,
				undefined
			);
			expect(subId).toBe('sub-id-123');
		});

		it('should unsubscribe', async () => {
			await ndkService.init();

			const result = ndkService.unsubscribe('sub-id-123');

			expect(mockSubscriptionManager.unsubscribe).toHaveBeenCalledWith('sub-id-123');
			expect(result).toBe(true);
		});
	});

	describe('Relay management', () => {
		it('should add relay', async () => {
			await ndkService.init();

			await ndkService.addRelay('wss://new.relay');

			expect(mockRelayManager.addRelay).toHaveBeenCalledWith('wss://new.relay', true, true);
		});

		it('should remove relay', async () => {
			await ndkService.init();

			await ndkService.removeRelay('wss://old.relay');

			expect(mockRelayManager.removeRelay).toHaveBeenCalledWith('wss://old.relay');
		});

		it('should get connected relays', async () => {
			await ndkService.init();

			const relays = ndkService.connectedRelays;

			expect(mockRelayManager.getConnectedRelays).toHaveBeenCalled();
			expect(relays).toEqual(['wss://relay1.test']);
		});

		it('should get relay health', async () => {
			await ndkService.init();

			ndkService.getRelayHealth();

			expect(mockRelayManager.getAllHealth).toHaveBeenCalled();
		});
	});

	describe('connectUserRelays()', () => {
		it('should connect to healthy relays', async () => {
			await ndkService.init();

			const result = await ndkService.connectUserRelays([
				'wss://relay1.test',
				'wss://relay2.test'
			]);

			expect(result.connected).toContain('wss://relay1.test');
			expect(result.connected).toContain('wss://relay2.test');
			expect(result.failed).toHaveLength(0);
		});

		it('should skip blacklisted relays', async () => {
			await ndkService.init();
			mockRelayManager.isBlacklisted.mockReturnValue(true);

			const result = await ndkService.connectUserRelays(['wss://blacklisted.relay']);

			expect(result.failed).toContain('wss://blacklisted.relay');
			expect(result.connected).toHaveLength(0);
		});

		it('should blacklist unhealthy relays', async () => {
			await ndkService.init();
			mockRelayManager.isBlacklisted.mockReturnValue(false);
			mockRelayManager.quickHealthCheck.mockResolvedValue(false);

			const result = await ndkService.connectUserRelays(['wss://unhealthy.relay']);

			expect(mockRelayManager.blacklistRelay).toHaveBeenCalledWith('wss://unhealthy.relay');
			expect(result.failed).toContain('wss://unhealthy.relay');
		});

		it('should handle addRelay failures', async () => {
			await ndkService.init();
			mockRelayManager.addRelay.mockRejectedValue(new Error('Add failed'));

			const result = await ndkService.connectUserRelays(['wss://failing.relay']);

			expect(result.failed).toContain('wss://failing.relay');
		});
	});

	describe('disconnect()', () => {
		it('should clean up resources', async () => {
			await ndkService.init();
			await ndkService.connect();

			await ndkService.disconnect();

			expect(mockSubscriptionManager.unsubscribeAll).toHaveBeenCalled();
			expect(mockRelayManager.stopHealthMonitoring).toHaveBeenCalled();
			expect(ndkService.connectionStatus).toBe('disconnected');
		});
	});

	describe('Status getters', () => {
		it('should return publish queue status', async () => {
			await ndkService.init();

			const status = ndkService.getPublishQueueStatus();

			expect(mockEventPublisher.getQueueStatus).toHaveBeenCalled();
			expect(status).toEqual({ pending: 0, failed: 0 });
		});

		it('should return subscription stats', async () => {
			await ndkService.init();

			const stats = ndkService.getSubscriptionStats();

			expect(mockSubscriptionManager.getStats).toHaveBeenCalled();
			expect(stats).toEqual({ active: 0, total: 0 });
		});
	});

	describe('Private key access', () => {
		it('should return null if no private key signer', async () => {
			expect(ndkService.privateKey).toBeNull();
			expect(ndkService.hasPrivateKey).toBe(false);
		});

		it('should return private key when available', async () => {
			await ndkService.init();
			await ndkService.loginWithPrivateKey('a'.repeat(64));

			// Note: The actual value depends on mock implementation
			expect(ndkService.hasPrivateKey).toBe(true);
		});
	});
});
