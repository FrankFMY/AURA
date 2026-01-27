/**
 * User Interactions Service
 * 
 * Fetches and caches user's reactions, reposts, and deletions.
 * Used to determine hasReacted/hasReposted state and filter deleted posts.
 */

import type { NDKFilter } from '@nostr-dev-kit/ndk';
import ndkService from '$services/ndk';

/** Interaction types */
export interface UserInteractionState {
	/** Event IDs the user has reacted to (kind 7) */
	reactions: Set<string>;
	/** Event IDs the user has reposted (kind 6) */
	reposts: Set<string>;
	/** Event IDs the user has deleted (kind 5) */
	deletions: Set<string>;
	/** Timestamp of last fetch */
	lastFetched: number;
}

/** Default TTL for cached interactions (5 minutes) */
const CACHE_TTL = 5 * 60 * 1000;

/**
 * User Interactions Service Class
 * 
 * Manages fetching and caching of user's interactions with events.
 */
class UserInteractionsService {
	private readonly _state: UserInteractionState = {
		reactions: new Set(),
		reposts: new Set(),
		deletions: new Set(),
		lastFetched: 0
	};
	
	private _userPubkey: string | null = null;
	private _isFetching: boolean = false;
	private _fetchPromise: Promise<void> | null = null;

	/** Set the current user's pubkey */
	setUser(pubkey: string | null): void {
		if (this._userPubkey !== pubkey) {
			this._userPubkey = pubkey;
			// Clear cache when user changes
			this.clear();
		}
	}

	/** Check if user has reacted to an event */
	hasReacted(eventId: string): boolean {
		return this._state.reactions.has(eventId);
	}

	/** Check if user has reposted an event */
	hasReposted(eventId: string): boolean {
		return this._state.reposts.has(eventId);
	}

	/** Check if event has been deleted by user */
	isDeleted(eventId: string): boolean {
		return this._state.deletions.has(eventId);
	}

	/** Add a reaction locally (for optimistic updates) */
	addReaction(eventId: string): void {
		this._state.reactions.add(eventId);
	}

	/** Add a repost locally (for optimistic updates) */
	addRepost(eventId: string): void {
		this._state.reposts.add(eventId);
	}

	/** Add a deletion locally (for optimistic updates) */
	addDeletion(eventId: string): void {
		this._state.deletions.add(eventId);
	}

	/** Check if cache is stale */
	private isCacheStale(): boolean {
		return Date.now() - this._state.lastFetched > CACHE_TTL;
	}

	/**
	 * Fetch user interactions for a set of event IDs.
	 * This fetches reactions, reposts, and deletions from the current user.
	 */
	async fetchForEvents(eventIds: string[]): Promise<void> {
		if (!this._userPubkey || eventIds.length === 0) {
			return;
		}

		// If already fetching, wait for that to complete
		if (this._isFetching && this._fetchPromise) {
			await this._fetchPromise;
			return;
		}

		// Skip if cache is fresh and we have data
		if (!this.isCacheStale() && this._state.lastFetched > 0) {
			return;
		}

		this._isFetching = true;
		this._fetchPromise = this._doFetch(eventIds);

		try {
			await this._fetchPromise;
		} finally {
			this._isFetching = false;
			this._fetchPromise = null;
		}
	}

	/** Internal fetch implementation */
	private async _doFetch(eventIds: string[]): Promise<void> {
		if (!this._userPubkey) return;
		if (!ndkService.ndk) {
			console.warn('[UserInteractions] NDK not initialized');
			return;
		}

		try {
			// Fetch reactions (kind 7) from current user targeting these events
			const reactionsFilter: NDKFilter = {
				kinds: [7],
				authors: [this._userPubkey],
				'#e': eventIds,
				limit: 500
			};

			// Fetch reposts (kind 6) from current user targeting these events
			const repostsFilter: NDKFilter = {
				kinds: [6],
				authors: [this._userPubkey],
				'#e': eventIds,
				limit: 500
			};

			// Fetch deletions (kind 5) from current user
			// We need ALL deletions, not just for these event IDs
			const deletionsFilter: NDKFilter = {
				kinds: [5],
				authors: [this._userPubkey],
				limit: 500
			};

			// Fetch all in parallel
			const [reactionsSet, repostsSet, deletionsSet] = await Promise.all([
				ndkService.ndk.fetchEvents(reactionsFilter),
				ndkService.ndk.fetchEvents(repostsFilter),
				ndkService.ndk.fetchEvents(deletionsFilter)
			]);

			// Process reactions - extract target event IDs from 'e' tags
			for (const event of reactionsSet) {
				const targetEventId = event.tags.find(t => t[0] === 'e')?.[1];
				if (targetEventId) {
					this._state.reactions.add(targetEventId);
				}
			}

			// Process reposts
			for (const event of repostsSet) {
				const targetEventId = event.tags.find(t => t[0] === 'e')?.[1];
				if (targetEventId) {
					this._state.reposts.add(targetEventId);
				}
			}

			// Process deletions
			for (const event of deletionsSet) {
				// Deletion events can have multiple 'e' tags for batch deletion
				for (const tag of event.tags) {
					if (tag[0] === 'e') {
						this._state.deletions.add(tag[1]);
					}
				}
			}

			this._state.lastFetched = Date.now();

		} catch (error) {
			console.error('[UserInteractions] Failed to fetch interactions:', error);
			// Don't throw - allow the app to continue with stale/empty state
		}
	}

	/**
	 * Fetch all user interactions (not limited to specific events).
	 * Useful for initial load or refresh.
	 */
	async fetchAll(): Promise<void> {
		if (!this._userPubkey) {
			return;
		}

		// If already fetching, wait for that to complete
		if (this._isFetching && this._fetchPromise) {
			await this._fetchPromise;
			return;
		}

		this._isFetching = true;
		this._fetchPromise = this._doFetchAll();

		try {
			await this._fetchPromise;
		} finally {
			this._isFetching = false;
			this._fetchPromise = null;
		}
	}

	/** Internal fetch all implementation */
	private async _doFetchAll(): Promise<void> {
		if (!this._userPubkey) return;
		if (!ndkService.ndk) {
			console.warn('[UserInteractions] NDK not initialized');
			return;
		}

		// Only fetch recent interactions (last 30 days)
		const since = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

		try {
			// Fetch all reactions from current user
			const reactionsFilter: NDKFilter = {
				kinds: [7],
				authors: [this._userPubkey],
				since,
				limit: 1000
			};

			// Fetch all reposts from current user
			const repostsFilter: NDKFilter = {
				kinds: [6],
				authors: [this._userPubkey],
				since,
				limit: 1000
			};

			// Fetch all deletions from current user
			const deletionsFilter: NDKFilter = {
				kinds: [5],
				authors: [this._userPubkey],
				limit: 500
			};

			// Fetch all in parallel
			const [reactionsSet, repostsSet, deletionsSet] = await Promise.all([
				ndkService.ndk.fetchEvents(reactionsFilter),
				ndkService.ndk.fetchEvents(repostsFilter),
				ndkService.ndk.fetchEvents(deletionsFilter)
			]);

			// Clear existing state before repopulating
			this._state.reactions.clear();
			this._state.reposts.clear();
			this._state.deletions.clear();

			// Process reactions
			for (const event of reactionsSet) {
				const targetEventId = event.tags.find(t => t[0] === 'e')?.[1];
				if (targetEventId) {
					this._state.reactions.add(targetEventId);
				}
			}

			// Process reposts
			for (const event of repostsSet) {
				const targetEventId = event.tags.find(t => t[0] === 'e')?.[1];
				if (targetEventId) {
					this._state.reposts.add(targetEventId);
				}
			}

			// Process deletions
			for (const event of deletionsSet) {
				for (const tag of event.tags) {
					if (tag[0] === 'e') {
						this._state.deletions.add(tag[1]);
					}
				}
			}

			this._state.lastFetched = Date.now();

		} catch (error) {
			console.error('[UserInteractions] Failed to fetch all interactions:', error);
		}
	}

	/** Get counts for debugging */
	getStats(): { reactions: number; reposts: number; deletions: number; lastFetched: number } {
		return {
			reactions: this._state.reactions.size,
			reposts: this._state.reposts.size,
			deletions: this._state.deletions.size,
			lastFetched: this._state.lastFetched
		};
	}

	/** Clear all cached interactions */
	clear(): void {
		this._state.reactions.clear();
		this._state.reposts.clear();
		this._state.deletions.clear();
		this._state.lastFetched = 0;
	}
}

/** Singleton instance */
export const userInteractionsService = new UserInteractionsService();

export default userInteractionsService;
