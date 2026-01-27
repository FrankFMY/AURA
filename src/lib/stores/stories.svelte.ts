/**
 * Stories Store
 *
 * Manages ephemeral posts (stories) that expire after 24 hours.
 * Uses NIP-40 expiration tag for automatic cleanup.
 */

import ndkService from '$services/ndk';
import { authStore } from '$stores/auth.svelte';
import { dbHelpers, type UserProfile } from '$db';
import { contactsService } from '$services/contacts';
import { NDKEvent, type NDKSubscription } from '@nostr-dev-kit/ndk';

/** Story content types */
export type StoryContentType = 'text' | 'image' | 'video';

/** Individual story item */
export interface StoryItem {
	id: string;
	pubkey: string;
	content: string;
	contentType: StoryContentType;
	mediaUrl?: string;
	createdAt: number;
	expiresAt: number;
	viewedBy: Set<string>;
}

/** User's story collection */
export interface UserStory {
	pubkey: string;
	profile: UserProfile | null;
	items: StoryItem[];
	hasUnviewed: boolean;
	lastUpdated: number;
}

// Constants
const STORY_DURATION = 24 * 60 * 60; // 24 hours in seconds
const STORY_TAG = 'story';

/** Create stories store */
function createStoriesStore() {
	let stories = $state<Map<string, UserStory>>(new Map());
	let isLoading = $state(false);
	let activeSubscription: NDKSubscription | null = null;
	let viewedStories = $state<Set<string>>(new Set());

	// Load viewed stories from localStorage
	function loadViewedStories(): void {
		try {
			const stored = localStorage.getItem('aura-viewed-stories');
			if (stored) {
				const parsed = JSON.parse(stored) as string[];
				viewedStories = new Set(parsed);
			}
		} catch (e) {
			console.error('[Stories] Failed to load viewed stories:', e);
		}
	}

	// Save viewed stories to localStorage
	function saveViewedStories(): void {
		try {
			localStorage.setItem(
				'aura-viewed-stories',
				JSON.stringify(Array.from(viewedStories))
			);
		} catch (e) {
			console.error('[Stories] Failed to save viewed stories:', e);
		}
	}

	/** Parse story event */
	function parseStoryEvent(event: NDKEvent): StoryItem | null {
		try {
			// Check for story tag
			const storyTag = event.tags.find((t) => t[0] === 't' && t[1] === STORY_TAG);
			if (!storyTag) return null;

			// Check expiration
			const expirationTag = event.tags.find((t) => t[0] === 'expiration');
			const expiresAt = expirationTag ? Number.parseInt(expirationTag[1], 10) : 0;
			const now = Math.floor(Date.now() / 1000);

			// Skip expired stories
			if (expiresAt && expiresAt < now) return null;

			// Determine content type
			let contentType: StoryContentType = 'text';
			let mediaUrl: string | undefined;

			// Check for media URLs
			const urlMatch = event.content.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|mp4|webm|mov)/i);
			if (urlMatch) {
				const url = urlMatch[0].toLowerCase();
				if (/\.(mp4|webm|mov)$/i.test(url)) {
					contentType = 'video';
				} else {
					contentType = 'image';
				}
				mediaUrl = urlMatch[0];
			}

			return {
				id: event.id,
				pubkey: event.pubkey,
				content: event.content,
				contentType,
				mediaUrl,
				createdAt: event.created_at || now,
				expiresAt: expiresAt || (event.created_at || now) + STORY_DURATION,
				viewedBy: new Set()
			};
		} catch (e) {
			console.error('[Stories] Failed to parse story event:', e);
			return null;
		}
	}

	/** Add story to user's collection */
	async function addStoryToUser(item: StoryItem): Promise<void> {
		const existing = stories.get(item.pubkey);

		if (existing) {
			// Check for duplicate
			if (existing.items.some((i) => i.id === item.id)) return;

			existing.items.push(item);
			existing.items.sort((a, b) => a.createdAt - b.createdAt);
			existing.hasUnviewed = existing.items.some((i) => !viewedStories.has(i.id));
			existing.lastUpdated = Math.max(existing.lastUpdated, item.createdAt);
		} else {
			// Fetch profile
			const profile = await dbHelpers.getProfile(item.pubkey);

			stories.set(item.pubkey, {
				pubkey: item.pubkey,
				profile: profile || null,
				items: [item],
				hasUnviewed: !viewedStories.has(item.id),
				lastUpdated: item.createdAt
			});
		}

		// Trigger reactivity
		stories = new Map(stories);
	}

	/** Subscribe to stories */
	async function subscribe(): Promise<void> {
		if (activeSubscription) {
			activeSubscription.stop();
		}

		isLoading = true;
		loadViewedStories();

		try {
			const now = Math.floor(Date.now() / 1000);
			const since = now - STORY_DURATION;

			// Get following list for filtering
			let followingPubkeys: string[] = [];
			if (authStore.pubkey) {
				const contacts = await contactsService.fetchContacts(authStore.pubkey);
				followingPubkeys = contacts.map((c) => c.pubkey);
			}

			const filter = {
				kinds: [1],
				'#t': [STORY_TAG],
				since,
				limit: 200
			};

			// Add authors filter if following someone
			if (followingPubkeys.length > 0 && authStore.pubkey) {
				Object.assign(filter, { authors: [...followingPubkeys, authStore.pubkey] });
			}

			activeSubscription = ndkService.ndk.subscribe(filter, { closeOnEose: false });

			activeSubscription.on('event', async (event) => {
				const item = parseStoryEvent(event);
				if (item) {
					await addStoryToUser(item);
				}
			});

			activeSubscription.on('eose', () => {
				isLoading = false;
			});
		} catch (e) {
			console.error('[Stories] Failed to subscribe:', e);
			isLoading = false;
		}
	}

	/** Create a new story */
	async function createStory(
		content: string,
		mediaUrl?: string
	): Promise<string | null> {
		if (!authStore.isAuthenticated) {
			console.error('[Stories] Not logged in');
			return null;
		}

		try {
			const now = Math.floor(Date.now() / 1000);
			const expiresAt = now + STORY_DURATION;

			// Build content with media
			let storyContent = content;
			if (mediaUrl) {
				storyContent = mediaUrl + (content ? `\n\n${content}` : '');
			}

			const event = new NDKEvent(ndkService.ndk);
			event.kind = 1;
			event.content = storyContent;
			event.tags = [
				['t', STORY_TAG],
				['expiration', expiresAt.toString()],
				['client', 'AURA']
			];

			await event.sign();
			await event.publish();

			console.log('[Stories] Story created:', event.id);

			// Add to local state
			const item = parseStoryEvent(event);
			if (item) {
				await addStoryToUser(item);
			}

			return event.id;
		} catch (e) {
			console.error('[Stories] Failed to create story:', e);
			return null;
		}
	}

	/** Mark story as viewed */
	function markViewed(storyId: string): void {
		viewedStories.add(storyId);
		saveViewedStories();

		// Update hasUnviewed for affected user
		for (const [pubkey, userStory] of stories) {
			if (userStory.items.some((i) => i.id === storyId)) {
				userStory.hasUnviewed = userStory.items.some((i) => !viewedStories.has(i.id));
				stories = new Map(stories);
				break;
			}
		}
	}

	/** Check if story is viewed */
	function isViewed(storyId: string): boolean {
		return viewedStories.has(storyId);
	}

	/** Get sorted stories (own story first, then by recency, unviewed first) */
	function getSortedStories(): UserStory[] {
		const result = Array.from(stories.values());
		const myPubkey = authStore.pubkey;

		return result.sort((a, b) => {
			// Own story first
			if (a.pubkey === myPubkey) return -1;
			if (b.pubkey === myPubkey) return 1;

			// Unviewed stories first
			if (a.hasUnviewed && !b.hasUnviewed) return -1;
			if (!a.hasUnviewed && b.hasUnviewed) return 1;

			// Then by recency
			return b.lastUpdated - a.lastUpdated;
		});
	}

	/** Cleanup expired stories */
	function cleanupExpired(): void {
		const now = Math.floor(Date.now() / 1000);
		let changed = false;

		for (const [pubkey, userStory] of stories) {
			const validItems = userStory.items.filter((item) => item.expiresAt > now);

			if (validItems.length !== userStory.items.length) {
				if (validItems.length === 0) {
					stories.delete(pubkey);
				} else {
					userStory.items = validItems;
					userStory.hasUnviewed = validItems.some((i) => !viewedStories.has(i.id));
				}
				changed = true;
			}
		}

		if (changed) {
			stories = new Map(stories);
		}
	}

	/** Stop subscription */
	function unsubscribe(): void {
		if (activeSubscription) {
			activeSubscription.stop();
			activeSubscription = null;
		}
	}

	/** Get time remaining for a story */
	function getTimeRemaining(expiresAt: number): string {
		const now = Math.floor(Date.now() / 1000);
		const diff = expiresAt - now;

		if (diff <= 0) return 'Expired';

		const hours = Math.floor(diff / 3600);
		const minutes = Math.floor((diff % 3600) / 60);

		if (hours > 0) {
			return `${hours}h left`;
		}
		return `${minutes}m left`;
	}

	return {
		// State
		get stories() {
			return stories;
		},
		get isLoading() {
			return isLoading;
		},
		get sortedStories() {
			return getSortedStories();
		},

		// Actions
		subscribe,
		unsubscribe,
		createStory,
		markViewed,
		isViewed,
		cleanupExpired,
		getTimeRemaining,

		// Constants
		STORY_DURATION
	};
}

/** Stories store singleton */
export const storiesStore = createStoriesStore();

export default storiesStore;
