/**
 * Marketplace Store (NIP-15)
 * 
 * Manages classified listings for decentralized commerce.
 * https://github.com/nostr-protocol/nips/blob/master/15.md
 */

import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
import ndkService from '$services/ndk';
import { dbHelpers, type UserProfile } from '$db';
import { ErrorHandler, NetworkError, ErrorCode } from '$lib/core/errors';

/** NIP-15 Classified Listing kind */
export const LISTING_KIND = 30018;

/** Product condition */
export type ProductCondition = 'new' | 'like-new' | 'good' | 'fair' | 'poor';

/** Product category */
export type ProductCategory = 
	| 'electronics'
	| 'clothing'
	| 'collectibles'
	| 'services'
	| 'digital'
	| 'books'
	| 'home'
	| 'other';

/** Shipping option */
export interface ShippingOption {
	id: string;
	name: string;
	cost: number; // in sats
	regions?: string[];
}

/** Product listing parsed from NIP-15 event */
export interface ProductListing {
	id: string;
	pubkey: string;
	title: string;
	summary: string;
	content: string; // full description (markdown)
	price: number; // in sats
	currency: string;
	images: string[];
	category: ProductCategory;
	condition?: ProductCondition;
	location?: string;
	shipping?: ShippingOption[];
	tags: string[];
	created_at: number;
	// Metadata
	seller: UserProfile | null;
	raw: NDKEvent;
}

/** Filter options for listings */
export interface ListingFilters {
	category?: ProductCategory;
	minPrice?: number;
	maxPrice?: number;
	condition?: ProductCondition;
	location?: string;
	query?: string;
}

/** Parse NIP-15 event into ProductListing */
function parseListingEvent(event: NDKEvent, seller: UserProfile | null): ProductListing {
	const tags = event.tags;
	
	// Helper to get tag value
	const getTag = (name: string): string | undefined => {
		const tag = tags.find(t => t[0] === name);
		return tag ? tag[1] : undefined;
	};
	
	// Helper to get all values for a tag
	const getAllTags = (name: string): string[] => {
		return tags.filter(t => t[0] === name).map(t => t[1]);
	};

	// Parse price - support both "price" tag and amount in sats
	let price = 0;
	const priceTag = tags.find(t => t[0] === 'price');
	if (priceTag) {
		price = parseFloat(priceTag[1]) || 0;
		// If currency is specified and not sats, we'll keep track
	}

	// Parse images
	const images = getAllTags('image');
	// Also check for 'thumb' tags
	const thumbs = getAllTags('thumb');
	const allImages = [...images, ...thumbs].filter((v, i, a) => a.indexOf(v) === i);

	// Parse shipping options
	const shippingTags = tags.filter(t => t[0] === 'shipping');
	const shipping: ShippingOption[] = shippingTags.map((t, i) => ({
		id: `ship-${i}`,
		name: t[1] || 'Standard',
		cost: parseFloat(t[2]) || 0,
		regions: t[3] ? t[3].split(',') : undefined
	}));

	// Determine category
	const categoryTag = getTag('t') || getTag('category') || 'other';
	const category = normalizeCategory(categoryTag);

	return {
		id: event.id,
		pubkey: event.pubkey,
		title: getTag('title') || getTag('name') || 'Untitled',
		summary: getTag('summary') || '',
		content: event.content || '',
		price,
		currency: getTag('currency') || 'sat',
		images: allImages,
		category,
		condition: getTag('condition') as ProductCondition | undefined,
		location: getTag('location') || getTag('g'), // g = geohash
		shipping: shipping.length > 0 ? shipping : undefined,
		tags: getAllTags('t'),
		created_at: event.created_at || Math.floor(Date.now() / 1000),
		seller,
		raw: event
	};
}

/** Normalize category string to ProductCategory */
function normalizeCategory(cat: string): ProductCategory {
	const normalized = cat.toLowerCase().trim();
	const categoryMap: Record<string, ProductCategory> = {
		'electronics': 'electronics',
		'tech': 'electronics',
		'computer': 'electronics',
		'phone': 'electronics',
		'clothing': 'clothing',
		'clothes': 'clothing',
		'fashion': 'clothing',
		'apparel': 'clothing',
		'collectibles': 'collectibles',
		'collectible': 'collectibles',
		'art': 'collectibles',
		'services': 'services',
		'service': 'services',
		'digital': 'digital',
		'software': 'digital',
		'ebook': 'digital',
		'books': 'books',
		'book': 'books',
		'home': 'home',
		'furniture': 'home',
		'garden': 'home'
	};
	return categoryMap[normalized] || 'other';
}

/** Create marketplace store */
function createMarketplaceStore() {
	// State
	let listings = $state<ProductListing[]>([]);
	let isLoading = $state(false);
	let isLoadingMore = $state(false);
	let hasMore = $state(true);
	let error = $state<string | null>(null);
	let filters = $state<ListingFilters>({});
	let selectedListing = $state<ProductListing | null>(null);

	// Subscription management
	let subscriptionId: string | null = null;
	const seenIds = new Set<string>();

	// Profile cache
	const profileCache = new Map<string, UserProfile>();

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
				// Update listings with new profile
				listings = listings.map(l => 
					l.pubkey === pubkey ? { ...l, seller: profile } : l
				);
			}
		});

		return null;
	}

	/** Load listings from relays */
	async function loadListings(): Promise<void> {
		if (isLoading) return;

		isLoading = true;
		error = null;
		seenIds.clear();

		try {
			// Cleanup previous subscription
			if (subscriptionId) {
				ndkService.unsubscribe(subscriptionId);
				subscriptionId = null;
			}

			const filter: NDKFilter = {
				kinds: [LISTING_KIND],
				limit: 50
			};

			// Apply category filter via tags if set
			if (filters.category) {
				filter['#t'] = [filters.category];
			}

			// Fetch initial listings
			const events = await ndkService.ndk.fetchEvents(filter);
			const newListings: ProductListing[] = [];

			for (const event of events) {
				if (seenIds.has(event.id)) continue;
				seenIds.add(event.id);

				const seller = await getProfile(event.pubkey);
				const listing = parseListingEvent(event, seller);

				// Apply client-side filters
				if (matchesFilters(listing, filters)) {
					newListings.push(listing);
				}
			}

			// Sort by date (newest first)
			listings = newListings.sort((a, b) => b.created_at - a.created_at);
			hasMore = events.size >= 50;

			// Subscribe to new listings
			subscribeToListings();

		} catch (e) {
			console.error('Failed to load listings:', e);
			error = e instanceof Error ? e.message : 'Failed to load listings';
			ErrorHandler.handle(new NetworkError('Failed to load marketplace', { 
				code: ErrorCode.NETWORK_ERROR 
			}));
		} finally {
			isLoading = false;
		}
	}

	/** Subscribe to new listings */
	function subscribeToListings(): void {
		const filter: NDKFilter = {
			kinds: [LISTING_KIND],
			since: Math.floor(Date.now() / 1000)
		};

		if (filters.category) {
			filter['#t'] = [filters.category];
		}

		subscriptionId = ndkService.subscribe(filter, { closeOnEose: false }, {
			onEvent: async (event: NDKEvent) => {
				if (seenIds.has(event.id)) return;
				seenIds.add(event.id);

				const seller = await getProfile(event.pubkey);
				const listing = parseListingEvent(event, seller);

				if (matchesFilters(listing, filters)) {
					listings = [listing, ...listings];
				}
			}
		});
	}

	/** Load more listings (pagination) */
	async function loadMore(): Promise<void> {
		if (isLoadingMore || !hasMore || listings.length === 0) return;

		isLoadingMore = true;

		try {
			const oldestListing = listings[listings.length - 1];
			
			const filter: NDKFilter = {
				kinds: [LISTING_KIND],
				until: oldestListing.created_at,
				limit: 50
			};

			if (filters.category) {
				filter['#t'] = [filters.category];
			}

			const events = await ndkService.ndk.fetchEvents(filter);
			const newListings: ProductListing[] = [];

			for (const event of events) {
				if (seenIds.has(event.id)) continue;
				seenIds.add(event.id);

				const seller = await getProfile(event.pubkey);
				const listing = parseListingEvent(event, seller);

				if (matchesFilters(listing, filters)) {
					newListings.push(listing);
				}
			}

			if (newListings.length > 0) {
				listings = [...listings, ...newListings.sort((a, b) => b.created_at - a.created_at)];
			}

			hasMore = events.size >= 50;

		} catch (e) {
			console.error('Failed to load more listings:', e);
		} finally {
			isLoadingMore = false;
		}
	}

	/** Check if listing matches current filters */
	function matchesFilters(listing: ProductListing, f: ListingFilters): boolean {
		// Price filter
		if (f.minPrice !== undefined && listing.price < f.minPrice) return false;
		if (f.maxPrice !== undefined && listing.price > f.maxPrice) return false;

		// Condition filter
		if (f.condition && listing.condition !== f.condition) return false;

		// Location filter (partial match)
		if (f.location && listing.location) {
			if (!listing.location.toLowerCase().includes(f.location.toLowerCase())) {
				return false;
			}
		}

		// Text search
		if (f.query) {
			const query = f.query.toLowerCase();
			const searchable = `${listing.title} ${listing.summary} ${listing.content} ${listing.tags.join(' ')}`.toLowerCase();
			if (!searchable.includes(query)) {
				return false;
			}
		}

		return true;
	}

	/** Set filters and reload */
	async function setFilters(newFilters: ListingFilters): Promise<void> {
		filters = newFilters;
		await loadListings();
	}

	/** Clear all filters */
	async function clearFilters(): Promise<void> {
		filters = {};
		await loadListings();
	}

	/** Select a listing for detail view */
	function selectListing(listing: ProductListing | null): void {
		selectedListing = listing;
	}

	/** Create a new listing */
	async function createListing(data: {
		title: string;
		summary: string;
		content: string;
		price: number;
		currency?: string;
		images?: string[];
		category?: ProductCategory;
		condition?: ProductCondition;
		location?: string;
		tags?: string[];
	}): Promise<ProductListing> {
		const NDKEvent = (await import('@nostr-dev-kit/ndk')).NDKEvent;
		const event = new NDKEvent(ndkService.ndk);

		event.kind = LISTING_KIND;
		event.content = data.content;

		// Build tags
		const tags: string[][] = [
			['d', crypto.randomUUID()], // unique identifier
			['title', data.title],
			['summary', data.summary],
			['price', data.price.toString(), data.currency || 'sat'],
			['published_at', Math.floor(Date.now() / 1000).toString()]
		];

		if (data.category) {
			tags.push(['t', data.category]);
		}

		if (data.condition) {
			tags.push(['condition', data.condition]);
		}

		if (data.location) {
			tags.push(['location', data.location]);
		}

		if (data.images) {
			for (const img of data.images) {
				tags.push(['image', img]);
			}
		}

		if (data.tags) {
			for (const t of data.tags) {
				tags.push(['t', t]);
			}
		}

		event.tags = tags;

		await ndkService.publish(event);

		const seller = await getProfile(event.pubkey);
		const listing = parseListingEvent(event, seller);

		// Add to local listings
		listings = [listing, ...listings];

		return listing;
	}

	/** Contact seller via DM */
	async function contactSeller(listing: ProductListing): Promise<void> {
		// Import messages store dynamically to avoid circular deps
		const { messagesStore } = await import('./messages.svelte');
		await messagesStore.startConversation(listing.pubkey);
	}

	/** Format price for display */
	function formatPrice(price: number, currency: string = 'sat'): string {
		if (currency === 'sat' || currency === 'sats') {
			return `${price.toLocaleString()} sats`;
		}
		if (currency === 'btc') {
			return `${price} BTC`;
		}
		if (currency === 'usd') {
			return `$${price.toFixed(2)}`;
		}
		return `${price} ${currency}`;
	}

	/** Cleanup */
	function cleanup(): void {
		if (subscriptionId) {
			ndkService.unsubscribe(subscriptionId);
			subscriptionId = null;
		}
		seenIds.clear();
	}

	return {
		// State
		get listings() { return listings; },
		get isLoading() { return isLoading; },
		get isLoadingMore() { return isLoadingMore; },
		get hasMore() { return hasMore; },
		get error() { return error; },
		get filters() { return filters; },
		get selectedListing() { return selectedListing; },

		// Derived
		get listingCount() { return listings.length; },
		get categories(): ProductCategory[] {
			const cats = new Set(listings.map(l => l.category));
			return Array.from(cats);
		},

		// Actions
		loadListings,
		loadMore,
		setFilters,
		clearFilters,
		selectListing,
		createListing,
		contactSeller,
		formatPrice,
		cleanup
	};
}

/** Marketplace store singleton */
export const marketplaceStore = createMarketplaceStore();

export default marketplaceStore;
