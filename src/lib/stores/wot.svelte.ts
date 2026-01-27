/**
 * Web of Trust Store
 * 
 * Reactive state for trust-based filtering and display.
 */

import { wotService, type TrustLevel, type WoTResult } from '$lib/services/wot';
import authStore from './auth.svelte';

/** WoT filter settings */
export type WoTFilterLevel = 'all' | 'extended' | 'fof' | 'trusted';

/** Get trust info for a pubkey */
function getTrust(pubkey: string): WoTResult {
	return wotService.getTrust(pubkey);
}

/** Get trust level */
function getTrustLevel(pubkey: string): TrustLevel {
	return wotService.getTrustLevel(pubkey);
}

/** Get trust score (0-100) */
function getTrustScore(pubkey: string): number {
	return wotService.getTrustScore(pubkey);
}

/** Get trust indicator for UI */
function getTrustIndicator(pubkey: string): {
	level: TrustLevel;
	color: string;
	icon: string;
	label: string;
	score: number;
} {
	const trust = wotService.getTrust(pubkey);
	const color = wotService.getTrustColor(pubkey);

	let icon: string;
	let label: string;

	switch (trust.level) {
		case 'self':
			icon = '👤';
			label = 'You';
			break;
		case 'trusted':
			icon = '✓';
			label = 'Trusted';
			break;
		case 'friend-of-friend':
			icon = '◐';
			label = 'Friend of Friend';
			break;
		case 'extended':
			icon = '○';
			label = 'Extended Network';
			break;
		case 'muted':
			icon = '🚫';
			label = 'Muted';
			break;
		default:
			icon = '?';
			label = 'Unknown';
	}

	return {
		level: trust.level,
		color,
		icon,
		label,
		score: trust.score
	};
}

/** Check if user is trusted (level 1 or 2) */
function isTrusted(pubkey: string): boolean {
	return wotService.isTrusted(pubkey);
}

/** Check if user is muted */
function isMuted(pubkey: string): boolean {
	return wotService.isMuted(pubkey);
}

/** Get follow recommendations */
function getRecommendations(limit: number = 10): string[] {
	return wotService.getRecommendations(limit);
}

function createWoTStore() {
	// State
	let isInitialized = $state(false);
	let isLoading = $state(false);
	let filterLevel = $state<WoTFilterLevel>('all');
	let showUnknown = $state(true);
	let error = $state<string | null>(null);

	// Stats
	let followsCount = $state(0);
	let mutedCount = $state(0);
	let graphSize = $state(0);

	/**
	 * Initialize WoT with current user
	 */
	async function init(): Promise<void> {
		if (!authStore.pubkey || isLoading) return;

		isLoading = true;
		error = null;

		try {
			await wotService.init(authStore.pubkey);
			updateStats();
			isInitialized = true;
		} catch (e) {
			console.error('Failed to initialize WoT:', e);
			error = e instanceof Error ? e.message : 'Failed to initialize';
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Update stats from service
	 */
	function updateStats(): void {
		const stats = wotService.getStats();
		followsCount = stats.followsCount;
		mutedCount = stats.mutedCount;
		graphSize = stats.graphSize;
	}

	/**
	 * Check if user passes current filter
	 */
	function passesFilter(pubkey: string): boolean {
		const trust = wotService.getTrust(pubkey);
		
		// Always filter muted
		if (trust.isMuted) return false;

		// Check filter level
		switch (filterLevel) {
			case 'all':
				return showUnknown || trust.level !== 'unknown';
			case 'extended':
				return trust.level !== 'unknown';
			case 'fof':
				return ['self', 'trusted', 'friend-of-friend'].includes(trust.level);
			case 'trusted':
				return ['self', 'trusted'].includes(trust.level);
			default:
				return true;
		}
	}

	/**
	 * Mute a user
	 */
	async function mute(pubkey: string): Promise<void> {
		await wotService.mute(pubkey);
		updateStats();
	}

	/**
	 * Unmute a user
	 */
	async function unmute(pubkey: string): Promise<void> {
		await wotService.unmute(pubkey);
		updateStats();
	}

	/**
	 * Set filter level
	 */
	function setFilterLevel(level: WoTFilterLevel): void {
		filterLevel = level;
	}

	/**
	 * Toggle show unknown users
	 */
	function toggleShowUnknown(): void {
		showUnknown = !showUnknown;
	}

	/**
	 * Refresh WoT graph
	 */
	async function refresh(): Promise<void> {
		isLoading = true;
		try {
			await wotService.refresh();
			updateStats();
		} catch (e) {
			console.error('Failed to refresh WoT:', e);
		} finally {
			isLoading = false;
		}
	}

	return {
		// State
		get isInitialized() { return isInitialized; },
		get isLoading() { return isLoading; },
		get filterLevel() { return filterLevel; },
		get showUnknown() { return showUnknown; },
		get error() { return error; },

		// Stats
		get followsCount() { return followsCount; },
		get mutedCount() { return mutedCount; },
		get graphSize() { return graphSize; },

		// Actions
		init,
		getTrust,
		getTrustLevel,
		getTrustScore,
		getTrustIndicator,
		passesFilter,
		isTrusted,
		isMuted,
		mute,
		unmute,
		setFilterLevel,
		toggleShowUnknown,
		getRecommendations,
		refresh
	};
}

export const wotStore = createWoTStore();
export default wotStore;
