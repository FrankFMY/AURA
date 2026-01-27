import { nip19 } from 'nostr-tools';
import ndkService from '$services/ndk';
import { db, dbHelpers, type UserProfile } from '$db';
import { validatePrivateKey, pubkeySchema } from '$lib/validators/schemas';

/** Check if NIP-07 extension is available */
function hasExtension(): boolean {
	return globalThis.window !== undefined && !!globalThis.window.nostr;
}

/** Auth method used for login */
export type AuthMethod = 'extension' | 'privatekey' | 'generated';

/** Auth state interface */
export interface AuthState {
	/** Whether the user is authenticated */
	isAuthenticated: boolean;
	/** Current user's public key (hex) */
	pubkey: string | null;
	/** Current user's npub */
	npub: string | null;
	/** Auth method used */
	method: AuthMethod | null;
	/** User profile metadata */
	profile: UserProfile | null;
	/** Whether auth is in progress */
	isLoading: boolean;
	/** Error message if auth failed */
	error: string | null;
}

/** Create auth state using Svelte 5 runes */
function createAuthStore() {
	let isAuthenticated = $state(false);
	let pubkey = $state<string | null>(null);
	let npub = $state<string | null>(null);
	let method = $state<AuthMethod | null>(null);
	let profile = $state<UserProfile | null>(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	// Derived state
	const displayName = $derived(
		profile?.display_name || profile?.name || (npub ? `${npub.slice(0, 12)}...` : 'Anonymous')
	);

	const avatar = $derived(profile?.picture || null);

	/** Restore session from cached data */
	async function restoreCachedSession(storedPubkey: string, storedMethod: AuthMethod): Promise<void> {
		pubkey = storedPubkey;
		npub = nip19.npubEncode(storedPubkey);
		method = storedMethod;
		isAuthenticated = true;

		const cachedProfile = await dbHelpers.getProfile(storedPubkey);
		if (cachedProfile) {
			profile = cachedProfile;
		}
	}

	/** Try to restore extension session with timeout */
	async function tryRestoreExtensionSession(storedPubkey: string, storedMethod: AuthMethod): Promise<void> {
		if (!globalThis.window?.nostr) {
			await restoreCachedSession(storedPubkey, storedMethod);
			return;
		}

		try {
			const extensionPromise = loginWithExtension();
			const timeoutPromise = new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('Extension timeout')), 5000)
			);
			await Promise.race([extensionPromise, timeoutPromise]);
		} catch (e) {
			console.warn('Extension auth timed out or failed, using cached session:', e);
			await restoreCachedSession(storedPubkey, storedMethod);
		}
	}

	/** Initialize auth from stored session */
	async function init(): Promise<void> {
		isLoading = true;
		error = null;

		try {
			const storedPubkey = await dbHelpers.getSetting<string | null>('auth_pubkey', null);
			const storedMethod = await dbHelpers.getSetting<AuthMethod | null>('auth_method', null);

			if (!storedPubkey || !storedMethod) return;

			if (storedMethod === 'extension') {
				await tryRestoreExtensionSession(storedPubkey, storedMethod);
			} else {
				await restoreCachedSession(storedPubkey, storedMethod);
			}
		} catch (e) {
			console.error('Failed to init auth:', e);
			error = 'Failed to initialize authentication. Please try again.';
		} finally {
			isLoading = false;
		}
	}

	/** Login with NIP-07 browser extension */
	async function loginWithExtension(): Promise<void> {
		isLoading = true;
		error = null;

		try {
			const pk = await ndkService.loginWithExtension();
			
			// Connect with timeout - don't block login if relays are slow
			const connectPromise = ndkService.connect();
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Connection timeout')), 10000)
			);
			
			try {
				await Promise.race([connectPromise, timeoutPromise]);
			} catch (e) {
				console.warn('Relay connection slow, continuing login anyway:', e);
			}

			pubkey = pk;
			npub = nip19.npubEncode(pk);
			method = 'extension';
			isAuthenticated = true;

			// Store auth state
			await dbHelpers.setSetting('auth_pubkey', pk);
			await dbHelpers.setSetting('auth_method', 'extension');

			// Fetch profile
			await fetchProfile();
		} catch (e) {
			console.error('Extension login failed:', e);
			// User-friendly message without exposing internal details
			error = 'Failed to login with extension. Please ensure your extension is unlocked and try again.';
			throw e;
		} finally {
			isLoading = false;
		}
	}

	/** Login with private key */
	async function loginWithPrivateKey(privateKey: string): Promise<void> {
		isLoading = true;
		error = null;

		try {
			// Validate the private key format first
			const validatedKey = validatePrivateKey(privateKey.trim());
			if (!validatedKey) {
				throw new Error('Invalid private key format. Please enter a valid nsec or 64-character hex key.');
			}

			const pk = await ndkService.loginWithPrivateKey(validatedKey);
			
			// Validate the resulting pubkey
			const pubkeyValidation = pubkeySchema.safeParse(pk);
			if (!pubkeyValidation.success) {
				throw new Error('Key derivation resulted in invalid public key');
			}
			
			// Connect with timeout - don't block login if relays are slow
			const connectPromise = ndkService.connect();
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Connection timeout')), 10000)
			);
			
			try {
				await Promise.race([connectPromise, timeoutPromise]);
			} catch (e) {
				console.warn('Relay connection slow, continuing login anyway:', e);
			}

			pubkey = pk;
			npub = nip19.npubEncode(pk);
			method = 'privatekey';
			isAuthenticated = true;

			// Store auth state (but NOT the private key!)
			await dbHelpers.setSetting('auth_pubkey', pk);
			await dbHelpers.setSetting('auth_method', 'privatekey');

			// Fetch profile
			await fetchProfile();
		} catch (e) {
			console.error('Private key login failed:', e);
			// Provide helpful message for common key format issues
			if (e instanceof Error && e.message.includes('Invalid private key format')) {
				error = 'Invalid key format. Please enter a valid nsec, 64-character hex key, or 12-word recovery phrase.';
			} else {
				error = 'Failed to login with private key. Please check your key and try again.';
			}
			throw e;
		} finally {
			isLoading = false;
		}
	}

	/** Generate new keypair and login */
	async function generateAndLogin(): Promise<{ nsec: string; npub: string }> {
		isLoading = true;
		error = null;

		try {
			const result = await ndkService.loginWithNewKeypair();
			
			// Connect with timeout - don't block login if relays are slow
			const connectPromise = ndkService.connect();
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Connection timeout')), 10000)
			);
			
			try {
				await Promise.race([connectPromise, timeoutPromise]);
			} catch (e) {
				console.warn('Relay connection slow, continuing login anyway:', e);
			}

			pubkey = result.pubkey;
			npub = result.npub;
			method = 'generated';
			isAuthenticated = true;

			// Store auth state
			await dbHelpers.setSetting('auth_pubkey', result.pubkey);
			await dbHelpers.setSetting('auth_method', 'generated');

			return {
				nsec: result.nsec,
				npub: result.npub
			};
		} catch (e) {
			console.error('Key generation failed:', e);
			// Generic message for key generation failure
			error = 'Failed to generate new account. Please try again.';
			throw e;
		} finally {
			isLoading = false;
		}
	}

	/** Fetch and update user profile */
	async function fetchProfile(): Promise<void> {
		if (!pubkey) return;

		try {
			// First check cache
			const cachedProfile = await dbHelpers.getProfile(pubkey);
			if (cachedProfile) {
				profile = cachedProfile;
			}

			// Then fetch fresh
			const event = await ndkService.fetchProfile(pubkey);
			if (event?.content) {
				try {
					const parsed = JSON.parse(event.content);
					profile = {
						pubkey,
						...parsed,
						updated_at: Date.now()
					};
				} catch (parseError) {
					console.warn('[Auth] Failed to parse profile content:', parseError);
					// Keep the cached profile if parsing fails
				}
			}
		} catch (e) {
			console.error('Failed to fetch profile:', e);
		}
	}

	/** Logout */
	async function logout(): Promise<void> {
		ndkService.logout();

		isAuthenticated = false;
		pubkey = null;
		npub = null;
		method = null;
		profile = null;
		error = null;

		// Clear stored auth
		await dbHelpers.setSetting('auth_pubkey', null);
		await dbHelpers.setSetting('auth_method', null);
	}

	/**
	 * PANIC WIPE - Security feature
	 * Completely wipes all local data including:
	 * - Keys and authentication
	 * - IndexedDB (Dexie)
	 * - localStorage
	 * - sessionStorage
	 * - Service Worker caches
	 */
	async function panicWipe(): Promise<void> {
		isLoading = true;

		try {
			// 1. Logout from NDK
			ndkService.logout();

			// 2. Clear IndexedDB (Dexie tables)
			await db.events.clear();
			await db.profiles.clear();
			await db.conversations.clear();
			await db.contacts.clear();
			await db.relays.clear();
			await db.settings.clear();
			await db.drafts.clear();
			await db.mutes.clear();
			await db.outbox.clear();

			// 3. Clear localStorage
			if (typeof localStorage !== 'undefined') {
				localStorage.clear();
			}

			// 4. Clear sessionStorage
			if (typeof sessionStorage !== 'undefined') {
				sessionStorage.clear();
			}

			// 5. Clear Service Worker caches
			if ('caches' in globalThis) {
				const cacheNames = await caches.keys();
				await Promise.all(
					cacheNames.map((cacheName) => caches.delete(cacheName))
				);
			}

			// 6. Unregister Service Workers
			if ('serviceWorker' in navigator) {
				const registrations = await navigator.serviceWorker.getRegistrations();
				await Promise.all(
					registrations.map((registration) => registration.unregister())
				);
			}

			// 7. Reset store state
			isAuthenticated = false;
			pubkey = null;
			npub = null;
			method = null;
			profile = null;
			error = null;

			// 8. Redirect to login
			if (globalThis.window !== undefined) {
				globalThis.location.href = '/login';
			}
		} catch (e) {
			console.error('Panic wipe failed:', e);
			// Even if some steps fail, try to redirect
			if (globalThis.window !== undefined) {
				globalThis.location.href = '/login';
			}
		} finally {
			isLoading = false;
		}
	}

	return {
		// State (readonly)
		get isAuthenticated() {
			return isAuthenticated;
		},
		get pubkey() {
			return pubkey;
		},
		get npub() {
			return npub;
		},
		get method() {
			return method;
		},
		get profile() {
			return profile;
		},
		get isLoading() {
			return isLoading;
		},
		get error() {
			return error;
		},
		get displayName() {
			return displayName;
		},
		get avatar() {
			return avatar;
		},

		// Actions
		init,
		loginWithExtension,
		loginWithPrivateKey,
		generateAndLogin,
		fetchProfile,
		logout,
		hasExtension,
		panicWipe
	};
}

/** Auth store singleton */
export const authStore = createAuthStore();

export default authStore;
