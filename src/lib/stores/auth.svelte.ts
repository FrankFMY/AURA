import { nip19 } from 'nostr-tools';
import ndkService from '$services/ndk';
import { dbHelpers, type UserProfile } from '$db';
import { validatePrivateKey, pubkeySchema } from '$lib/validators/schemas';

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

	/** Initialize auth from stored session */
	async function init(): Promise<void> {
		isLoading = true;
		error = null;

		try {
			// Check for stored auth
			const storedPubkey = await dbHelpers.getSetting<string | null>('auth_pubkey', null);
			const storedMethod = await dbHelpers.getSetting<AuthMethod | null>('auth_method', null);

			if (storedPubkey && storedMethod) {
				// Try to restore session
				if (storedMethod === 'extension') {
					// Re-authenticate with extension
					if (window.nostr) {
						await loginWithExtension();
					}
				} else {
					// For private key, we don't store it, user needs to re-enter
					// Just set the pubkey to show they were logged in
					pubkey = storedPubkey;
					npub = nip19.npubEncode(storedPubkey);
					method = storedMethod;
					
					// Load cached profile
					const cachedProfile = await dbHelpers.getProfile(storedPubkey);
					if (cachedProfile) {
						profile = cachedProfile;
					}
				}
			}
		} catch (e) {
			console.error('Failed to init auth:', e);
			error = e instanceof Error ? e.message : 'Failed to initialize auth';
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
			error = e instanceof Error ? e.message : 'Failed to login with extension';
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
			error = e instanceof Error ? e.message : 'Invalid private key';
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
			error = e instanceof Error ? e.message : 'Failed to generate keypair';
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
			if (event) {
				const parsed = JSON.parse(event.content);
				profile = {
					pubkey,
					...parsed,
					updated_at: Date.now()
				};
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

	/** Check if extension is available */
	function hasExtension(): boolean {
		return typeof window !== 'undefined' && !!window.nostr;
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
		hasExtension
	};
}

/** Auth store singleton */
export const authStore = createAuthStore();

export default authStore;
