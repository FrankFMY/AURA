/**
 * Feed Store
 * 
 * Manages the social feed with optimistic updates and proper cleanup.
 */

import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import ndkService, { subscriptionManager } from '$services/ndk';
import { dbHelpers, type UserProfile } from '$db';
import { ErrorHandler } from '$lib/core/errors';
import { contactsService } from '$lib/services/contacts';
import { userInteractionsService } from '$lib/services/user-interactions';

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

/** Check if an event should be filtered (deleted by user) */
function shouldFilterEvent(eventId: string): boolean {
	return userInteractionsService.isDeleted(eventId);
}

/** Create feed store */
function createFeedStore() {
	// State
	let events = $state<FeedEvent[]>([]);
	let queuedEvents = $state<FeedEvent[]>([]);
	let isLoading = $state(false);
	let isLoadingMore = $state(false);
	let hasMore = $state(true);
	let error = $state<string | null>(null);
	let feedType = $state<FeedType>('global');
	let feedParam = $state<string | undefined>(undefined);

	// Subscription management
	let currentSubscriptionId: string | null = null;
	const subscriptionLabel = 'feed-main';
	let loadingTimeout: ReturnType<typeof setTimeout> | null = null;

	// Caches
	const profileCache = new Map<string, UserProfile>();
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
		void ndkService.fetchProfile(pubkey).then(async () => {
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

		// Check if current user has interacted with this event
		const hasReacted = userInteractionsService.hasReacted(event.id);
		const hasReposted = userInteractionsService.hasReposted(event.id);

		return {
			event,
			author,
			replyCount: 0,
			reactionCount: 0, // Counts are fetched separately via reactions subscription
			repostCount: 0,
			hasReacted,
			hasReposted
		};
	}

	/** Insert event in chronological order */
	function insertEventChronologically(feedEvent: FeedEvent, eventCreatedAt: number | undefined): void {
		const insertIndex = events.findIndex(
			(e) => (e.event.created_at || 0) < (eventCreatedAt || 0)
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
	}

	/** Process a new event from subscription */
	async function processNewEvent(event: NDKEvent): Promise<void> {
		const feedEvent = await toFeedEvent(event);

		// If we are not loading (initial load done), queue the event
		if (!isLoading) {
			queuedEvents = [feedEvent, ...queuedEvents];
			return;
		}

		// Insert in chronological order
		insertEventChronologically(feedEvent, event.created_at);

		// Cache event
		if (event.kind !== undefined && event.created_at !== undefined && event.sig !== undefined) {
			void dbHelpers.saveEvent({
				id: event.id,
				pubkey: event.pubkey,
				kind: event.kind,
				created_at: event.created_at,
				content: event.content,
				tags: event.tags,
				sig: event.sig
			}).catch(console.error);
		}
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
		case 'following': {
			// Get following list from NIP-02 contact list
			const followingPubkeys = contactsService.getContactPubkeys();
			if (followingPubkeys.length > 0) {
				filter.authors = followingPubkeys;
			}
			// If no contacts, filter stays without authors (handled in load())
			break;
		}
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

		// Clear previous timeout if any
		if (loadingTimeout) {
			clearTimeout(loadingTimeout);
			loadingTimeout = null;
		}

		isLoading = true;
		error = null;
		feedType = type;
		feedParam = param;
		events = [];
		queuedEvents = [];
		seenIds.clear();
		hasMore = true;

		// Force finish loading after 3.5 seconds to prevent stuck spinner
		// This ensures UX stability even if some relays are slow
		loadingTimeout = setTimeout(() => {
			if (isLoading) {
				isLoading = false;
				loadingTimeout = null;
			}
		}, 3500);

		try {
			// Set up user interactions service with current user
			const authPubkey = (await import('./auth.svelte')).default.pubkey;
			userInteractionsService.setUser(authPubkey || null);

			// Fetch user interactions in background (don't block feed loading)
			if (authPubkey) {
				userInteractionsService.fetchAll().catch(console.error);
			}

			// Load contacts if we need them for following feed
			if (type === 'following') {
				if (authPubkey) {
					try {
						await contactsService.fetchContacts(authPubkey);
					} catch (e) {
						console.warn('Failed to fetch contacts, showing empty following feed:', e);
					}
				}
				
				// If user has no contacts, show empty state (not an error)
				const contacts = contactsService.getContactPubkeys();
				if (contacts.length === 0) {
					isLoading = false;
					hasMore = false;
					return; // Show empty state, not error
				}
			}

			const filter = buildFilter();

			// First load from cache for instant display
			const cachedEvents = await dbHelpers.getEventsByKind(1, 30);
			if (cachedEvents.length > 0) {
				const feedEvents = await Promise.all(
					cachedEvents
						// Filter out duplicates and deleted events
						.filter(e => !seenIds.has(e.id) && !shouldFilterEvent(e.id))
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
				events = feedEvents.toSorted((a, b) =>
					(b.event.created_at || 0) - (a.event.created_at || 0)
				);
			}

			// Subscribe to live events
			currentSubscriptionId = subscriptionManager.subscribe(
				filter,
				{ closeOnEose: false },
				{
					onEvent: (event: NDKEvent) => {
						// Deduplicate
						if (seenIds.has(event.id)) return;
						seenIds.add(event.id);

						// Skip deleted events
						if (shouldFilterEvent(event.id)) return;

						void processNewEvent(event);
					},
					onEose: () => {
						isLoading = false;
						if (loadingTimeout) {
							clearTimeout(loadingTimeout);
							loadingTimeout = null;
						}
					}
				},
				subscriptionLabel
			);
		} catch (e) {
			// Use normalize() to avoid toast - errors are shown in UI
			const auraError = ErrorHandler.normalize(e);
			error = auraError.userMessage;
			isLoading = false;
			if (loadingTimeout) {
				clearTimeout(loadingTimeout);
				loadingTimeout = null;
			}
		}
	}

	/** Load more (pagination) */
	async function loadMore(): Promise<void> {
		if (isLoading || isLoadingMore || !hasMore || events.length === 0) return;

		isLoadingMore = true;

		try {
			const oldestEvent = events.at(-1)!;
			const until = oldestEvent.event.created_at;

			const filter = buildFilter();
			filter.limit = 20;
			filter.until = until;

			if (!ndkService.ndk) {
				console.warn('[Feed] NDK not initialized');
				return;
			}

			const newEvents = await ndkService.ndk.fetchEvents(filter);

			if (newEvents.size === 0) {
				hasMore = false;
			} else {
				const feedEvents = await Promise.all(
					Array.from(newEvents)
						// Filter out duplicates and deleted events
						.filter(e => !seenIds.has(e.id) && !shouldFilterEvent(e.id))
						.map(async (e) => {
							seenIds.add(e.id);
							return toFeedEvent(e);
						})
				);

				if (feedEvents.length === 0) {
					hasMore = false;
				} else {
					const sortedFeedEvents = feedEvents.toSorted((a, b) =>
						(b.event.created_at || 0) - (a.event.created_at || 0)
					);
					events = [...events, ...sortedFeedEvents];

					// Cache events
					for (const event of newEvents) {
						if (event.kind === undefined || event.created_at === undefined || event.sig === undefined) {
							continue;
						}
						dbHelpers.saveEvent({
							id: event.id,
							pubkey: event.pubkey,
							kind: event.kind,
							created_at: event.created_at,
							content: event.content,
							tags: event.tags,
							sig: event.sig
						}).catch(console.error);
					}
				}
			}
		} catch (e) {
			// Use normalize() to avoid toast - errors are shown in UI
			const auraError = ErrorHandler.normalize(e);
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
		const previousState = eventIndex >= 0 ? { ...events[eventIndex] } : null;

		// Optimistic update - both local state and interactions cache
		userInteractionsService.addReaction(event.id);

		// Update UI if event is in current feed
		if (eventIndex !== -1) {
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
		}

		try {
			await ndkService.react(event, reaction);
		} catch (e) {
			console.error('[feedStore] React failed:', e);
			// Rollback UI state if we had optimistic update
			if (previousState && eventIndex !== -1) {
				events = events.map(ev =>
					ev.event.id === event.id ? previousState : ev
				);
			}
			throw e;
		}
	}

	/** Repost an event with optimistic update */
	async function repost(event: NDKEvent): Promise<void> {
		const eventIndex = events.findIndex(e => e.event.id === event.id);
		const previousState = eventIndex >= 0 ? { ...events[eventIndex] } : null;

		// Optimistic update - both local state and interactions cache
		userInteractionsService.addRepost(event.id);

		// Update UI if event is in current feed
		if (eventIndex !== -1) {
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
		}

		try {
			await ndkService.repost(event);
		} catch (e) {
			// Rollback UI state if we had optimistic update
			if (previousState && eventIndex !== -1) {
				events = events.map(ev =>
					ev.event.id === event.id ? previousState : ev
				);
			}
			throw e;
		}
	}

	/** Delete a note with optimistic update */
	async function deleteNote(eventId: string): Promise<void> {
		const previousEvents = [...events];
		const eventIndex = events.findIndex(e => e.event.id === eventId);

		// Optimistic update: add to deletions cache
		userInteractionsService.addDeletion(eventId);

		// Remove from feed if present
		if (eventIndex !== -1) {
			events = events.filter(e => e.event.id !== eventId);
		}

		try {
			await ndkService.deleteEvent(eventId);
			// Also remove from seenIds
			seenIds.delete(eventId);
		} catch (e) {
			console.error('[feedStore] Delete failed:', e);
			// Rollback if we had optimistic update
			if (eventIndex !== -1) {
				events = previousEvents;
			}
			throw e;
		}
	}

	/** Refresh feed */
	async function refresh(): Promise<void> {
		await load(feedType, feedParam);
	}

	/** Show queued events */
	function showNewEvents() {
		if (queuedEvents.length === 0) return;

		// Merge and sort
		const allEvents = [...queuedEvents, ...events];
		events = allEvents.toSorted((a, b) =>
			(b.event.created_at || 0) - (a.event.created_at || 0)
		);

		queuedEvents = [];
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
		if (loadingTimeout) {
			clearTimeout(loadingTimeout);
			loadingTimeout = null;
		}
	}

	return {
		// State (readonly)
		get events() { return events; },
		get queuedEvents() { return queuedEvents; },
		get isLoading() { return isLoading; },
		get isLoadingMore() { return isLoadingMore; },
		get hasMore() { return hasMore; },
		get error() { return error; },
		get feedType() { return feedType; },

		// Actions
		load,
		loadMore,
		showNewEvents,
		publishNote,
		react,
		repost,
		deleteNote,
		refresh,
		clearError,
		cleanup
	};
}

/** Feed store singleton */
export const feedStore = createFeedStore();

export default feedStore;
