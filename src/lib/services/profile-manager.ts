/**
 * Profile Manager Service
 * 
 * Handles profile editing, NIP-05 verification, and profile metadata.
 */

import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk';
import ndkService from '$services/ndk';
import { dbHelpers, type UserProfile } from '$db';
import { ValidationError, ErrorCode } from '$lib/core/errors';
import { profileMetadataSchema, nip05Schema, validate } from '$lib/validators/schemas';

/** Profile update data */
export interface ProfileUpdate {
	name?: string;
	display_name?: string;
	about?: string;
	picture?: string;
	banner?: string;
	nip05?: string;
	lud16?: string;
	website?: string;
}

/** NIP-05 verification result */
export interface Nip05VerificationResult {
	valid: boolean;
	pubkey?: string;
	relays?: string[];
	error?: string;
}

/**
 * Profile Manager Class
 */
class ProfileManager {
	private _currentProfile: UserProfile | null = null;

	/** Get current user's profile */
	get currentProfile(): UserProfile | null {
		return this._currentProfile;
	}

	/**
	 * Fetch profile from relays
	 */
	async fetchProfile(pubkey: string): Promise<UserProfile | null> {
		// Check local cache first
		const cached = await dbHelpers.getProfile(pubkey);
		if (cached && Date.now() - cached.updated_at < 5 * 60 * 1000) {
			if (pubkey === ndkService.pubkey) {
				this._currentProfile = cached;
			}
			return cached;
		}

		// Fetch from relays
		const filter: NDKFilter = {
			kinds: [0],
			authors: [pubkey],
			limit: 1
		};

		try {
			if (!ndkService.ndk) {
				console.warn('[ProfileManager] NDK not initialized');
				return cached || null;
			}
			const events = await ndkService.ndk.fetchEvents(filter);
			const latestEvent = Array.from(events)
				.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];

			if (latestEvent) {
				const profile = this.parseProfileEvent(latestEvent);
				await dbHelpers.saveProfile(profile);

				if (pubkey === ndkService.pubkey) {
					this._currentProfile = profile;
				}

				return profile;
			}
		} catch (error) {
			console.error('Failed to fetch profile:', error);
		}

		return cached || null;
	}

	/**
	 * Parse profile from kind:0 event
	 */
	private parseProfileEvent(event: NDKEvent): UserProfile {
		let metadata: Record<string, unknown> = {};

		try {
			metadata = JSON.parse(event.content);
		} catch {
			console.error('Failed to parse profile metadata');
		}

		return {
			pubkey: event.pubkey,
			name: metadata.name as string | undefined,
			display_name: metadata.display_name as string | undefined,
			about: metadata.about as string | undefined,
			picture: metadata.picture as string | undefined,
			banner: metadata.banner as string | undefined,
			nip05: metadata.nip05 as string | undefined,
			lud16: metadata.lud16 as string | undefined,
			website: metadata.website as string | undefined,
			updated_at: (event.created_at || 0) * 1000
		};
	}

	/**
	 * Update profile
	 */
	async updateProfile(update: ProfileUpdate): Promise<UserProfile> {
		if (!ndkService.pubkey) {
			throw new ValidationError('Not logged in', undefined, { code: ErrorCode.AUTH_FAILED });
		}

		// Validate update data
		const validation = validate(profileMetadataSchema, update);
		if (!validation.success) {
			throw new ValidationError(validation.error, undefined, { code: ErrorCode.VALIDATION_ERROR });
		}

		// Get current profile
		const currentProfile = await this.fetchProfile(ndkService.pubkey);

		// Merge with existing profile
		const newMetadata = {
			name: update.name ?? currentProfile?.name,
			display_name: update.display_name ?? currentProfile?.display_name,
			about: update.about ?? currentProfile?.about,
			picture: update.picture ?? currentProfile?.picture,
			banner: update.banner ?? currentProfile?.banner,
			nip05: update.nip05 ?? currentProfile?.nip05,
			lud16: update.lud16 ?? currentProfile?.lud16,
			website: update.website ?? currentProfile?.website
		};

		// Remove undefined/empty values
		const cleanMetadata = Object.fromEntries(
			Object.entries(newMetadata).filter(([_, v]) => v !== undefined && v !== '')
		);

		// Create and publish kind:0 event
		if (!ndkService.ndk) {
			throw new ValidationError('NDK not initialized', undefined, { code: ErrorCode.AUTH_FAILED });
		}
		const event = new NDKEvent(ndkService.ndk);
		event.kind = 0;
		event.content = JSON.stringify(cleanMetadata);

		await ndkService.publish(event);

		// Update local cache
		const updatedProfile: UserProfile = {
			pubkey: ndkService.pubkey,
			...cleanMetadata,
			updated_at: Date.now()
		};

		await dbHelpers.saveProfile(updatedProfile);
		this._currentProfile = updatedProfile;

		return updatedProfile;
	}

	/**
	 * Verify NIP-05 identifier
	 */
	async verifyNip05(nip05: string): Promise<Nip05VerificationResult> {
		// Validate format
		const validation = validate(nip05Schema, nip05);
		if (!validation.success) {
			return { valid: false, error: validation.error };
		}

		const [name, domain] = nip05.split('@');
		if (!name || !domain) {
			return { valid: false, error: 'Invalid NIP-05 format' };
		}

		try {
			// Fetch .well-known/nostr.json
			const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;
			const response = await fetch(url);

			if (!response.ok) {
				return { valid: false, error: `HTTP ${response.status}` };
			}

			const data = await response.json();

			// Check if name exists
			const pubkey = data.names?.[name];
			if (!pubkey) {
				return { valid: false, error: 'Name not found' };
			}

			// Get relays if available
			const relays = data.relays?.[pubkey] as string[] | undefined;

			return {
				valid: true,
				pubkey,
				relays
			};
		} catch (error) {
			return {
				valid: false,
				error: error instanceof Error ? error.message : 'Verification failed'
			};
		}
	}

	/**
	 * Check if NIP-05 matches pubkey
	 */
	async isNip05Valid(nip05: string, pubkey: string): Promise<boolean> {
		const result = await this.verifyNip05(nip05);
		return result.valid && result.pubkey === pubkey;
	}

	/**
	 * Get display name for a pubkey
	 */
	async getDisplayName(pubkey: string): Promise<string> {
		const profile = await this.fetchProfile(pubkey);
		return profile?.display_name || profile?.name || this.truncatePubkey(pubkey);
	}

	/**
	 * Truncate pubkey for display
	 */
	truncatePubkey(pubkey: string): string {
		if (pubkey.length <= 12) return pubkey;
		return `${pubkey.slice(0, 8)}...${pubkey.slice(-4)}`;
	}

	/**
	 * Search profiles by name or NIP-05
	 */
	async searchProfiles(query: string, limit: number = 20): Promise<UserProfile[]> {
		// Search local DB first
		const localResults = await this.searchLocalProfiles(query, limit);

		// If we have enough results, return them
		if (localResults.length >= limit) {
			return localResults.slice(0, limit);
		}

		// Otherwise, try to search via relays (if relay supports NIP-50)
		// This is a simplified version - real implementation would use NIP-50
		return localResults;
	}

	/**
	 * Search local profile cache
	 */
	private async searchLocalProfiles(_query: string, _limit: number): Promise<UserProfile[]> {
		// TODO: Implement proper search in DB
		// For now, return empty - would need to implement proper search
		return [];
	}

	/**
	 * Clear profile cache
	 */
	clearCache(): void {
		this._currentProfile = null;
	}
}

/** Singleton instance */
export const profileManager = new ProfileManager();

export default profileManager;
