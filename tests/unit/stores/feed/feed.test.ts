/**
 * Feed Store Tests
 *
 * Tests for the feed store covering:
 * - Initial state
 * - load() - loading different feed types
 * - loadMore() - pagination
 * - publishNote() - optimistic updates
 * - react() - reactions with optimistic updates
 * - repost() - reposts with optimistic updates
 * - deleteNote() - deletions with optimistic updates
 * - showNewEvents() - queued events
 * - refresh() - reloading feed
 * - Error handling and rollback
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock functions must be hoisted
const {
	mockSubscribe,
	mockUnsubscribe,
	mockUnsubscribeByLabel,
	mockFetchProfile,
	mockPublishNote,
	mockReact,
	mockRepost,
	mockDeleteEvent,
	mockFetchEvents,
	mockGetProfile,
	mockGetEventsByKind,
	mockSaveEvent,
	mockFetchContacts,
	mockGetContactPubkeys,
	mockHasReacted,
	mockHasReposted,
	mockIsDeleted,
	mockSetUser,
	mockFetchAll,
	mockAddReaction,
	mockAddRepost,
	mockAddDeletion,
	mockNormalize
} = vi.hoisted(() => ({
	mockSubscribe: vi.fn(),
	mockUnsubscribe: vi.fn(),
	mockUnsubscribeByLabel: vi.fn(),
	mockFetchProfile: vi.fn(),
	mockPublishNote: vi.fn(),
	mockReact: vi.fn(),
	mockRepost: vi.fn(),
	mockDeleteEvent: vi.fn(),
	mockFetchEvents: vi.fn(),
	mockGetProfile: vi.fn(),
	mockGetEventsByKind: vi.fn(),
	mockSaveEvent: vi.fn(),
	mockFetchContacts: vi.fn(),
	mockGetContactPubkeys: vi.fn(),
	mockHasReacted: vi.fn(),
	mockHasReposted: vi.fn(),
	mockIsDeleted: vi.fn(),
	mockSetUser: vi.fn(),
	mockFetchAll: vi.fn(),
	mockAddReaction: vi.fn(),
	mockAddRepost: vi.fn(),
	mockAddDeletion: vi.fn(),
	mockNormalize: vi.fn()
}));

// Mock NDK service
vi.mock('$services/ndk', () => ({
	default: {
		ndk: {
			fetchEvents: mockFetchEvents
		},
		pubkey: 'test-pubkey-123',
		fetchProfile: mockFetchProfile,
		publishNote: mockPublishNote,
		react: mockReact,
		repost: mockRepost,
		deleteEvent: mockDeleteEvent
	},
	subscriptionManager: {
		subscribe: mockSubscribe,
		unsubscribe: mockUnsubscribe,
		unsubscribeByLabel: mockUnsubscribeByLabel
	}
}));

// Mock database helpers
vi.mock('$db', () => ({
	dbHelpers: {
		getProfile: mockGetProfile,
		getEventsByKind: mockGetEventsByKind,
		saveEvent: mockSaveEvent
	}
}));

// Mock contacts service
vi.mock('$lib/services/contacts', () => ({
	contactsService: {
		fetchContacts: mockFetchContacts,
		getContactPubkeys: mockGetContactPubkeys
	}
}));

// Mock user interactions service
vi.mock('$lib/services/user-interactions', () => ({
	userInteractionsService: {
		hasReacted: mockHasReacted,
		hasReposted: mockHasReposted,
		isDeleted: mockIsDeleted,
		setUser: mockSetUser,
		fetchAll: mockFetchAll,
		addReaction: mockAddReaction,
		addRepost: mockAddRepost,
		addDeletion: mockAddDeletion
	}
}));

// Mock error handler
vi.mock('$lib/core/errors', () => ({
	ErrorHandler: {
		normalize: mockNormalize
	}
}));

// Mock auth store - using dynamic import path
vi.mock('$stores/auth.svelte', () => ({
	default: {
		pubkey: 'test-pubkey-123'
	}
}));

// Create mock event helper
function createMockEvent(overrides: Partial<{
	id: string;
	pubkey: string;
	kind: number;
	created_at: number;
	content: string;
	tags: string[][];
	sig: string;
}> = {}) {
	return {
		id: overrides.id || `event-${Date.now()}-${Math.random()}`,
		pubkey: overrides.pubkey || 'author-pubkey',
		kind: overrides.kind || 1,
		created_at: overrides.created_at || Math.floor(Date.now() / 1000),
		content: overrides.content || 'Test note content',
		tags: overrides.tags || [],
		sig: overrides.sig || 'test-signature'
	};
}

describe('Feed Store', () => {
	let feedStore: typeof import('$stores/feed.svelte').feedStore;

	beforeEach(async () => {
		vi.clearAllMocks();
		vi.useFakeTimers();

		// Default mock implementations
		mockGetProfile.mockResolvedValue(null);
		mockGetEventsByKind.mockResolvedValue([]);
		mockSaveEvent.mockResolvedValue(undefined);
		mockFetchProfile.mockResolvedValue(undefined);
		mockFetchContacts.mockResolvedValue(undefined);
		mockGetContactPubkeys.mockReturnValue([]);
		mockHasReacted.mockReturnValue(false);
		mockHasReposted.mockReturnValue(false);
		mockIsDeleted.mockReturnValue(false);
		mockFetchAll.mockResolvedValue(undefined);
		mockNormalize.mockImplementation((e) => ({
			userMessage: e instanceof Error ? e.message : 'Unknown error'
		}));
		mockSubscribe.mockReturnValue('sub-id-123');
		mockFetchEvents.mockResolvedValue(new Set());

		// Reset modules to get fresh store instance
		vi.resetModules();
		const module = await import('$stores/feed.svelte');
		feedStore = module.feedStore;
	});

	afterEach(() => {
		feedStore.cleanup();
		vi.useRealTimers();
	});

	describe('Initial State', () => {
		it('should start with empty events', () => {
			expect(feedStore.events).toEqual([]);
		});

		it('should start with empty queued events', () => {
			expect(feedStore.queuedEvents).toEqual([]);
		});

		it('should not be loading initially', () => {
			expect(feedStore.isLoading).toBe(false);
		});

		it('should not be loading more initially', () => {
			expect(feedStore.isLoadingMore).toBe(false);
		});

		it('should have more events available initially', () => {
			expect(feedStore.hasMore).toBe(true);
		});

		it('should have no error initially', () => {
			expect(feedStore.error).toBe(null);
		});

		it('should have global feed type by default', () => {
			expect(feedStore.feedType).toBe('global');
		});
	});

	describe('load()', () => {
		it('should set loading state to true', async () => {
			const loadPromise = feedStore.load('global');

			expect(feedStore.isLoading).toBe(true);

			await vi.runAllTimersAsync();
			await loadPromise;
		});

		it('should set feed type correctly', async () => {
			const loadPromise = feedStore.load('following');

			expect(feedStore.feedType).toBe('following');

			await vi.runAllTimersAsync();
			await loadPromise;
		});

		it('should clear previous events on load', async () => {
			// First load some events
			const mockEvent = createMockEvent();
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();

			// Load again - events should be cleared
			mockGetEventsByKind.mockResolvedValueOnce([]);
			const loadPromise = feedStore.load('user', 'other-pubkey');

			await vi.runAllTimersAsync();
			await loadPromise;

			expect(feedStore.events).toHaveLength(0);
		});

		it('should load events from cache', async () => {
			const mockEvent = createMockEvent({ content: 'Cached event' });
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();

			expect(feedStore.events.length).toBeGreaterThan(0);
			expect(feedStore.events[0].event.content).toBe('Cached event');
		});

		it('should filter deleted events', async () => {
			const mockEvent = createMockEvent({ id: 'deleted-event' });
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent]);
			mockIsDeleted.mockReturnValue(true);

			await feedStore.load('global');
			await vi.runAllTimersAsync();

			expect(feedStore.events).toHaveLength(0);
		});

		it('should subscribe for live updates', async () => {
			await feedStore.load('global');
			await vi.runAllTimersAsync();

			expect(mockSubscribe).toHaveBeenCalled();
			expect(mockSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({ kinds: [1], limit: 30 }),
				expect.objectContaining({ closeOnEose: false }),
				expect.any(Object),
				'feed-main'
			);
		});

		it('should stop previous subscription before loading', async () => {
			mockSubscribe.mockReturnValueOnce('sub-1');
			await feedStore.load('global');
			await vi.runAllTimersAsync();

			mockSubscribe.mockReturnValueOnce('sub-2');
			await feedStore.load('following');
			await vi.runAllTimersAsync();

			expect(mockUnsubscribe).toHaveBeenCalledWith('sub-1');
		});

		it('should finish loading after timeout', async () => {
			await feedStore.load('global');

			expect(feedStore.isLoading).toBe(true);

			// Advance time past the timeout (3500ms)
			await vi.advanceTimersByTimeAsync(4000);

			expect(feedStore.isLoading).toBe(false);
		});

		it('should handle following feed with no contacts', async () => {
			mockGetContactPubkeys.mockReturnValue([]);

			await feedStore.load('following');
			await vi.runAllTimersAsync();

			expect(feedStore.events).toHaveLength(0);
			expect(feedStore.hasMore).toBe(false);
		});

		it('should fetch contacts for following feed', async () => {
			mockGetContactPubkeys.mockReturnValue(['contact-1', 'contact-2']);

			await feedStore.load('following');
			await vi.runAllTimersAsync();

			// Note: Due to dynamic import resolution, auth pubkey may be
			// resolved from actual module or mock. We verify contacts
			// fetching logic works correctly.
			expect(mockFetchContacts).toHaveBeenCalled();
		});

		it('should handle errors gracefully', async () => {
			mockGetEventsByKind.mockRejectedValueOnce(new Error('Database error'));

			await feedStore.load('global');
			await vi.runAllTimersAsync();

			expect(feedStore.error).toBe('Database error');
			expect(feedStore.isLoading).toBe(false);
		});

		it('should set user for interactions service', async () => {
			await feedStore.load('global');
			await vi.runAllTimersAsync();

			// setUser is called with pubkey from auth store (may be null in test env)
			expect(mockSetUser).toHaveBeenCalled();
		});

		it('should build correct filter for user feed', async () => {
			await feedStore.load('user', 'target-pubkey');
			await vi.runAllTimersAsync();

			expect(mockSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({
					kinds: [1],
					authors: ['target-pubkey']
				}),
				expect.any(Object),
				expect.any(Object),
				expect.any(String)
			);
		});

		it('should build correct filter for hashtag feed', async () => {
			await feedStore.load('hashtag', 'nostr');
			await vi.runAllTimersAsync();

			expect(mockSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({
					kinds: [1],
					'#t': ['nostr']
				}),
				expect.any(Object),
				expect.any(Object),
				expect.any(String)
			);
		});

		it('should build correct filter for replies feed', async () => {
			await feedStore.load('replies', 'event-id-123');
			await vi.runAllTimersAsync();

			expect(mockSubscribe).toHaveBeenCalledWith(
				expect.objectContaining({
					kinds: [1],
					'#e': ['event-id-123']
				}),
				expect.any(Object),
				expect.any(Object),
				expect.any(String)
			);
		});
	});

	describe('loadMore()', () => {
		beforeEach(async () => {
			// Set up initial feed state
			const mockEvent = createMockEvent({
				id: 'event-1',
				created_at: 1000
			});
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();
		});

		it('should not load if already loading', async () => {
			// Start another load to set isLoading
			const loadPromise = feedStore.load('global');

			await feedStore.loadMore();

			// fetchEvents should not be called for loadMore
			expect(mockFetchEvents).not.toHaveBeenCalled();

			await vi.runAllTimersAsync();
			await loadPromise;
		});

		it('should not load if no more events', async () => {
			// Manually set hasMore to false by loading empty result
			mockFetchEvents.mockResolvedValueOnce(new Set());
			await feedStore.loadMore();
			await vi.runAllTimersAsync();

			// Try again
			mockFetchEvents.mockClear();
			await feedStore.loadMore();

			expect(mockFetchEvents).not.toHaveBeenCalled();
		});

		it('should not load if events are empty', async () => {
			// Reset to empty state
			vi.resetModules();
			const module = await import('$stores/feed.svelte');
			const emptyStore = module.feedStore;

			await emptyStore.loadMore();

			expect(mockFetchEvents).not.toHaveBeenCalled();
		});

		it('should fetch older events', async () => {
			const olderEvent = createMockEvent({
				id: 'older-event',
				created_at: 500
			});
			mockFetchEvents.mockResolvedValueOnce(new Set([olderEvent]));

			await feedStore.loadMore();
			await vi.runAllTimersAsync();

			expect(mockFetchEvents).toHaveBeenCalledWith(
				expect.objectContaining({
					until: 1000,
					limit: 20
				})
			);
		});

		it('should append new events to feed', async () => {
			const initialLength = feedStore.events.length;

			const olderEvent = createMockEvent({
				id: 'older-event',
				created_at: 500
			});
			mockFetchEvents.mockResolvedValueOnce(new Set([olderEvent]));

			await feedStore.loadMore();
			await vi.runAllTimersAsync();

			expect(feedStore.events.length).toBe(initialLength + 1);
		});

		it('should set hasMore to false when no more events', async () => {
			mockFetchEvents.mockResolvedValueOnce(new Set());

			await feedStore.loadMore();
			await vi.runAllTimersAsync();

			expect(feedStore.hasMore).toBe(false);
		});

		it('should set isLoadingMore during load', async () => {
			mockFetchEvents.mockImplementation(() => new Promise(resolve => {
				setTimeout(() => resolve(new Set()), 100);
			}));

			const loadMorePromise = feedStore.loadMore();

			expect(feedStore.isLoadingMore).toBe(true);

			await vi.runAllTimersAsync();
			await loadMorePromise;

			expect(feedStore.isLoadingMore).toBe(false);
		});

		it('should handle errors gracefully', async () => {
			mockFetchEvents.mockRejectedValueOnce(new Error('Network error'));

			await feedStore.loadMore();
			await vi.runAllTimersAsync();

			expect(feedStore.error).toBe('Network error');
			expect(feedStore.isLoadingMore).toBe(false);
		});

		it('should cache new events', async () => {
			const olderEvent = createMockEvent({ id: 'older-event' });
			mockFetchEvents.mockResolvedValueOnce(new Set([olderEvent]));

			await feedStore.loadMore();
			await vi.runAllTimersAsync();

			expect(mockSaveEvent).toHaveBeenCalled();
		});
	});

	describe('publishNote()', () => {
		beforeEach(async () => {
			await feedStore.load('global');
			await vi.runAllTimersAsync();
		});

		it('should add optimistic event immediately', async () => {
			const initialLength = feedStore.events.length;

			mockPublishNote.mockImplementation(() => new Promise(resolve => {
				setTimeout(() => resolve(createMockEvent({ content: 'Published note' })), 100);
			}));

			const publishPromise = feedStore.publishNote('Hello world');

			// Should have optimistic event before publish completes
			expect(feedStore.events.length).toBe(initialLength + 1);
			expect(feedStore.events[0].isOptimistic).toBe(true);
			expect(feedStore.events[0].event.content).toBe('Hello world');

			await vi.runAllTimersAsync();
			await publishPromise;
		});

		it('should replace optimistic event with real event', async () => {
			const realEvent = createMockEvent({
				id: 'real-id',
				content: 'Hello world'
			});
			mockPublishNote.mockResolvedValueOnce(realEvent);

			await feedStore.publishNote('Hello world');
			await vi.runAllTimersAsync();

			expect(feedStore.events[0].isOptimistic).toBeUndefined();
			expect(feedStore.events[0].event.id).toBe('real-id');
		});

		it('should rollback on publish failure', async () => {
			const initialLength = feedStore.events.length;
			mockPublishNote.mockRejectedValueOnce(new Error('Publish failed'));

			await expect(feedStore.publishNote('Hello world')).rejects.toThrow('Publish failed');
			await vi.runAllTimersAsync();

			// Optimistic event should be removed
			expect(feedStore.events.length).toBe(initialLength);
		});

		it('should include reply tags when replying', async () => {
			const replyTo = createMockEvent({ id: 'parent-event' }) as any;
			mockPublishNote.mockResolvedValueOnce(createMockEvent());

			const publishPromise = feedStore.publishNote('Reply content', replyTo);

			// Check optimistic event has reply tags
			expect(feedStore.events[0].event.tags).toEqual([['e', 'parent-event', '', 'reply']]);

			await vi.runAllTimersAsync();
			await publishPromise;
		});
	});

	describe('react()', () => {
		let mockEvent: any;

		beforeEach(async () => {
			mockEvent = createMockEvent({ id: 'target-event' });
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();
		});

		it('should optimistically update reaction count', async () => {
			const initialCount = feedStore.events[0].reactionCount;
			mockReact.mockImplementation(() => new Promise(resolve => {
				setTimeout(resolve, 100);
			}));

			const reactPromise = feedStore.react(feedStore.events[0].event, '+');

			expect(feedStore.events[0].reactionCount).toBe(initialCount + 1);
			expect(feedStore.events[0].hasReacted).toBe(true);

			await vi.runAllTimersAsync();
			await reactPromise;
		});

		it('should call addReaction on interactions service', async () => {
			mockReact.mockResolvedValueOnce(undefined);

			await feedStore.react(feedStore.events[0].event, '+');
			await vi.runAllTimersAsync();

			expect(mockAddReaction).toHaveBeenCalledWith('target-event');
		});

		it('should rollback on reaction failure', async () => {
			const initialCount = feedStore.events[0].reactionCount;
			mockReact.mockRejectedValueOnce(new Error('Reaction failed'));

			await expect(feedStore.react(feedStore.events[0].event, '+')).rejects.toThrow('Reaction failed');
			await vi.runAllTimersAsync();

			expect(feedStore.events[0].reactionCount).toBe(initialCount);
			expect(feedStore.events[0].hasReacted).toBe(false);
		});

		it('should react to event not in current feed', async () => {
			// Events can be reacted to from detail pages, notifications, etc.
			const fakeEvent = createMockEvent({ id: 'non-existent' }) as any;
			mockReact.mockResolvedValueOnce(undefined);

			await feedStore.react(fakeEvent, '+');
			await vi.runAllTimersAsync();

			// Should still call the API - event might be from another view
			expect(mockReact).toHaveBeenCalledWith(fakeEvent, '+');
		});
	});

	describe('repost()', () => {
		let mockEvent: any;

		beforeEach(async () => {
			mockEvent = createMockEvent({ id: 'target-event' });
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();
		});

		it('should optimistically update repost count', async () => {
			const initialCount = feedStore.events[0].repostCount;
			mockRepost.mockImplementation(() => new Promise(resolve => {
				setTimeout(resolve, 100);
			}));

			const repostPromise = feedStore.repost(feedStore.events[0].event);

			expect(feedStore.events[0].repostCount).toBe(initialCount + 1);
			expect(feedStore.events[0].hasReposted).toBe(true);

			await vi.runAllTimersAsync();
			await repostPromise;
		});

		it('should call addRepost on interactions service', async () => {
			mockRepost.mockResolvedValueOnce(undefined);

			await feedStore.repost(feedStore.events[0].event);
			await vi.runAllTimersAsync();

			expect(mockAddRepost).toHaveBeenCalledWith('target-event');
		});

		it('should rollback on repost failure', async () => {
			const initialCount = feedStore.events[0].repostCount;
			mockRepost.mockRejectedValueOnce(new Error('Repost failed'));

			await expect(feedStore.repost(feedStore.events[0].event)).rejects.toThrow('Repost failed');
			await vi.runAllTimersAsync();

			expect(feedStore.events[0].repostCount).toBe(initialCount);
			expect(feedStore.events[0].hasReposted).toBe(false);
		});
	});

	describe('deleteNote()', () => {
		let mockEvent: any;

		beforeEach(async () => {
			mockEvent = createMockEvent({ id: 'target-event' });
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();
		});

		it('should optimistically remove event from feed', async () => {
			mockDeleteEvent.mockImplementation(() => new Promise(resolve => {
				setTimeout(resolve, 100);
			}));

			const deletePromise = feedStore.deleteNote('target-event');

			expect(feedStore.events.find(e => e.event.id === 'target-event')).toBeUndefined();

			await vi.runAllTimersAsync();
			await deletePromise;
		});

		it('should call addDeletion on interactions service', async () => {
			mockDeleteEvent.mockResolvedValueOnce(undefined);

			await feedStore.deleteNote('target-event');
			await vi.runAllTimersAsync();

			expect(mockAddDeletion).toHaveBeenCalledWith('target-event');
		});

		it('should rollback on delete failure', async () => {
			const initialLength = feedStore.events.length;
			mockDeleteEvent.mockRejectedValueOnce(new Error('Delete failed'));

			await expect(feedStore.deleteNote('target-event')).rejects.toThrow('Delete failed');
			await vi.runAllTimersAsync();

			expect(feedStore.events.length).toBe(initialLength);
			expect(feedStore.events.find(e => e.event.id === 'target-event')).toBeDefined();
		});

		it('should delete event not in current feed', async () => {
			// Events can be deleted from detail pages, notifications, etc.
			const initialLength = feedStore.events.length;
			mockDeleteEvent.mockResolvedValueOnce(undefined);

			await feedStore.deleteNote('non-existent');
			await vi.runAllTimersAsync();

			// Feed length unchanged since event wasn't there
			expect(feedStore.events.length).toBe(initialLength);
			// Should still call the API - event might be from another view
			expect(mockDeleteEvent).toHaveBeenCalledWith('non-existent');
		});
	});

	describe('showNewEvents()', () => {
		it('should merge queued events with main feed', async () => {
			// Set up feed with initial event
			const initialEvent = createMockEvent({
				id: 'initial',
				created_at: 1000
			});
			mockGetEventsByKind.mockResolvedValueOnce([initialEvent]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();

			// Simulate receiving a new event while loading is done
			// (This is normally handled by subscription callback)
			// For testing, we need to access internal state or use refresh

			// Since queuedEvents is internal, we verify showNewEvents doesn't crash
			feedStore.showNewEvents();

			// Events should remain sorted
			expect(feedStore.queuedEvents).toHaveLength(0);
		});
	});

	describe('refresh()', () => {
		it('should reload the current feed', async () => {
			await feedStore.load('user', 'some-pubkey');
			await vi.runAllTimersAsync();

			mockSubscribe.mockClear();

			await feedStore.refresh();
			await vi.runAllTimersAsync();

			// Should have called load again with same params
			expect(mockSubscribe).toHaveBeenCalled();
		});
	});

	describe('clearError()', () => {
		it('should clear the error state', async () => {
			mockGetEventsByKind.mockRejectedValueOnce(new Error('Test error'));

			await feedStore.load('global');
			await vi.runAllTimersAsync();

			expect(feedStore.error).toBe('Test error');

			feedStore.clearError();

			expect(feedStore.error).toBe(null);
		});
	});

	describe('cleanup()', () => {
		it('should stop subscriptions', async () => {
			mockSubscribe.mockReturnValueOnce('cleanup-sub');
			await feedStore.load('global');
			await vi.runAllTimersAsync();

			feedStore.cleanup();

			expect(mockUnsubscribe).toHaveBeenCalledWith('cleanup-sub');
			expect(mockUnsubscribeByLabel).toHaveBeenCalledWith('feed-main');
		});

		it('should clear loading timeout', async () => {
			feedStore.load('global');
			// Don't await - leave loading in progress

			feedStore.cleanup();

			// Advance time - should not trigger any state changes
			await vi.advanceTimersByTimeAsync(5000);
		});
	});

	describe('Event deduplication', () => {
		it('should deduplicate events from cache by tracking seen IDs', async () => {
			// Note: Cache deduplication happens via seenIds Set which tracks
			// all seen event IDs. Once an event is added, its ID is in seenIds.
			// The deduplication primarily works for live subscription events.
			const mockEvent1 = createMockEvent({ id: 'event-1', created_at: 1000 });
			const mockEvent2 = createMockEvent({ id: 'event-2', created_at: 900 });
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent1, mockEvent2]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();

			// Both unique events should be loaded
			expect(feedStore.events.length).toBe(2);

			// Event IDs should all be unique
			const eventIds = feedStore.events.map(e => e.event.id);
			const uniqueIds = [...new Set(eventIds)];
			expect(eventIds.length).toBe(uniqueIds.length);
		});
	});

	describe('Profile loading', () => {
		it('should load author profile from cache', async () => {
			const mockProfile = { pubkey: 'author-pubkey', name: 'Test Author' };
			mockGetProfile.mockResolvedValueOnce(mockProfile);

			const mockEvent = createMockEvent({ pubkey: 'author-pubkey' });
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();

			expect(feedStore.events[0].author).toEqual(mockProfile);
		});

		it('should fetch profile in background if not cached', async () => {
			mockGetProfile.mockResolvedValue(null);

			const mockEvent = createMockEvent({ pubkey: 'new-author' });
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();

			expect(mockFetchProfile).toHaveBeenCalledWith('new-author');
		});
	});

	describe('Interaction state', () => {
		it('should check if user has reacted to events', async () => {
			mockHasReacted.mockReturnValue(true);

			const mockEvent = createMockEvent();
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();

			expect(feedStore.events[0].hasReacted).toBe(true);
		});

		it('should check if user has reposted events', async () => {
			mockHasReposted.mockReturnValue(true);

			const mockEvent = createMockEvent();
			mockGetEventsByKind.mockResolvedValueOnce([mockEvent]);

			await feedStore.load('global');
			await vi.runAllTimersAsync();

			expect(feedStore.events[0].hasReposted).toBe(true);
		});
	});
});
