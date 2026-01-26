/**
 * Bookmarks Store (NIP-51 kind:10003)
 *
 * Manages user's bookmarked notes with local caching and Nostr sync.
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import ndkService from '$services/ndk';
import { dbHelpers, type UserProfile } from '$db';
import { ErrorHandler } from '$lib/core/errors';

/** Bookmark entry */
export interface Bookmark {
	/** Event ID of the bookmarked note */
	eventId: string;
	/** When the bookmark was added (unix timestamp) */
	addedAt: number;
	/** Optional note/comment about the bookmark */
	note?: string;
}

/** Bookmarked event with metadata */
export interface BookmarkedEvent {
	event: NDKEvent;
	author: UserProfile | null;
	bookmark: Bookmark;
}

/** NIP-51 kind for bookmarks list */
const BOOKMARKS_KIND = 10003;

/** Create bookmarks store */
function createBookmarksStore() {
	// State
	let bookmarks = $state<Bookmark[]>([]);
	let bookmarkedEvents = $state<BookmarkedEvent[]>([]);
	let isLoading = $state(false);
	let isSyncing = $state(false);
	let error = $state<string | null>(null);

	// Reactive set for quick lookup (Svelte 5 rune)
	let bookmarkIds = $state<Set<string>>(new Set());

	/** Check if an event is bookmarked - returns reactive value */
	function isBookmarked(eventId: string): boolean {
		return bookmarkIds.has(eventId);
	}

	/** Load bookmarks from Nostr and local cache */
	async function load(): Promise<void> {
		const pubkey = ndkService.pubkey;
		if (!pubkey) return;

		isLoading = true;
		error = null;

		try {
			// First load from local storage for instant display
			const localBookmarks = await dbHelpers.getSetting<Bookmark[]>('bookmarks', []) ?? [];
			if (localBookmarks.length > 0) {
				bookmarks = localBookmarks;
				bookmarkIds = new Set(localBookmarks.map(b => b.eventId));
			}

			// Fetch from Nostr
			if (!ndkService.ndk) return;

			const events = await ndkService.ndk.fetchEvents({
				kinds: [BOOKMARKS_KIND],
				authors: [pubkey],
				limit: 1
			});

			if (events.size > 0) {
				const bookmarkEvent = Array.from(events)[0];
				const parsed = parseBookmarksEvent(bookmarkEvent);

				// Merge with local (local takes precedence for newer items)
				const merged = mergeBookmarks(bookmarks, parsed);
				bookmarks = merged;

				// Update reactive set
				bookmarkIds = new Set(merged.map(b => b.eventId));

				// Save locally
				await dbHelpers.setSetting('bookmarks', merged);
			}

			// Fetch bookmarked events
			await fetchBookmarkedEvents();
		} catch (e) {
			const auraError = ErrorHandler.normalize(e);
			error = auraError.userMessage;
			console.error('[Bookmarks] Load failed:', e);
		} finally {
			isLoading = false;
		}
	}

	/** Parse NIP-51 bookmarks event */
	function parseBookmarksEvent(event: NDKEvent): Bookmark[] {
		const result: Bookmark[] = [];

		for (const tag of event.tags) {
			if (tag[0] === 'e' && tag[1]) {
				result.push({
					eventId: tag[1],
					addedAt: event.created_at || Date.now() / 1000,
					note: tag[2] || undefined
				});
			}
		}

		return result;
	}

	/** Merge local and remote bookmarks */
	function mergeBookmarks(local: Bookmark[], remote: Bookmark[]): Bookmark[] {
		const merged = new Map<string, Bookmark>();

		// Add remote first
		for (const b of remote) {
			merged.set(b.eventId, b);
		}

		// Override with local if newer
		for (const b of local) {
			const existing = merged.get(b.eventId);
			if (!existing || b.addedAt > existing.addedAt) {
				merged.set(b.eventId, b);
			}
		}

		// Sort by addedAt descending
		return Array.from(merged.values())
			.sort((a, b) => b.addedAt - a.addedAt);
	}

	/** Fetch the actual events for bookmarks */
	async function fetchBookmarkedEvents(): Promise<void> {
		if (bookmarks.length === 0 || !ndkService.ndk) {
			bookmarkedEvents = [];
			return;
		}

		const eventIds = bookmarks.map(b => b.eventId);

		try {
			const events = await ndkService.ndk.fetchEvents({
				ids: eventIds
			});

			const eventsMap = new Map<string, NDKEvent>();
			events.forEach(e => eventsMap.set(e.id, e));

			// Build bookmarked events with metadata
			const result: BookmarkedEvent[] = [];

			for (const bookmark of bookmarks) {
				const event = eventsMap.get(bookmark.eventId);
				if (event) {
					const author = await dbHelpers.getProfile(event.pubkey) ?? null;
					result.push({ event, author, bookmark });
				}
			}

			bookmarkedEvents = result;
		} catch (e) {
			console.error('[Bookmarks] Failed to fetch events:', e);
		}
	}

	/** Add a bookmark */
	async function add(eventId: string, note?: string): Promise<void> {
		if (isBookmarked(eventId)) return;

		const bookmark: Bookmark = {
			eventId,
			addedAt: Math.floor(Date.now() / 1000),
			note
		};

		// Optimistic update
		bookmarks = [bookmark, ...bookmarks];
		bookmarkIds = new Set([eventId, ...bookmarkIds]);

		// Save locally
		await dbHelpers.setSetting('bookmarks', bookmarks);

		// Sync to Nostr
		await syncToNostr();
	}

	/** Remove a bookmark */
	async function remove(eventId: string): Promise<void> {
		if (!isBookmarked(eventId)) return;

		// Optimistic update
		bookmarks = bookmarks.filter(b => b.eventId !== eventId);
		bookmarkedEvents = bookmarkedEvents.filter(be => be.bookmark.eventId !== eventId);
		const newIds = new Set(bookmarkIds);
		newIds.delete(eventId);
		bookmarkIds = newIds;

		// Save locally
		await dbHelpers.setSetting('bookmarks', bookmarks);

		// Sync to Nostr
		await syncToNostr();
	}

	/** Toggle bookmark */
	async function toggle(eventId: string, note?: string): Promise<void> {
		if (isBookmarked(eventId)) {
			await remove(eventId);
		} else {
			await add(eventId, note);
		}
	}

	/** Sync bookmarks to Nostr (NIP-51) */
	async function syncToNostr(): Promise<void> {
		const pubkey = ndkService.pubkey;
		if (!pubkey || !ndkService.ndk) return;

		isSyncing = true;

		try {
			// Build tags for NIP-51 event
			// Note: kind 10003 is a replaceable event (NIP-51), no 'd' tag needed
			const tags: string[][] = [];

			for (const bookmark of bookmarks) {
				if (bookmark.note) {
					tags.push(['e', bookmark.eventId, bookmark.note]);
				} else {
					tags.push(['e', bookmark.eventId]);
				}
			}

			// Create and publish event
			const { NDKEvent } = await import('@nostr-dev-kit/ndk');
			const event = new NDKEvent(ndkService.ndk);
			event.kind = BOOKMARKS_KIND;
			event.content = '';
			event.tags = tags;

			await event.publish();
		} catch (e) {
			console.error('[Bookmarks] Sync failed:', e);
			// Don't throw - local state is still valid
		} finally {
			isSyncing = false;
		}
	}

	/** Get bookmark count */
	function getCount(): number {
		return bookmarks.length;
	}

	/** Clear error */
	function clearError(): void {
		error = null;
	}

	return {
		// State (readonly)
		get bookmarks() { return bookmarks; },
		get bookmarkedEvents() { return bookmarkedEvents; },
		get bookmarkIds() { return bookmarkIds; },
		get isLoading() { return isLoading; },
		get isSyncing() { return isSyncing; },
		get error() { return error; },
		get count() { return bookmarks.length; },

		// Actions
		load,
		add,
		remove,
		toggle,
		isBookmarked,
		getCount,
		clearError,
		syncToNostr
	};
}

/** Bookmarks store singleton */
export const bookmarksStore = createBookmarksStore();

export default bookmarksStore;
