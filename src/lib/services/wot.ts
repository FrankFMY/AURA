/**
 * Web of Trust (WoT) Service
 * 
 * Implements trust graph calculation based on social connections.
 * "I trust my friends, and their friends to some degree"
 * 
 * Trust levels:
 * - Level 0: Self (maximum trust)
 * - Level 1: Direct follows (high trust) - green
 * - Level 2: Friends of friends (medium trust) - yellow
 * - Level 3+: Extended network (low trust) - gray
 * - Blocked: Explicitly muted (no trust) - red
 */

import type { NDKFilter, NDKEvent } from '@nostr-dev-kit/ndk';
import ndkService from '$services/ndk';

/** Trust level enumeration */
export type TrustLevel = 'self' | 'trusted' | 'friend-of-friend' | 'extended' | 'unknown' | 'muted';

/** Trust score is a number from 0-100 */

/** User trust info */
export interface UserTrust {
	pubkey: string;
	level: TrustLevel;
	score: number;
	/** Direct path to trusted user (for friend-of-friend) */
	via?: string;
	/** Reason for trust/distrust */
	reason?: string;
}

/** Trust graph node */
interface TrustNode {
	pubkey: string;
	follows: Set<string>;
	followers: Set<string>;
	muted: Set<string>;
}

/** WoT calculation result */
export interface WoTResult {
	level: TrustLevel;
	score: number;
	path: string[];
	isMuted: boolean;
}

/**
 * Web of Trust Service
 */
class WoTService {
	private readonly graph: Map<string, TrustNode> = new Map();
	private myPubkey: string | null = null;
	private myFollows: Set<string> = new Set();
	private myMuted: Set<string> = new Set();
	private initialized = false;

	// Cache for computed trust
	private readonly trustCache: Map<string, WoTResult> = new Map();
	private readonly cacheExpiry = 5 * 60 * 1000; // 5 minutes
	private lastCacheUpdate = 0;

	/**
	 * Initialize WoT with user's pubkey
	 */
	async init(pubkey: string): Promise<void> {
		if (this.myPubkey === pubkey && this.initialized) return;
		
		this.myPubkey = pubkey;
		this.graph.clear();
		this.trustCache.clear();
		
		// Load my follows and mutes
		await this.loadMyContacts();
		
		// Build initial graph from follows
		await this.buildGraph();
		
		this.initialized = true;
	}

	/**
	 * Load user's contact list (follows) and mute list
	 */
	private async loadMyContacts(): Promise<void> {
		if (!this.myPubkey) return;
		if (!ndkService.ndk) {
			console.warn('[WoT] NDK not initialized');
			return;
		}

		try {
			// Load follows (kind:3)
			const contactsFilter: NDKFilter = {
				kinds: [3],
				authors: [this.myPubkey],
				limit: 1
			};

			const contactsEvents = await ndkService.ndk.fetchEvents(contactsFilter);
			for (const event of contactsEvents) {
				const follows = event.tags
					.filter(t => t[0] === 'p')
					.map(t => t[1]);
				this.myFollows = new Set(follows);
			}

			// Load mutes (kind:10000)
			const mutesFilter: NDKFilter = {
				kinds: [10000],
				authors: [this.myPubkey],
				limit: 1
			};

			const mutesEvents = await ndkService.ndk.fetchEvents(mutesFilter);
			for (const event of mutesEvents) {
				const muted = event.tags
					.filter(t => t[0] === 'p')
					.map(t => t[1]);
				this.myMuted = new Set(muted);
			}

			// Initialize my node
			this.graph.set(this.myPubkey, {
				pubkey: this.myPubkey,
				follows: this.myFollows,
				followers: new Set(),
				muted: this.myMuted
			});

		} catch (e) {
			console.error('Failed to load contacts:', e);
		}
	}

	/**
	 * Build trust graph from follows
	 */
	private async buildGraph(): Promise<void> {
		if (!this.myPubkey || this.myFollows.size === 0) return;
		if (!ndkService.ndk) {
			console.warn('[WoT] NDK not initialized');
			return;
		}

		try {
			// Load contact lists of my follows (level 2)
			const followsArray = Array.from(this.myFollows);
			
			// Batch fetch in groups of 50
			const batchSize = 50;
			for (let i = 0; i < followsArray.length; i += batchSize) {
				const batch = followsArray.slice(i, i + batchSize);
				
				const filter: NDKFilter = {
					kinds: [3],
					authors: batch,
					limit: batch.length
				};

				const events = await ndkService.ndk.fetchEvents(filter);
				
				for (const event of events) {
					const follows = event.tags
						.filter(t => t[0] === 'p')
						.map(t => t[1]);
					
					const node: TrustNode = {
						pubkey: event.pubkey,
						follows: new Set(follows),
						followers: new Set(),
						muted: new Set()
					};
					
					this.graph.set(event.pubkey, node);
					
					// Add reverse relationship
					for (const followedPubkey of follows) {
						if (!this.graph.has(followedPubkey)) {
							this.graph.set(followedPubkey, {
								pubkey: followedPubkey,
								follows: new Set(),
								followers: new Set(),
								muted: new Set()
							});
						}
						this.graph.get(followedPubkey)!.followers.add(event.pubkey);
					}
				}
			}
		} catch (e) {
			console.error('Failed to build trust graph:', e);
		}
	}

	/**
	 * Calculate trust for a pubkey
	 */
	getTrust(pubkey: string): WoTResult {
		if (!this.myPubkey) {
			return { level: 'unknown', score: 0, path: [], isMuted: false };
		}

		// Check cache
		if (Date.now() - this.lastCacheUpdate < this.cacheExpiry) {
			const cached = this.trustCache.get(pubkey);
			if (cached) return cached;
		}

		const result = this.calculateTrust(pubkey);
		this.trustCache.set(pubkey, result);
		this.lastCacheUpdate = Date.now();
		
		return result;
	}

	/**
	 * Check if pubkey is a friend-of-friend (level 2)
	 */
	private checkFriendOfFriend(pubkey: string): WoTResult | null {
		for (const friend of this.myFollows) {
			const friendNode = this.graph.get(friend);
			if (friendNode?.follows.has(pubkey)) {
				const targetNode = this.graph.get(pubkey);
				const isMutual = targetNode?.follows.has(friend) ?? false;
				return {
					level: 'friend-of-friend',
					score: isMutual ? 70 : 50,
					path: [this.myPubkey!, friend, pubkey],
					isMuted: false
				};
			}
		}
		return null;
	}

	/**
	 * Check extended network (level 3) - followed by multiple friends
	 */
	private checkExtendedNetwork(pubkey: string): WoTResult | null {
		let friendsWhoFollow = 0;
		let pathVia: string | null = null;

		for (const friend of this.myFollows) {
			const friendNode = this.graph.get(friend);
			if (friendNode?.follows.has(pubkey)) {
				friendsWhoFollow++;
				if (!pathVia) pathVia = friend;
			}
		}

		if (friendsWhoFollow > 0) {
			const score = Math.min(40, 10 + friendsWhoFollow * 10);
			return {
				level: 'extended',
				score,
				path: pathVia ? [this.myPubkey!, pathVia, pubkey] : [],
				isMuted: false
			};
		}
		return null;
	}

	/**
	 * Calculate trust level and score
	 */
	private calculateTrust(pubkey: string): WoTResult {
		// Self
		if (pubkey === this.myPubkey) {
			return { level: 'self', score: 100, path: [pubkey], isMuted: false };
		}

		// Muted
		if (this.myMuted.has(pubkey)) {
			return { level: 'muted', score: 0, path: [], isMuted: true };
		}

		// Level 1: Direct follow
		if (this.myFollows.has(pubkey)) {
			return { level: 'trusted', score: 90, path: [this.myPubkey!, pubkey], isMuted: false };
		}

		// Level 2: Friend of friend
		const fofResult = this.checkFriendOfFriend(pubkey);
		if (fofResult) return fofResult;

		// Level 3: Extended network
		const extendedResult = this.checkExtendedNetwork(pubkey);
		if (extendedResult) return extendedResult;

		// Unknown
		return { level: 'unknown', score: 0, path: [], isMuted: false };
	}

	/**
	 * Get trust level for display
	 */
	getTrustLevel(pubkey: string): TrustLevel {
		return this.getTrust(pubkey).level;
	}

	/**
	 * Get trust score (0-100)
	 */
	getTrustScore(pubkey: string): number {
		return this.getTrust(pubkey).score;
	}

	/**
	 * Check if user is trusted (level 1 or 2)
	 */
	isTrusted(pubkey: string): boolean {
		const level = this.getTrustLevel(pubkey);
		return level === 'self' || level === 'trusted' || level === 'friend-of-friend';
	}

	/**
	 * Check if user is muted
	 */
	isMuted(pubkey: string): boolean {
		return this.myMuted.has(pubkey);
	}

	/**
	 * Get trust color for UI
	 */
	getTrustColor(pubkey: string): string {
		const level = this.getTrustLevel(pubkey);
		switch (level) {
			case 'self': return 'text-primary';
			case 'trusted': return 'text-green-500';
			case 'friend-of-friend': return 'text-yellow-500';
			case 'extended': return 'text-muted-foreground';
			case 'muted': return 'text-red-500';
			default: return 'text-muted-foreground';
		}
	}

	/**
	 * Get trust badge variant
	 */
	getTrustBadge(pubkey: string): { variant: string; label: string } {
		const level = this.getTrustLevel(pubkey);
		switch (level) {
			case 'self': return { variant: 'default', label: 'You' };
			case 'trusted': return { variant: 'success', label: 'Trusted' };
			case 'friend-of-friend': return { variant: 'warning', label: 'FoF' };
			case 'extended': return { variant: 'secondary', label: 'Extended' };
			case 'muted': return { variant: 'destructive', label: 'Muted' };
			default: return { variant: 'outline', label: 'Unknown' };
		}
	}

	/**
	 * Filter events by trust level
	 */
	filterByTrust(events: NDKEvent[], minLevel: TrustLevel = 'extended'): NDKEvent[] {
		const levelOrder: TrustLevel[] = ['self', 'trusted', 'friend-of-friend', 'extended', 'unknown'];
		const minIndex = levelOrder.indexOf(minLevel);

		return events.filter(event => {
			const trust = this.getTrust(event.pubkey);
			if (trust.isMuted) return false;
			
			const eventIndex = levelOrder.indexOf(trust.level);
			return eventIndex <= minIndex;
		});
	}

	/**
	 * Sort events by trust (most trusted first)
	 */
	sortByTrust(events: NDKEvent[]): NDKEvent[] {
		return [...events].sort((a, b) => {
			const trustA = this.getTrustScore(a.pubkey);
			const trustB = this.getTrustScore(b.pubkey);
			return trustB - trustA;
		});
	}

	/**
	 * Add to mute list
	 */
	async mute(pubkey: string): Promise<void> {
		this.myMuted.add(pubkey);
		this.trustCache.delete(pubkey);
		await this.publishMuteList();
	}

	/**
	 * Remove from mute list
	 */
	async unmute(pubkey: string): Promise<void> {
		this.myMuted.delete(pubkey);
		this.trustCache.delete(pubkey);
		await this.publishMuteList();
	}

	/**
	 * Publish updated mute list to relays (kind:10000)
	 * NIP-51: Lists - Mute list is a replaceable event
	 */
	private async publishMuteList(): Promise<void> {
		if (!this.myPubkey || !ndkService.ndk) {
			console.warn('[WoT] Cannot publish mute list: not initialized');
			return;
		}

		try {
			const { NDKEvent } = await import('@nostr-dev-kit/ndk');
			const event = new NDKEvent(ndkService.ndk);
			
			// Kind 10000 is the mute list (NIP-51)
			event.kind = 10000;
			event.content = ''; // Content can be encrypted but we keep it simple
			
			// Build tags from muted pubkeys
			event.tags = Array.from(this.myMuted).map(pubkey => ['p', pubkey]);
			
			await ndkService.publish(event);
			console.log('[WoT] Mute list published with', this.myMuted.size, 'entries');
		} catch (e) {
			console.error('[WoT] Failed to publish mute list:', e);
			// Don't throw - the local state is already updated
		}
	}

	/**
	 * Get follow recommendations based on WoT
	 */
	getRecommendations(limit: number = 10): string[] {
		if (!this.myPubkey) return [];

		const candidates = new Map<string, number>();

		// Score users followed by multiple friends
		for (const friend of this.myFollows) {
			const friendNode = this.graph.get(friend);
			if (!friendNode) continue;

			for (const followed of friendNode.follows) {
				// Skip if already following or is self
				if (this.myFollows.has(followed) || followed === this.myPubkey) continue;
				
				const current = candidates.get(followed) || 0;
				candidates.set(followed, current + 1);
			}
		}

		// Sort by score and return top N
		return Array.from(candidates.entries())
			.sort((a, b) => b[1] - a[1])
			.slice(0, limit)
			.map(([pubkey]) => pubkey);
	}

	/**
	 * Get statistics
	 */
	getStats(): {
		followsCount: number;
		mutedCount: number;
		graphSize: number;
		cacheSize: number;
	} {
		return {
			followsCount: this.myFollows.size,
			mutedCount: this.myMuted.size,
			graphSize: this.graph.size,
			cacheSize: this.trustCache.size
		};
	}

	/**
	 * Clear cache
	 */
	clearCache(): void {
		this.trustCache.clear();
		this.lastCacheUpdate = 0;
	}

	/**
	 * Refresh graph
	 */
	async refresh(): Promise<void> {
		if (!this.myPubkey) return;
		
		this.graph.clear();
		this.trustCache.clear();
		
		await this.loadMyContacts();
		await this.buildGraph();
	}
}

export const wotService = new WoTService();
export default wotService;
