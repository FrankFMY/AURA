/**
 * Profile Store
 * 
 * Manages the current user's profile for editing and display.
 */

import { NDKEvent } from '@nostr-dev-kit/ndk';
import ndkService from '$services/ndk';
import { dbHelpers } from '$db';
import authStore from './auth.svelte';

/** Profile metadata fields */
export interface ProfileMetadata {
	name?: string;
	display_name?: string;
	about?: string;
	picture?: string;
	banner?: string;
	website?: string;
	nip05?: string;
	lud16?: string;
}

/** Create profile store */
function createProfileStore() {
	let profile = $state<ProfileMetadata>({});
	let isLoading = $state(false);
	let isSaving = $state(false);
	let error = $state<string | null>(null);
	let isDirty = $state(false);

	/** Load current user's profile */
	async function load(): Promise<void> {
		if (!authStore.pubkey) {
			error = 'Not authenticated';
			return;
		}

		isLoading = true;
		error = null;

		try {
			// Load from cache first
			const cached = await dbHelpers.getProfile(authStore.pubkey);
			if (cached) {
				profile = {
					name: cached.name,
					display_name: cached.display_name,
					about: cached.about,
					picture: cached.picture,
					banner: cached.banner,
					website: cached.website,
					nip05: cached.nip05,
					lud16: cached.lud16
				};
			}

			// Fetch fresh from relays
			const event = await ndkService.fetchProfile(authStore.pubkey);
			if (event?.content) {
				try {
					const parsed = JSON.parse(event.content);
					profile = {
						name: parsed.name,
						display_name: parsed.display_name,
						about: parsed.about,
						picture: parsed.picture,
						banner: parsed.banner,
						website: parsed.website,
						nip05: parsed.nip05,
						lud16: parsed.lud16
					};
				} catch (parseError) {
					console.warn('[Profile] Failed to parse profile content:', parseError);
					// Keep the cached profile if parsing fails
				}
			}

			isDirty = false;
		} catch (e) {
			console.error('Failed to load profile:', e);
			error = e instanceof Error ? e.message : 'Failed to load profile';
		} finally {
			isLoading = false;
		}
	}

	/** Update a field */
	function updateField<K extends keyof ProfileMetadata>(field: K, value: ProfileMetadata[K]): void {
		profile = { ...profile, [field]: value };
		isDirty = true;
	}

	/** Save profile to relays (kind:0) */
	async function save(): Promise<boolean> {
		if (!authStore.pubkey) {
			error = 'Not authenticated';
			return false;
		}

		if (!ndkService.signer) {
			error = 'No signer available';
			return false;
		}

		isSaving = true;
		error = null;

		try {
			// Create kind:0 event
			const event = new NDKEvent(ndkService.ndk);
			event.kind = 0;
			event.content = JSON.stringify(profile);

			// Sign and publish
			await ndkService.publish(event);

			// Update local cache
			await dbHelpers.saveProfile({
				pubkey: authStore.pubkey,
				...profile,
				updated_at: Date.now()
			});

			// Update auth store's profile reference
			await authStore.fetchProfile();

			isDirty = false;
			return true;
		} catch (e) {
			console.error('Failed to save profile:', e);
			error = e instanceof Error ? e.message : 'Failed to save profile';
			return false;
		} finally {
			isSaving = false;
		}
	}

	/** Reset to last saved state */
	async function reset(): Promise<void> {
		isDirty = false;
		await load();
	}

	/** Clear store */
	function clear(): void {
		profile = {};
		isDirty = false;
		error = null;
	}

	return {
		// State
		get profile() { return profile; },
		get isLoading() { return isLoading; },
		get isSaving() { return isSaving; },
		get error() { return error; },
		get isDirty() { return isDirty; },

		// Actions
		load,
		updateField,
		save,
		reset,
		clear
	};
}

/** Profile store singleton */
export const profileStore = createProfileStore();

export default profileStore;
