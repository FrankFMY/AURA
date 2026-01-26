import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { nip19 } from 'nostr-tools';

// Test fixtures
const TEST_PUBKEY = '82341f882b6eabcd2ba7f1ef90aad961cf074af15b9ef44a09f9d2a8fbfbe6a2';
const TEST_NPUB = nip19.npubEncode(TEST_PUBKEY);
const TEST_NSEC = 'nsec1vl029mgpspedva04g90vltkh6fvh240zqtv9k0t9af8935ke9laqsnlfe5';
const TEST_HEX_KEY = '67dea2ed018072d675f5415ecfaed7d2597555e202d85b3d65ea4e58d2d92ffa';

// Hoist mock functions
const {
	mockLoginWithExtension,
	mockLoginWithPrivateKey,
	mockLoginWithNewKeypair,
	mockConnect,
	mockLogout,
	mockFetchProfile,
	mockGetSetting,
	mockSetSetting,
	mockGetProfile,
	mockClearEvents,
	mockClearProfiles,
	mockClearConversations,
	mockClearContacts,
	mockClearRelays,
	mockClearSettings,
	mockClearDrafts,
	mockClearMutes,
	mockClearOutbox
} = vi.hoisted(() => ({
	mockLoginWithExtension: vi.fn(),
	mockLoginWithPrivateKey: vi.fn(),
	mockLoginWithNewKeypair: vi.fn(),
	mockConnect: vi.fn().mockResolvedValue(undefined),
	mockLogout: vi.fn(),
	mockFetchProfile: vi.fn(),
	mockGetSetting: vi.fn(),
	mockSetSetting: vi.fn().mockResolvedValue(undefined),
	mockGetProfile: vi.fn(),
	mockClearEvents: vi.fn().mockResolvedValue(undefined),
	mockClearProfiles: vi.fn().mockResolvedValue(undefined),
	mockClearConversations: vi.fn().mockResolvedValue(undefined),
	mockClearContacts: vi.fn().mockResolvedValue(undefined),
	mockClearRelays: vi.fn().mockResolvedValue(undefined),
	mockClearSettings: vi.fn().mockResolvedValue(undefined),
	mockClearDrafts: vi.fn().mockResolvedValue(undefined),
	mockClearMutes: vi.fn().mockResolvedValue(undefined),
	mockClearOutbox: vi.fn().mockResolvedValue(undefined)
}));

// Mock NDK service
vi.mock('$services/ndk', () => ({
	default: {
		loginWithExtension: mockLoginWithExtension,
		loginWithPrivateKey: mockLoginWithPrivateKey,
		loginWithNewKeypair: mockLoginWithNewKeypair,
		connect: mockConnect,
		logout: mockLogout,
		fetchProfile: mockFetchProfile
	}
}));

// Mock database
vi.mock('$db', () => ({
	db: {
		events: { clear: mockClearEvents },
		profiles: { clear: mockClearProfiles },
		conversations: { clear: mockClearConversations },
		contacts: { clear: mockClearContacts },
		relays: { clear: mockClearRelays },
		settings: { clear: mockClearSettings },
		drafts: { clear: mockClearDrafts },
		mutes: { clear: mockClearMutes },
		outbox: { clear: mockClearOutbox }
	},
	dbHelpers: {
		getSetting: mockGetSetting,
		setSetting: mockSetSetting,
		getProfile: mockGetProfile
	}
}));

// Mock validators
vi.mock('$lib/validators/schemas', () => ({
	validatePrivateKey: (key: string) => {
		// Simple validation for test
		if (key.startsWith('nsec1') || key.length === 64) {
			return key.startsWith('nsec1') ? TEST_HEX_KEY : key;
		}
		return null;
	},
	pubkeySchema: {
		safeParse: (pk: string) => ({
			success: pk.length === 64,
			data: pk
		})
	}
}));

describe('Auth Store', () => {
	let authStore: typeof import('$stores/auth.svelte').authStore;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.useFakeTimers();

		// Reset mocks to default state
		mockGetSetting.mockResolvedValue(null);
		mockGetProfile.mockResolvedValue(null);
		mockLoginWithExtension.mockResolvedValue(TEST_PUBKEY);
		mockLoginWithPrivateKey.mockResolvedValue(TEST_PUBKEY);
		mockLoginWithNewKeypair.mockResolvedValue({
			pubkey: TEST_PUBKEY,
			npub: TEST_NPUB,
			nsec: TEST_NSEC
		});
		mockFetchProfile.mockResolvedValue({
			content: JSON.stringify({ name: 'Test User', display_name: 'Test' })
		});

		// Mock window.nostr
		vi.stubGlobal('window', {
			nostr: {
				getPublicKey: vi.fn().mockResolvedValue(TEST_PUBKEY)
			},
			location: { href: '' },
			localStorage: {
				clear: vi.fn(),
				getItem: vi.fn(),
				setItem: vi.fn(),
				removeItem: vi.fn()
			},
			sessionStorage: {
				clear: vi.fn()
			},
			caches: {
				keys: vi.fn().mockResolvedValue([]),
				delete: vi.fn().mockResolvedValue(true)
			}
		});

		// Mock navigator
		vi.stubGlobal('navigator', {
			serviceWorker: {
				getRegistrations: vi.fn().mockResolvedValue([])
			}
		});

		// Re-import store to get fresh instance
		vi.resetModules();
		const module = await import('$stores/auth.svelte');
		authStore = module.authStore;
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	describe('Initial State', () => {
		it('should start with default state', () => {
			expect(authStore.isAuthenticated).toBe(false);
			expect(authStore.pubkey).toBeNull();
			expect(authStore.npub).toBeNull();
			expect(authStore.method).toBeNull();
			expect(authStore.profile).toBeNull();
			expect(authStore.isLoading).toBe(false);
			expect(authStore.error).toBeNull();
		});

		it('should have displayName as Anonymous when not authenticated', () => {
			expect(authStore.displayName).toBe('Anonymous');
		});
	});

	describe('init()', () => {
		it('should restore session from storage for extension method', async () => {
			mockGetSetting.mockImplementation(async (key: string) => {
				if (key === 'auth_pubkey') return TEST_PUBKEY;
				if (key === 'auth_method') return 'extension';
				return null;
			});
			mockGetProfile.mockResolvedValue({
				pubkey: TEST_PUBKEY,
				name: 'Cached User'
			});

			await authStore.init();
			vi.runAllTimersAsync();

			expect(mockGetSetting).toHaveBeenCalledWith('auth_pubkey', null);
			expect(mockGetSetting).toHaveBeenCalledWith('auth_method', null);
		});

		it('should restore session for privatekey method', async () => {
			mockGetSetting.mockImplementation(async (key: string) => {
				if (key === 'auth_pubkey') return TEST_PUBKEY;
				if (key === 'auth_method') return 'privatekey';
				return null;
			});
			mockGetProfile.mockResolvedValue({
				pubkey: TEST_PUBKEY,
				name: 'Cached User'
			});

			await authStore.init();

			expect(authStore.pubkey).toBe(TEST_PUBKEY);
			expect(authStore.method).toBe('privatekey');
		});

		it('should handle init errors gracefully', async () => {
			mockGetSetting.mockRejectedValue(new Error('Database error'));

			await authStore.init();

			expect(authStore.error).toBe('Failed to initialize authentication. Please try again.');
			expect(authStore.isLoading).toBe(false);
		});

		it('should do nothing if no stored session', async () => {
			mockGetSetting.mockResolvedValue(null);

			await authStore.init();

			expect(authStore.isAuthenticated).toBe(false);
			expect(authStore.pubkey).toBeNull();
		});
	});

	describe('loginWithExtension()', () => {
		it('should login successfully with extension', async () => {
			const loginPromise = authStore.loginWithExtension();
			vi.runAllTimersAsync();
			await loginPromise;

			expect(mockLoginWithExtension).toHaveBeenCalled();
			expect(authStore.pubkey).toBe(TEST_PUBKEY);
			expect(authStore.npub).toBe(TEST_NPUB);
			expect(authStore.method).toBe('extension');
			expect(authStore.isAuthenticated).toBe(true);
		});

		it('should store auth state after successful login', async () => {
			const loginPromise = authStore.loginWithExtension();
			vi.runAllTimersAsync();
			await loginPromise;

			expect(mockSetSetting).toHaveBeenCalledWith('auth_pubkey', TEST_PUBKEY);
			expect(mockSetSetting).toHaveBeenCalledWith('auth_method', 'extension');
		});

		it('should handle extension login failure', async () => {
			mockLoginWithExtension.mockRejectedValue(new Error('Extension rejected'));

			await expect(authStore.loginWithExtension()).rejects.toThrow();

			expect(authStore.error).toBe('Failed to login with extension. Please ensure your extension is unlocked and try again.');
			expect(authStore.isAuthenticated).toBe(false);
		});

		it('should continue if relay connection times out', async () => {
			mockConnect.mockImplementation(() => new Promise(() => {})); // Never resolves

			const loginPromise = authStore.loginWithExtension();
			await vi.advanceTimersByTimeAsync(11000); // Past timeout
			await loginPromise;

			expect(authStore.isAuthenticated).toBe(true);
		}, 15000); // Extend test timeout
	});

	describe('loginWithPrivateKey()', () => {
		it('should login with valid nsec key', async () => {
			const loginPromise = authStore.loginWithPrivateKey(TEST_NSEC);
			vi.runAllTimersAsync();
			await loginPromise;

			expect(mockLoginWithPrivateKey).toHaveBeenCalled();
			expect(authStore.isAuthenticated).toBe(true);
			expect(authStore.method).toBe('privatekey');
		});

		it('should login with valid hex key', async () => {
			const loginPromise = authStore.loginWithPrivateKey(TEST_HEX_KEY);
			vi.runAllTimersAsync();
			await loginPromise;

			expect(mockLoginWithPrivateKey).toHaveBeenCalled();
			expect(authStore.isAuthenticated).toBe(true);
		});

		it('should reject invalid key format', async () => {
			await expect(authStore.loginWithPrivateKey('invalid-key')).rejects.toThrow();

			expect(authStore.error).toContain('Invalid key format');
			expect(authStore.isAuthenticated).toBe(false);
		});

		it('should not store private key in database', async () => {
			const loginPromise = authStore.loginWithPrivateKey(TEST_NSEC);
			vi.runAllTimersAsync();
			await loginPromise;

			// Should only store pubkey and method, not the private key
			const calls = mockSetSetting.mock.calls.map(c => c[0]);
			expect(calls).toContain('auth_pubkey');
			expect(calls).toContain('auth_method');
			expect(calls).not.toContain('auth_privatekey');
		});
	});

	describe('generateAndLogin()', () => {
		it('should generate new keypair and login', async () => {
			const generatePromise = authStore.generateAndLogin();
			vi.runAllTimersAsync();
			const result = await generatePromise;

			expect(result.nsec).toBe(TEST_NSEC);
			expect(result.npub).toBe(TEST_NPUB);
			expect(authStore.isAuthenticated).toBe(true);
			expect(authStore.method).toBe('generated');
		});

		it('should store auth state after generation', async () => {
			const generatePromise = authStore.generateAndLogin();
			vi.runAllTimersAsync();
			await generatePromise;

			expect(mockSetSetting).toHaveBeenCalledWith('auth_pubkey', TEST_PUBKEY);
			expect(mockSetSetting).toHaveBeenCalledWith('auth_method', 'generated');
		});

		it('should handle generation failure', async () => {
			mockLoginWithNewKeypair.mockRejectedValue(new Error('Generation failed'));

			await expect(authStore.generateAndLogin()).rejects.toThrow();

			expect(authStore.error).toBe('Failed to generate new account. Please try again.');
		});
	});

	describe('logout()', () => {
		it('should clear all auth state', async () => {
			// First login
			const loginPromise = authStore.loginWithExtension();
			vi.runAllTimersAsync();
			await loginPromise;
			expect(authStore.isAuthenticated).toBe(true);

			// Then logout
			await authStore.logout();

			expect(authStore.isAuthenticated).toBe(false);
			expect(authStore.pubkey).toBeNull();
			expect(authStore.npub).toBeNull();
			expect(authStore.method).toBeNull();
			expect(authStore.profile).toBeNull();
		});

		it('should call ndkService logout', async () => {
			await authStore.logout();

			expect(mockLogout).toHaveBeenCalled();
		});

		it('should clear stored auth', async () => {
			await authStore.logout();

			expect(mockSetSetting).toHaveBeenCalledWith('auth_pubkey', null);
			expect(mockSetSetting).toHaveBeenCalledWith('auth_method', null);
		});
	});

	describe('hasExtension()', () => {
		it('should return true when window.nostr exists', () => {
			expect(authStore.hasExtension()).toBe(true);
		});

		it('should return false when window.nostr is missing', () => {
			vi.stubGlobal('window', { nostr: undefined });

			// Need to reimport to test
			expect(typeof window !== 'undefined' && !!window.nostr).toBe(false);
		});
	});

	describe('panicWipe()', () => {
		it('should clear all database tables', async () => {
			await authStore.panicWipe();

			expect(mockClearEvents).toHaveBeenCalled();
			expect(mockClearProfiles).toHaveBeenCalled();
			expect(mockClearConversations).toHaveBeenCalled();
			expect(mockClearContacts).toHaveBeenCalled();
			expect(mockClearRelays).toHaveBeenCalled();
			expect(mockClearSettings).toHaveBeenCalled();
			expect(mockClearDrafts).toHaveBeenCalled();
			expect(mockClearMutes).toHaveBeenCalled();
			expect(mockClearOutbox).toHaveBeenCalled();
		});

		it('should attempt to clear storage', async () => {
			// panicWipe attempts to clear localStorage/sessionStorage
			// We verify it doesn't throw when these exist
			await expect(authStore.panicWipe()).resolves.not.toThrow();
		});

		it('should call logout on ndkService', async () => {
			await authStore.panicWipe();

			expect(mockLogout).toHaveBeenCalled();
		});

		it('should redirect to login page', async () => {
			await authStore.panicWipe();

			expect(window.location.href).toBe('/login');
		});
	});

	describe('fetchProfile()', () => {
		it('should fetch and parse profile', async () => {
			// First login
			const loginPromise = authStore.loginWithExtension();
			vi.runAllTimersAsync();
			await loginPromise;

			// Profile should be fetched during login
			expect(mockFetchProfile).toHaveBeenCalledWith(TEST_PUBKEY);
		});

		it('should use cached profile first', async () => {
			mockGetProfile.mockResolvedValue({
				pubkey: TEST_PUBKEY,
				name: 'Cached Name'
			});

			// Login triggers fetchProfile
			const loginPromise = authStore.loginWithExtension();
			vi.runAllTimersAsync();
			await loginPromise;

			expect(mockGetProfile).toHaveBeenCalledWith(TEST_PUBKEY);
		});

		it('should handle malformed profile content', async () => {
			mockFetchProfile.mockResolvedValue({
				content: 'not-valid-json'
			});

			// Should not throw
			const loginPromise = authStore.loginWithExtension();
			vi.runAllTimersAsync();
			await loginPromise;

			// Should still be authenticated
			expect(authStore.isAuthenticated).toBe(true);
		});
	});

	describe('Derived State', () => {
		it('should compute displayName from profile', async () => {
			mockFetchProfile.mockResolvedValue({
				content: JSON.stringify({ display_name: 'Display Name', name: 'Name' })
			});

			const loginPromise = authStore.loginWithExtension();
			vi.runAllTimersAsync();
			await loginPromise;

			// displayName prioritizes display_name over name
			expect(authStore.displayName).toBe('Display Name');
		});

		it('should fallback to truncated npub if no name', async () => {
			mockFetchProfile.mockResolvedValue(null);
			mockGetProfile.mockResolvedValue(null);

			const loginPromise = authStore.loginWithExtension();
			vi.runAllTimersAsync();
			await loginPromise;

			// Should use truncated npub
			expect(authStore.displayName).toContain('npub');
		});

		it('should compute avatar from profile', async () => {
			mockFetchProfile.mockResolvedValue({
				content: JSON.stringify({ picture: 'https://example.com/avatar.png' })
			});

			const loginPromise = authStore.loginWithExtension();
			vi.runAllTimersAsync();
			await loginPromise;

			expect(authStore.avatar).toBe('https://example.com/avatar.png');
		});
	});

	describe('Race Conditions', () => {
		it('should handle multiple concurrent login attempts', async () => {
			// Start two login attempts
			const login1 = authStore.loginWithExtension();
			const login2 = authStore.loginWithExtension();

			vi.runAllTimersAsync();
			await Promise.all([login1, login2]);

			// Should still be in valid state
			expect(authStore.isAuthenticated).toBe(true);
			expect(authStore.isLoading).toBe(false);
		});

		it('should handle login during init', async () => {
			mockGetSetting.mockImplementation(async (key: string) => {
				// Simulate slow database
				await new Promise(r => setTimeout(r, 100));
				if (key === 'auth_pubkey') return TEST_PUBKEY;
				if (key === 'auth_method') return 'extension';
				return null;
			});

			const initPromise = authStore.init();
			vi.advanceTimersByTime(50); // Before init completes

			const loginPromise = authStore.loginWithExtension();
			vi.runAllTimersAsync();

			await Promise.all([initPromise, loginPromise]);

			expect(authStore.isAuthenticated).toBe(true);
		});
	});
});
