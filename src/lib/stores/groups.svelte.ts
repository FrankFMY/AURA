/**
 * Groups Store
 *
 * Manages public group chats using NIP-28.
 * Event kinds: 40 (create), 41 (metadata), 42 (message)
 */

import ndkService from '$services/ndk';
import { authStore } from '$stores/auth.svelte';
import { dbHelpers, type UserProfile } from '$db';
import { NDKEvent, type NDKSubscription } from '@nostr-dev-kit/ndk';

// NIP-28 Event Kinds
const KIND_CHANNEL_CREATE = 40;
const KIND_CHANNEL_METADATA = 41;
const KIND_CHANNEL_MESSAGE = 42;

/** Group/Channel metadata */
export interface Group {
	id: string;
	name: string;
	about?: string;
	picture?: string;
	createdAt: number;
	creatorPubkey: string;
	memberCount: number;
	lastMessage?: GroupMessage;
	isJoined: boolean;
}

/** Message in a group */
export interface GroupMessage {
	id: string;
	groupId: string;
	pubkey: string;
	content: string;
	createdAt: number;
	profile?: UserProfile | null;
	replyTo?: string;
}

/** Create group options */
export interface CreateGroupOptions {
	name: string;
	about?: string;
	picture?: string;
}

/** Create groups store */
function createGroupsStore() {
	let groups = $state<Map<string, Group>>(new Map());
	let messages = $state<Map<string, GroupMessage[]>>(new Map());
	let activeGroupId = $state<string | null>(null);
	let isLoading = $state(false);
	let isLoadingMessages = $state(false);

	let groupsSubscription: NDKSubscription | null = null;
	let messagesSubscription: NDKSubscription | null = null;

	// Joined groups stored in localStorage
	let joinedGroupIds = $state<Set<string>>(new Set());

	/** Load joined groups from localStorage */
	function loadJoinedGroups(): void {
		try {
			const stored = localStorage.getItem('aura-joined-groups');
			if (stored) {
				joinedGroupIds = new Set(JSON.parse(stored));
			}
		} catch (e) {
			console.error('[Groups] Failed to load joined groups:', e);
		}
	}

	/** Save joined groups to localStorage */
	function saveJoinedGroups(): void {
		try {
			localStorage.setItem(
				'aura-joined-groups',
				JSON.stringify(Array.from(joinedGroupIds))
			);
		} catch (e) {
			console.error('[Groups] Failed to save joined groups:', e);
		}
	}

	/** Parse channel creation event (kind:40) */
	function parseChannelEvent(event: NDKEvent): Group | null {
		try {
			let metadata: { name?: string; about?: string; picture?: string } = {};

			// Try to parse content as JSON metadata
			try {
				metadata = JSON.parse(event.content);
			} catch {
				// If not JSON, use content as name
				metadata = { name: event.content || 'Unnamed Channel' };
			}

			if (!metadata.name) {
				return null;
			}

			return {
				id: event.id,
				name: metadata.name,
				about: metadata.about,
				picture: metadata.picture,
				createdAt: event.created_at || Math.floor(Date.now() / 1000),
				creatorPubkey: event.pubkey,
				memberCount: 0,
				isJoined: joinedGroupIds.has(event.id)
			};
		} catch (e) {
			console.error('[Groups] Failed to parse channel event:', e);
			return null;
		}
	}

	/** Parse channel message event (kind:42) */
	async function parseMessageEvent(event: NDKEvent): Promise<GroupMessage | null> {
		try {
			// Get channel ID from e tag
			const channelTag = event.tags.find((t) => t[0] === 'e' && t[3] === 'root');
			const channelId = channelTag?.[1];

			if (!channelId) {
				// Try first e tag as fallback
				const firstETag = event.tags.find((t) => t[0] === 'e');
				if (!firstETag?.[1]) return null;
			}

			const groupId = channelTag?.[1] || event.tags.find((t) => t[0] === 'e')?.[1];
			if (!groupId) return null;

			// Get reply reference if exists
			const replyTag = event.tags.find((t) => t[0] === 'e' && t[3] === 'reply');
			const replyTo = replyTag?.[1];

			// Get profile
			const profile = await dbHelpers.getProfile(event.pubkey);

			return {
				id: event.id,
				groupId,
				pubkey: event.pubkey,
				content: event.content,
				createdAt: event.created_at || Math.floor(Date.now() / 1000),
				profile: profile || null,
				replyTo
			};
		} catch (e) {
			console.error('[Groups] Failed to parse message event:', e);
			return null;
		}
	}

	/** Subscribe to groups/channels */
	async function subscribeToGroups(): Promise<void> {
		if (groupsSubscription) {
			groupsSubscription.stop();
		}

		isLoading = true;
		loadJoinedGroups();

		try {
			const filter = {
				kinds: [KIND_CHANNEL_CREATE],
				limit: 100
			};

			groupsSubscription = ndkService.ndk.subscribe(filter, { closeOnEose: false });

			groupsSubscription.on('event', (event) => {
				const group = parseChannelEvent(event);
				if (group) {
					group.isJoined = joinedGroupIds.has(group.id);
					groups.set(group.id, group);
					groups = new Map(groups);
				}
			});

			groupsSubscription.on('eose', () => {
				isLoading = false;
			});
		} catch (e) {
			console.error('[Groups] Failed to subscribe to groups:', e);
			isLoading = false;
		}
	}

	/** Subscribe to messages for a specific group */
	async function subscribeToMessages(groupId: string): Promise<void> {
		if (messagesSubscription) {
			messagesSubscription.stop();
		}

		activeGroupId = groupId;
		isLoadingMessages = true;

		// Initialize messages array if not exists
		if (!messages.has(groupId)) {
			messages.set(groupId, []);
			messages = new Map(messages);
		}

		try {
			const filter = {
				kinds: [KIND_CHANNEL_MESSAGE],
				'#e': [groupId],
				limit: 100
			};

			messagesSubscription = ndkService.ndk.subscribe(filter, { closeOnEose: false });

			messagesSubscription.on('event', async (event) => {
				const message = await parseMessageEvent(event);
				if (message?.groupId === groupId) {
					const groupMessages = messages.get(groupId) || [];

					// Check for duplicate
					if (!groupMessages.some((m) => m.id === message.id)) {
						groupMessages.push(message);
						groupMessages.sort((a, b) => a.createdAt - b.createdAt);
						messages.set(groupId, groupMessages);
						messages = new Map(messages);

						// Update last message in group
						const group = groups.get(groupId);
						if (group) {
							group.lastMessage = message;
							groups = new Map(groups);
						}
					}
				}
			});

			messagesSubscription.on('eose', () => {
				isLoadingMessages = false;
			});
		} catch (e) {
			console.error('[Groups] Failed to subscribe to messages:', e);
			isLoadingMessages = false;
		}
	}

	/** Create a new group/channel */
	async function createGroup(options: CreateGroupOptions): Promise<string | null> {
		if (!authStore.isAuthenticated) {
			console.error('[Groups] Not logged in');
			return null;
		}

		try {
			const metadata = {
				name: options.name,
				about: options.about || '',
				picture: options.picture || ''
			};

			const event = new NDKEvent(ndkService.ndk);
			event.kind = KIND_CHANNEL_CREATE;
			event.content = JSON.stringify(metadata);
			event.tags = [['client', 'AURA']];

			await event.sign();
			await event.publish();

			console.log('[Groups] Channel created:', event.id);

			// Add to local state
			const group = parseChannelEvent(event);
			if (group) {
				group.isJoined = true;
				groups.set(event.id, group);
				groups = new Map(groups);

				// Auto-join created group
				joinGroup(event.id);
			}

			return event.id;
		} catch (e) {
			console.error('[Groups] Failed to create group:', e);
			return null;
		}
	}

	/** Send a message to a group */
	async function sendMessage(
		groupId: string,
		content: string,
		replyTo?: string
	): Promise<boolean> {
		if (!authStore.isAuthenticated) {
			console.error('[Groups] Not logged in');
			return false;
		}

		try {
			const event = new NDKEvent(ndkService.ndk);
			event.kind = KIND_CHANNEL_MESSAGE;
			event.content = content;
			event.tags = [
				['e', groupId, '', 'root']
			];

			if (replyTo) {
				event.tags.push(['e', replyTo, '', 'reply']);
			}

			await event.sign();
			await event.publish();

			console.log('[Groups] Message sent:', event.id);

			// Add to local state optimistically
			const message: GroupMessage = {
				id: event.id,
				groupId,
				pubkey: authStore.pubkey!,
				content,
				createdAt: Math.floor(Date.now() / 1000),
				profile: authStore.profile,
				replyTo
			};

			const groupMessages = messages.get(groupId) || [];
			groupMessages.push(message);
			messages.set(groupId, groupMessages);
			messages = new Map(messages);

			return true;
		} catch (e) {
			console.error('[Groups] Failed to send message:', e);
			return false;
		}
	}

	/** Join a group */
	function joinGroup(groupId: string): void {
		joinedGroupIds.add(groupId);
		saveJoinedGroups();

		const group = groups.get(groupId);
		if (group) {
			group.isJoined = true;
			groups = new Map(groups);
		}
	}

	/** Leave a group */
	function leaveGroup(groupId: string): void {
		joinedGroupIds.delete(groupId);
		saveJoinedGroups();

		const group = groups.get(groupId);
		if (group) {
			group.isJoined = false;
			groups = new Map(groups);
		}
	}

	/** Get joined groups sorted by last activity */
	function getJoinedGroups(): Group[] {
		return Array.from(groups.values())
			.filter((g) => g.isJoined)
			.sort((a, b) => {
				const aTime = a.lastMessage?.createdAt || a.createdAt;
				const bTime = b.lastMessage?.createdAt || b.createdAt;
				return bTime - aTime;
			});
	}

	/** Get available (not joined) groups */
	function getAvailableGroups(): Group[] {
		return Array.from(groups.values())
			.filter((g) => !g.isJoined)
			.sort((a, b) => b.createdAt - a.createdAt);
	}

	/** Get messages for active group */
	function getActiveMessages(): GroupMessage[] {
		if (!activeGroupId) return [];
		return messages.get(activeGroupId) || [];
	}

	/** Cleanup subscriptions */
	function cleanup(): void {
		if (groupsSubscription) {
			groupsSubscription.stop();
			groupsSubscription = null;
		}
		if (messagesSubscription) {
			messagesSubscription.stop();
			messagesSubscription = null;
		}
		activeGroupId = null;
	}

	return {
		// State
		get groups() {
			return groups;
		},
		get messages() {
			return messages;
		},
		get activeGroupId() {
			return activeGroupId;
		},
		get isLoading() {
			return isLoading;
		},
		get isLoadingMessages() {
			return isLoadingMessages;
		},
		get joinedGroups() {
			return getJoinedGroups();
		},
		get availableGroups() {
			return getAvailableGroups();
		},
		get activeMessages() {
			return getActiveMessages();
		},

		// Actions
		subscribeToGroups,
		subscribeToMessages,
		createGroup,
		sendMessage,
		joinGroup,
		leaveGroup,
		cleanup,

		// Constants
		KIND_CHANNEL_CREATE,
		KIND_CHANNEL_MESSAGE
	};
}

/** Groups store singleton */
export const groupsStore = createGroupsStore();

export default groupsStore;
