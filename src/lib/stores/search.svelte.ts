/**
 * Search Store
 *
 * Manages search history, saved searches, and advanced filters.
 */

import { dbHelpers } from '$db';

/** Search filter options */
export interface SearchFilters {
	/** Date range - since timestamp (unix) */
	since?: number;
	/** Date range - until timestamp (unix) */
	until?: number;
	/** Filter by author pubkey */
	author?: string;
	/** Content type filter */
	contentType?: 'all' | 'text' | 'image' | 'video';
	/** Only show posts with replies */
	hasReplies?: boolean;
	/** Only show posts with reactions */
	hasReactions?: boolean;
	/** Sort order */
	sortBy?: 'recent' | 'reactions' | 'replies';
}

/** Search history entry */
export interface SearchHistoryEntry {
	query: string;
	timestamp: number;
	tab: 'notes' | 'users' | 'hashtags';
}

/** Saved search */
export interface SavedSearch {
	id: string;
	name: string;
	query: string;
	filters: SearchFilters;
	createdAt: number;
}

/** Date presets for quick filtering */
export const DATE_PRESETS = {
	today: () => Math.floor(Date.now() / 1000) - 86400,
	week: () => Math.floor(Date.now() / 1000) - 86400 * 7,
	month: () => Math.floor(Date.now() / 1000) - 86400 * 30,
	year: () => Math.floor(Date.now() / 1000) - 86400 * 365,
} as const;

/** Max history entries to keep */
const MAX_HISTORY = 20;

/** Storage keys */
const HISTORY_KEY = 'search-history';
const SAVED_KEY = 'saved-searches';

/** Create search store */
function createSearchStore() {
	let history = $state<SearchHistoryEntry[]>([]);
	let savedSearches = $state<SavedSearch[]>([]);
	let filters = $state<SearchFilters>({
		sortBy: 'recent'
	});
	let isFiltersOpen = $state(false);

	/** Load from storage */
	async function load(): Promise<void> {
		try {
			const storedHistory = await dbHelpers.getSetting<SearchHistoryEntry[]>(
				HISTORY_KEY,
				[]
			);
			history = storedHistory ?? [];

			const storedSaved = await dbHelpers.getSetting<SavedSearch[]>(
				SAVED_KEY,
				[]
			);
			savedSearches = storedSaved ?? [];
		} catch (e) {
			console.warn('[Search] Failed to load settings:', e);
		}
	}

	/** Add to search history */
	async function addToHistory(query: string, tab: 'notes' | 'users' | 'hashtags'): Promise<void> {
		if (!query.trim()) return;

		// Remove duplicates
		history = history.filter(h => h.query.toLowerCase() !== query.toLowerCase());

		// Add new entry
		history = [
			{ query, timestamp: Date.now(), tab },
			...history
		].slice(0, MAX_HISTORY);

		// Save
		await dbHelpers.setSetting(HISTORY_KEY, history);
	}

	/** Remove from history */
	async function removeFromHistory(query: string): Promise<void> {
		history = history.filter(h => h.query !== query);
		await dbHelpers.setSetting(HISTORY_KEY, history);
	}

	/** Clear history */
	async function clearHistory(): Promise<void> {
		history = [];
		await dbHelpers.setSetting(HISTORY_KEY, []);
	}

	/** Save a search */
	async function saveSearch(name: string, query: string): Promise<void> {
		const id = `saved-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

		savedSearches = [
			{
				id,
				name,
				query,
				filters: { ...filters },
				createdAt: Date.now()
			},
			...savedSearches
		];

		await dbHelpers.setSetting(SAVED_KEY, savedSearches);
	}

	/** Remove saved search */
	async function removeSavedSearch(id: string): Promise<void> {
		savedSearches = savedSearches.filter(s => s.id !== id);
		await dbHelpers.setSetting(SAVED_KEY, savedSearches);
	}

	/** Update filters */
	function updateFilters(newFilters: Partial<SearchFilters>): void {
		filters = { ...filters, ...newFilters };
	}

	/** Reset filters */
	function resetFilters(): void {
		filters = { sortBy: 'recent' };
	}

	/** Check if any filters are active */
	function hasActiveFilters(): boolean {
		return !!(
			filters.since ||
			filters.until ||
			filters.author ||
			(filters.contentType && filters.contentType !== 'all') ||
			filters.hasReplies ||
			filters.hasReactions
		);
	}

	/** Toggle filters panel */
	function toggleFilters(): void {
		isFiltersOpen = !isFiltersOpen;
	}

	/** Set date preset */
	function setDatePreset(preset: keyof typeof DATE_PRESETS): void {
		filters = {
			...filters,
			since: DATE_PRESETS[preset](),
			until: undefined
		};
	}

	return {
		// State
		get history() { return history; },
		get savedSearches() { return savedSearches; },
		get filters() { return filters; },
		get isFiltersOpen() { return isFiltersOpen; },

		// Actions
		load,
		addToHistory,
		removeFromHistory,
		clearHistory,
		saveSearch,
		removeSavedSearch,
		updateFilters,
		resetFilters,
		hasActiveFilters,
		toggleFilters,
		setDatePreset
	};
}

/** Search store singleton */
export const searchStore = createSearchStore();

export default searchStore;
