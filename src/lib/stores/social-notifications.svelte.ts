/**
 * Social Notifications Store
 * 
 * Manages real-time Nostr notifications for mentions, reactions, reposts, zaps, and followers.
 */

import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import ndkService from '$services/ndk';
import { dbHelpers, type UserProfile } from '$db';
import authStore from './auth.svelte';
import { pushNotifications } from '$services/push-notifications';

/** Notification types */
export type SocialNotificationType = 'mention' | 'reaction' | 'repost' | 'zap' | 'follow' | 'reply';

/** Social notification */
export interface SocialNotification {
	id: string;
	type: SocialNotificationType;
	event: NDKEvent;
	actorPubkey: string;
	actorProfile?: UserProfile;
	targetEventId?: string;
	content?: string;
	amount?: number; // For zaps (in sats)
	createdAt: number;
	read: boolean;
}

/** Create social notifications store */
function createSocialNotificationsStore() {
	let notifications = $state<SocialNotification[]>([]);
	let isLoading = $state(false);
	let unreadCount = $state(0);
	let subscriptionIds: string[] = [];
	
	// Profile cache
	const profileCache = new Map<string, UserProfile>();
	const seenIds = new Set<string>();

	/** Get profile from cache or fetch */
	async function getProfile(pubkey: string): Promise<UserProfile | undefined> {
		if (profileCache.has(pubkey)) {
			return profileCache.get(pubkey);
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
				// Update notifications with new profile
				notifications = notifications.map(n => 
					n.actorPubkey === pubkey ? { ...n, actorProfile: profile } : n
				);
			}
		}).catch(console.error);
		
		return undefined;
	}

	/** Parse notification from event */
	async function parseNotification(event: NDKEvent): Promise<SocialNotification | null> {
		// Skip if already seen
		if (seenIds.has(event.id)) return null;
		seenIds.add(event.id);
		
		// Skip own events
		if (event.pubkey === authStore.pubkey) return null;
		
		let type: SocialNotificationType;
		let targetEventId: string | undefined;
		let content: string | undefined;
		let amount: number | undefined;
		
		switch (event.kind) {
			case 1: {
				// Check if it's a mention or reply
				const pTags = event.tags.filter(t => t[0] === 'p').map(t => t[1]);
				const eTags = event.tags.filter(t => t[0] === 'e').map(t => t[1]);
				
				if (pTags.includes(authStore.pubkey!)) {
					if (eTags.length > 0) {
						type = 'reply';
						targetEventId = eTags[0];
					} else {
						type = 'mention';
					}
					content = event.content.slice(0, 100);
				} else {
					return null;
				}
				break;
			}
			case 6: // Repost
				type = 'repost';
				targetEventId = event.tags.find(t => t[0] === 'e')?.[1];
				break;
			case 7: // Reaction
				type = 'reaction';
				targetEventId = event.tags.find(t => t[0] === 'e')?.[1];
				content = event.content || '+';
				break;
			case 9735: // Zap receipt
				type = 'zap';
				targetEventId = event.tags.find(t => t[0] === 'e')?.[1];
				// Parse zap amount from bolt11 tag
				const bolt11 = event.tags.find(t => t[0] === 'bolt11')?.[1];
				if (bolt11) {
					amount = parseZapAmount(bolt11);
				}
				break;
			case 3: // Contact list (follow)
				type = 'follow';
				break;
			default:
				return null;
		}
		
		const actorProfile = await getProfile(event.pubkey);
		
		return {
			id: event.id,
			type,
			event,
			actorPubkey: event.pubkey,
			actorProfile,
			targetEventId,
			content,
			amount,
			createdAt: event.created_at || Math.floor(Date.now() / 1000),
			read: false
		};
	}

	/** Parse zap amount from BOLT11 invoice */
	function parseZapAmount(bolt11: string | undefined | null): number | undefined {
		if (!bolt11) return undefined;
		// Simple parsing - look for amount in the invoice
		const match = bolt11.match(/lnbc(\d+)([munp]?)/i);
		if (!match) return undefined;
		
		const value = Number.parseInt(match[1], 10);
		const unit = match[2]?.toLowerCase();
		
		switch (unit) {
			case 'm': return value * 100000; // milli
			case 'u': return value * 100; // micro
			case 'n': return Math.floor(value / 10); // nano
			case 'p': return Math.floor(value / 10000); // pico
			default: return value * 100000000; // sat
		}
	}

	/** Start subscriptions */
	async function startSubscriptions(): Promise<void> {
		if (!authStore.pubkey) return;
		
		stopSubscriptions();
		isLoading = true;
		
		const since = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60; // Last 7 days
		
		// Mentions and replies (kind:1 with #p tag)
		const mentionsFilter: NDKFilter = {
			kinds: [1],
			'#p': [authStore.pubkey],
			since
		};
		
		// Reactions to our posts (kind:7)
		const reactionsFilter: NDKFilter = {
			kinds: [7],
			'#p': [authStore.pubkey],
			since
		};
		
		// Reposts of our posts (kind:6)
		const repostsFilter: NDKFilter = {
			kinds: [6],
			'#p': [authStore.pubkey],
			since
		};
		
		// Zap receipts (kind:9735)
		const zapsFilter: NDKFilter = {
			kinds: [9735],
			'#p': [authStore.pubkey],
			since
		};
		
		const handleEvent = async (event: NDKEvent) => {
			const notification = await parseNotification(event);
			if (notification) {
				// Insert in chronological order (newest first)
				const insertIndex = notifications.findIndex(
					n => n.createdAt < notification.createdAt
				);

				if (insertIndex === -1) {
					notifications = [...notifications, notification];
				} else {
					notifications = [
						...notifications.slice(0, insertIndex),
						notification,
						...notifications.slice(insertIndex)
					];
				}

				// Update unread count
				if (!notification.read) {
					unreadCount = notifications.filter(n => !n.read).length;
				}

				// Send push notification
				const authorName = notification.actorProfile?.display_name ||
					notification.actorProfile?.name ||
					notification.actorPubkey.slice(0, 8);

				switch (notification.type) {
					case 'mention':
						pushNotifications.notifyMention(
							authorName,
							notification.content || '',
							notification.id
						);
						break;
					case 'reply':
						pushNotifications.notifyReply(
							authorName,
							notification.content || '',
							notification.targetEventId || notification.id
						);
						break;
					case 'zap':
						pushNotifications.notifyZap(
							authorName,
							notification.amount || 0,
							notification.targetEventId
						);
						break;
					case 'follow':
						pushNotifications.notifyNewFollower(
							authorName,
							notification.actorPubkey
						);
						break;
				}
			}
		};
		
		// Subscribe to all notification types
		const filters = [mentionsFilter, reactionsFilter, repostsFilter, zapsFilter];
		
		for (const filter of filters) {
			const subId = ndkService.subscribe(
				filter,
				{ closeOnEose: false },
				{
					onEvent: handleEvent,
					onEose: () => {
						isLoading = false;
					}
				}
			);
			subscriptionIds.push(subId);
		}
	}

	/** Stop subscriptions */
	function stopSubscriptions(): void {
		for (const subId of subscriptionIds) {
			ndkService.unsubscribe(subId);
		}
		subscriptionIds = [];
	}

	/** Mark notification as read */
	function markAsRead(id: string): void {
		notifications = notifications.map(n =>
			n.id === id ? { ...n, read: true } : n
		);
		unreadCount = notifications.filter(n => !n.read).length;
	}

	/** Mark all as read */
	function markAllAsRead(): void {
		notifications = notifications.map(n => ({ ...n, read: true }));
		unreadCount = 0;
	}

	/** Clear all notifications */
	function clearAll(): void {
		notifications = [];
		unreadCount = 0;
		seenIds.clear();
	}

	/** Cleanup */
	function cleanup(): void {
		stopSubscriptions();
		clearAll();
	}

	return {
		// State
		get notifications() { return notifications; },
		get isLoading() { return isLoading; },
		get unreadCount() { return unreadCount; },
		
		// Actions
		startSubscriptions,
		stopSubscriptions,
		markAsRead,
		markAllAsRead,
		clearAll,
		cleanup
	};
}

/** Social notifications store singleton */
export const socialNotificationsStore = createSocialNotificationsStore();

export default socialNotificationsStore;
