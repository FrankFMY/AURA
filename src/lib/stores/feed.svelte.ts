/**
 * Feed Store
 * 
 * Manages the social feed with optimistic updates and proper cleanup.
 */

import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import ndkService, { subscriptionManager } from '$services/ndk';
import { dbHelpers, type UserProfile } from '$db';
import { ErrorHandler, NetworkError, ErrorCode } from '$lib/core/errors';
import { contactsService } from '$lib/services/contacts';

/** Feed event with additional metadata */
export interface FeedEvent {
	event: NDKEvent;
	author: UserProfile | null;
	replyCount: number;
	reactionCount: number;
	repostCount: number;
	hasReacted: boolean;
	hasReposted: boolean;
	isOptimistic?: boolean;
}

/** Feed types */
export type FeedType = 'global' | 'following' | 'user' | 'replies' | 'hashtag';

/** Optimistic update for rollback */
interface OptimisticUpdate {
	id: string;
	type: 'add' | 'react' | 'repost';
	previousState?: FeedEvent;
	eventId?: string;
}

/** Create feed store */
function createFeedStore() {
	// State
	let events = $state<FeedEvent[]>([]);
	let isLoading = $state(false);
	let isLoadingMore = $state(false);
	let hasMore = $state(true);
	let error = $state<string | null>(null);
	let feedType = $state<FeedType>('global');
	let feedParam = $state<string | undefined>(undefined);

	// Subscription management
	let currentSubscriptionId: string | null = null;
	const subscriptionLabel = 'feed-main';

	// Caches
	const profileCache = new Map<string, UserProfile>();
	const reactionCache = new Map<string, { reactions: number; reposts: number }>();
	const optimisticUpdates: OptimisticUpdate[] = [];

	// Seen event IDs for deduplication
	const seenIds = new Set<string>();

	/** Get profile from cache or fetch */
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
				// Trigger reactivity by updating events
				updateEventsWithProfile(pubkey, profile);
			}
		}).catch(console.error);

		return null;
	}

	/** Update events with a newly fetched profile */
	function updateEventsWithProfile(pubkey: string, profile: UserProfile) {
		events = events.map((e) => {
			if (e.event.pubkey === pubkey && !e.author) {
				return { ...e, author: profile };
			}
			return e;
		});
	}

	/** Convert NDKEvent to FeedEvent */
	async function toFeedEvent(event: NDKEvent): Promise<FeedEvent> {
		const author = await getProfile(event.pubkey);
		const counts = reactionCache.get(event.id) || { reactions: 0, reposts: 0 };

		return {
			event,
			author,
			replyCount: 0,
			reactionCount: counts.reactions,
			repostCount: counts.reposts,
			hasReacted: false,
			hasReposted: false
		};
	}

	/** Stop current subscription */
	function stopSubscription() {
		if (currentSubscriptionId) {
			subscriptionManager.unsubscribe(currentSubscriptionId);
			currentSubscriptionId = null;
		}
		// Also clean up by label as fallback
		subscriptionManager.unsubscribeByLabel(subscriptionLabel);
	}

	/** Build filter based on feed type */
	function buildFilter(): NDKFilter {
		const filter: NDKFilter = {
			kinds: [1],
			limit: 30
		};

		switch (feedType) {
			case 'user':
				if (feedParam) {
					filter.authors = [feedParam];
				}
				break;
			case 'following':
				// Get following list from NIP-02 contact list
				const followingPubkeys = contactsService.getContactPubkeys();
				if (followingPubkeys.length > 0) {
					filter.authors = followingPubkeys;
				} else {
					// If no contacts, show nothing (or could fall back to global)
					filter.authors = ['nonexistent']; // Will return no results
				}
				break;
			case 'hashtag':
				if (feedParam) {
					filter['#t'] = [feedParam];
				}
				break;
			case 'replies':
				if (feedParam) {
					filter['#e'] = [feedParam];
				}
				break;
		}

		return filter;
	}

	/** Load initial feed */
	async function load(type: FeedType = 'global', param?: string): Promise<void> {
		stopSubscription();

		isLoading = true;
		error = null;
		feedType = type;
		feedParam = param;
		events = [];
		seenIds.clear();
		hasMore = true;

		try {
			// Load contacts if we need them for following feed
			if (type === 'following') {
				const authPubkey = (await import('./auth.svelte')).default.pubkey;
				if (authPubkey) {
					await contactsService.fetchContacts(authPubkey);
				}
			}

			const filter = buildFilter();

			// First load from cache for instant display
			const cachedEvents = await dbHelpers.getEventsByKind(1, 30);
			if (cachedEvents.length > 0) {
				const feedEvents = await Promise.all(
					cachedEvents
						.filter(e => !seenIds.has(e.id))
						.map(async (e) => {
							seenIds.add(e.id);
							const { NDKEvent } = await import('@nostr-dev-kit/ndk');
							const ndkEvent = new NDKEvent(ndkService.ndk);
							ndkEvent.id = e.id;
							ndkEvent.pubkey = e.pubkey;
							ndkEvent.kind = e.kind;
							ndkEvent.created_at = e.created_at;
							ndkEvent.content = e.content;
							ndkEvent.tags = e.tags;
							ndkEvent.sig = e.sig;
							return toFeedEvent(ndkEvent);
						})
				);
				events = feedEvents.sort((a, b) =>
					(b.event.created_at || 0) - (a.event.created_at || 0)
				);
			}

			// Subscribe to live events
			currentSubscriptionId = subscriptionManager.subscribe(
				filter,
				{ closeOnEose: false },
				{
					onEvent: async (event: NDKEvent) => {
						// Deduplicate
						if (seenIds.has(event.id)) return;
						seenIds.add(event.id);

						const feedEvent = await toFeedEvent(event);

						// Insert in chronological order
						const insertIndex = events.findIndex(
							(e) => (e.event.created_at || 0) < (event.created_at || 0)
						);

						if (insertIndex === -1) {
							events = [...events, feedEvent];
						} else {
							events = [
								...events.slice(0, insertIndex),
								feedEvent,
								...events.slice(insertIndex)
							];
						}

						// Cache event
						dbHelpers.saveEvent({
							id: event.id,
							pubkey: event.pubkey,
							kind: event.kind!,
							created_at: event.created_at!,
							content: event.content,
							tags: event.tags,
							sig: event.sig!
						}).catch(console.error);
					},
					onEose: () => {
						isLoading = false;
					}
				},
				subscriptionLabel
			);
		} catch (e) {
			const auraError = ErrorHandler.handle(e);
			error = auraError.userMessage;
			isLoading = false;
		}
	}

	/** Load more (pagination) */
	async function loadMore(): Promise<void> {
		if (isLoading || isLoadingMore || !hasMore || events.length === 0) return;

		isLoadingMore = true;

		try {
			const oldestEvent = events[events.length - 1];
			const until = oldestEvent.event.created_at;

			const filter = buildFilter();
			filter.limit = 20;
			filter.until = until;

			const newEvents = await ndkService.ndk.fetchEvents(filter);

			if (newEvents.size === 0) {
				hasMore = false;
			} else {
				const feedEvents = await Promise.all(
					Array.from(newEvents)
						.filter(e => !seenIds.has(e.id))
						.map(async (e) => {
							seenIds.add(e.id);
							return toFeedEvent(e);
						})
				);

				if (feedEvents.length === 0) {
					hasMore = false;
				} else {
					events = [...events, ...feedEvents.sort((a, b) =>
						(b.event.created_at || 0) - (a.event.created_at || 0)
					)];

					// Cache events
					for (const event of newEvents) {
						dbHelpers.saveEvent({
							id: event.id,
							pubkey: event.pubkey,
							kind: event.kind!,
							created_at: event.created_at!,
							content: event.content,
							tags: event.tags,
							sig: event.sig!
						}).catch(console.error);
					}
				}
			}
		} catch (e) {
			const auraError = ErrorHandler.handle(e);
			error = auraError.userMessage;
		} finally {
			isLoadingMore = false;
		}
	}

	/** Publish a new note with optimistic update */
	async function publishNote(content: string, replyTo?: NDKEvent): Promise<void> {
		// Create optimistic event
		const tempId = `optimistic-${Date.now()}`;
		const optimisticFeedEvent: FeedEvent = {
			event: {
				id: tempId,
				pubkey: ndkService.pubkey || '',
				kind: 1,
				created_at: Math.floor(Date.now() / 1000),
				content,
				tags: replyTo ? [['e', replyTo.id, '', 'reply']] : [],
				sig: ''
			} as unknown as NDKEvent,
			author: profileCache.get(ndkService.pubkey || '') || null,
			replyCount: 0,
			reactionCount: 0,
			repostCount: 0,
			hasReacted: false,
			hasReposted: false,
			isOptimistic: true
		};

		// Add optimistic event to top of feed
		events = [optimisticFeedEvent, ...events];
		optimisticUpdates.push({ id: tempId, type: 'add' });

		try {
			const event = await ndkService.publishNote(content, replyTo);
			const feedEvent = await toFeedEvent(event);

			// Replace optimistic with real event
			events = events.map(e =>
				e.event.id === tempId ? feedEvent : e
			);

			// Remove from optimistic updates
			const updateIndex = optimisticUpdates.findIndex(u => u.id === tempId);
			if (updateIndex !== -1) {
				optimisticUpdates.splice(updateIndex, 1);
			}
		} catch (e) {
			// Rollback optimistic update
			events = events.filter(e => e.event.id !== tempId);
			throw e;
		}
	}

	/** React to an event with optimistic update */
	async function react(event: NDKEvent, reaction: string = '+'): Promise<void> {
		const eventIndex = events.findIndex(e => e.event.id === event.id);
		if (eventIndex === -1) return;

		// Store previous state for rollback
		const previousState = { ...events[eventIndex] };

		// Optimistic update
		events = events.map((e) => {
			if (e.event.id === event.id) {
				return {
					...e,
					reactionCount: e.reactionCount + 1,
					hasReacted: true
				};
			}
			return e;
		});

		try {
			await ndkService.react(event, reaction);
		} catch (e) {
			// Rollback
			events = events.map(e =>
				e.event.id === event.id ? previousState : e
			);
			throw e;
		}
	}

	/** Repost an event with optimistic update */
	async function repost(event: NDKEvent): Promise<void> {
		const eventIndex = events.findIndex(e => e.event.id === event.id);
		if (eventIndex === -1) return;

		// Store previous state for rollback
		const previousState = { ...events[eventIndex] };

		// Optimistic update
		events = events.map((e) => {
			if (e.event.id === event.id) {
				return {
					...e,
					repostCount: e.repostCount + 1,
					hasReposted: true
				};
			}
			return e;
		});

		try {
			await ndkService.repost(event);
		} catch (e) {
			// Rollback
			events = events.map(e =>
				e.event.id === event.id ? previousState : e
			);
			throw e;
		}
	}

	/** Refresh feed */
	async function refresh(): Promise<void> {
		await load(feedType, feedParam);
	}

	/** Clear error */
	function clearError(): void {
		error = null;
	}

	/** Cleanup */
	function cleanup(): void {
		stopSubscription();
		seenIds.clear();
		optimisticUpdates.length = 0;
	}

	return {
		// State (readonly)
		get events() { return events; },
		get isLoading() { return isLoading; },
		get isLoadingMore() { return isLoadingMore; },
		get hasMore() { return hasMore; },
		get error() { return error; },
		get feedType() { return feedType; },

		// Actions
		load,
		loadMore,
		publishNote,
		react,
		repost,
		refresh,
		clearError,
		cleanup
	};
}

/** Feed store singleton */
export const feedStore = createFeedStore();

export default feedStore;
