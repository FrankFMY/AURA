<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import ndkService from '$services/ndk';
	import { dbHelpers, type UserProfile } from '$db';
	import type { NDKEvent, NDKFilter, NDKSubscription } from '@nostr-dev-kit/ndk';
	import { validatePubkey } from '$lib/validators/schemas';
	import { searchStore, DATE_PRESETS, type SearchFilters } from '$stores/search.svelte';
	import NoteCard from '$components/feed/NoteCard.svelte';
	import NoteSkeleton from '$components/feed/NoteSkeleton.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import { Card } from '$components/ui/card';
	import { Badge } from '$components/ui/badge';
	import { Skeleton } from '$components/ui/skeleton';
	import { EmptyState } from '$components/ui/empty-state';
	import { truncatePubkey } from '$lib/utils';
	import Search from 'lucide-svelte/icons/search';
	import TrendingUp from 'lucide-svelte/icons/trending-up';
	import Hash from 'lucide-svelte/icons/hash';
	import User from 'lucide-svelte/icons/user';
	import SearchX from 'lucide-svelte/icons/search-x';
	import Info from 'lucide-svelte/icons/info';
	import History from 'lucide-svelte/icons/history';
	import Bookmark from 'lucide-svelte/icons/bookmark';
	import X from 'lucide-svelte/icons/x';
	import Filter from 'lucide-svelte/icons/filter';
	import Calendar from 'lucide-svelte/icons/calendar';
	import ImageIcon from 'lucide-svelte/icons/image';
	import Video from 'lucide-svelte/icons/video';
	import MessageSquare from 'lucide-svelte/icons/message-square';
	import Heart from 'lucide-svelte/icons/heart';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import ChevronUp from 'lucide-svelte/icons/chevron-up';
	import Star from 'lucide-svelte/icons/star';
	import FileText from 'lucide-svelte/icons/file-text';
	import Clock from 'lucide-svelte/icons/clock';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Save from 'lucide-svelte/icons/save';

	type SearchTab = 'notes' | 'users' | 'hashtags';

	let query = $state('');
	let activeTab = $state<SearchTab>('notes');
	let isSearching = $state(false);
	let searchError = $state<string | null>(null);
	let noteResults = $state<NDKEvent[]>([]);
	let userResults = $state<UserProfile[]>([]);

	// Filter UI state
	let showFilters = $state(false);
	let showSaveDialog = $state(false);
	let saveSearchName = $state('');

	// Track current search to avoid race conditions
	let currentSearchId = 0;
	let currentSubscription: NDKSubscription | null = null;
	let trendingHashtags = $state<string[]>([
		'nostr',
		'bitcoin',
		'zaps',
		'lightning',
		'privacy',
		'freedom',
		'decentralization',
		'opensource',
	]);

	// Search timeouts
	const HASHTAG_SEARCH_TIMEOUT = 15000; // 15s for hashtag search (reliable)
	const TEXT_SEARCH_TIMEOUT = 10000; // 10s for text search

	// Date preset labels
	const datePresetLabels: Record<keyof typeof DATE_PRESETS, string> = {
		today: 'Today',
		week: 'This week',
		month: 'This month',
		year: 'This year'
	};

	// Content type options
	const contentTypes: Array<{ value: SearchFilters['contentType']; label: string; icon: typeof FileText }> = [
		{ value: 'all', label: 'All', icon: FileText },
		{ value: 'text', label: 'Text', icon: FileText },
		{ value: 'image', label: 'Images', icon: ImageIcon },
		{ value: 'video', label: 'Video', icon: Video }
	];

	// Get query from URL if present
	onMount(async () => {
		// Load search history and saved searches
		await searchStore.load();

		const urlQuery = get(page).url.searchParams.get('q');
		if (urlQuery) {
			query = urlQuery;
			handleSearch();
		}
	});

	/** Extract hashtags from query string */
	function extractHashtags(text: string): string[] {
		const hashtagRegex = /#(\w+)/g;
		const matches = text.match(hashtagRegex);
		return matches ? matches.map((tag) => tag.slice(1).toLowerCase()) : [];
	}

	/** Check if NDK is available for searching */
	function isNdkAvailable(): boolean {
		try {
			return ndkService.connectionStatus !== 'disconnected';
		} catch {
			return false;
		}
	}

	/** Fetch with timeout wrapper */
	async function fetchWithTimeout<T>(
		promise: Promise<T>,
		timeoutMs: number,
	): Promise<T> {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) =>
				setTimeout(
					() => reject(new Error('Search timeout')),
					timeoutMs,
				),
			),
		]);
	}

	/** Fetch with robust subscription (handles slow/partial relays) */
	async function fetchWithSubscription(
		filter: NDKFilter,
		timeoutMs: number,
		searchId: number,
	): Promise<NDKEvent[]> {
		// Cancel previous subscription if exists
		if (currentSubscription) {
			currentSubscription.stop();
			currentSubscription = null;
		}

		return new Promise((resolve) => {
			const events: NDKEvent[] = [];
			const sub = ndkService.ndk.subscribe(filter, {
				closeOnEose: false,
			});
			currentSubscription = sub;

			// Collect events
			sub.on('event', (event) => {
				// Only collect if this is still the current search
				if (searchId === currentSearchId) {
					events.push(event);
				}
			});

			// Resolve on timeout or EOSE (whichever comes first, but effectively timeout for aggregation)
			// We use a "soft" timeout to return whatever we have, even if some relays are slow
			setTimeout(() => {
				sub.stop();
				if (currentSubscription === sub) {
					currentSubscription = null;
				}
				// Only resolve if this is still the current search
				if (searchId === currentSearchId) {
					resolve(events);
				} else {
					resolve([]); // Return empty for stale searches
				}
			}, timeoutMs);
		});
	}

	async function handleSearch() {
		if (!query.trim()) return;

		// Check if NDK is available
		if (!isNdkAvailable()) {
			searchError =
				'Not connected to relays. Please wait for connection or refresh the page.';
			return;
		}

		// Add to search history
		await searchStore.addToHistory(query.trim(), activeTab);

		// Increment search ID to invalidate any in-flight searches
		currentSearchId++;
		const thisSearchId = currentSearchId;

		isSearching = true;
		searchError = null;
		noteResults = [];
		userResults = [];

		try {
			// Search notes
			if (activeTab === 'notes' || activeTab === 'hashtags') {
				await searchNotes(thisSearchId);
			}

			// Search users
			if (activeTab === 'users') {
				await searchUsers(thisSearchId);
			}
		} catch (e) {
			console.error('Search failed:', e);
			if (e instanceof Error && e.message === 'Search timeout') {
				searchError =
					'Search timed out. Relays may be slow - try again or use a different hashtag.';
			} else if (
				e instanceof Error &&
				e.message.includes('NDK not initialized')
			) {
				searchError =
					'Not connected to Nostr network. Please refresh the page.';
			} else {
				searchError = 'Search failed. Please try again.';
			}
		} finally {
			isSearching = false;
		}
	}

	/** Search for notes - uses hashtag filter when possible */
	async function searchNotes(searchId: number) {
		const trimmedQuery = query.trim();
		const hashtags = extractHashtags(trimmedQuery);
		const filters = searchStore.filters;

		let filter: NDKFilter;
		let timeout: number;

		if (hashtags.length > 0) {
			// Use #t filter for hashtag search - works on all relays!
			filter = {
				kinds: [1],
				'#t': hashtags,
				limit: 100,
			};
			timeout = HASHTAG_SEARCH_TIMEOUT;
		} else {
			// For non-hashtag queries, fetch recent notes and filter client-side
			filter = {
				kinds: [1],
				limit: 200,
				since: filters.since || Math.floor(Date.now() / 1000) - 86400 * 7,
			};
			timeout = TEXT_SEARCH_TIMEOUT;
		}

		// Apply date filters from searchStore
		if (filters.since) {
			filter.since = filters.since;
		}
		if (filters.until) {
			filter.until = filters.until;
		}

		// Apply author filter
		if (filters.author) {
			filter.authors = [filters.author];
		}

		const events = await fetchWithSubscription(filter, timeout, searchId);

		// Check if this search is still current
		if (searchId !== currentSearchId) return;

		let results = Array.from(events);

		// If not a hashtag search, filter client-side by content
		if (hashtags.length === 0) {
			const searchTerms = trimmedQuery.toLowerCase().split(/\s+/);
			results = results.filter((event) => {
				const content = event.content.toLowerCase();
				return searchTerms.some((term) => content.includes(term));
			});
		}

		// Apply content type filter
		if (filters.contentType && filters.contentType !== 'all') {
			results = results.filter((event) => {
				const content = event.content.toLowerCase();
				const hasImage = /\.(jpg|jpeg|png|gif|webp|svg)/i.test(content) || content.includes('image');
				const hasVideo = /\.(mp4|webm|mov|avi)/i.test(content) || content.includes('video');

				switch (filters.contentType) {
					case 'image':
						return hasImage;
					case 'video':
						return hasVideo;
					case 'text':
						return !hasImage && !hasVideo;
					default:
						return true;
				}
			});
		}

		// Sort results
		if (filters.sortBy === 'recent') {
			results.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
		}
		// Note: sorting by reactions/replies would require fetching reaction counts
		// which is complex - keeping recent sort for now

		noteResults = results;
	}

	/** Search for users - by npub/hex or local cache */
	async function searchUsers(searchId: number) {
		const trimmedQuery = query.trim();

		// Check if query is an npub or hex pubkey - direct lookup
		const directPubkey = validatePubkey(trimmedQuery);

		if (directPubkey) {
			// Direct profile lookup by pubkey
			try {
				await fetchWithTimeout(
					ndkService.fetchProfile(directPubkey),
					TEXT_SEARCH_TIMEOUT,
				);

				// Check if this search is still current
				if (searchId !== currentSearchId) return;

				const profile = await dbHelpers.getProfile(directPubkey);
				if (profile) {
					userResults = [profile];
				} else {
					// Profile might not exist, but show the pubkey anyway
					userResults = [
						{
							pubkey: directPubkey,
							updated_at: Date.now(),
						},
					];
				}
			} catch (e) {
				console.error('Direct profile lookup failed:', e);

				// Check if this search is still current
				if (searchId !== currentSearchId) return;

				// Still show the pubkey even if lookup fails
				userResults = [
					{
						pubkey: directPubkey,
						updated_at: Date.now(),
					},
				];
			}
		} else {
			// Search through locally cached profiles
			// This is more reliable than NIP-50 and works offline
			const cachedProfiles = await dbHelpers.searchProfiles(trimmedQuery);

			// Check if this search is still current
			if (searchId !== currentSearchId) return;

			userResults = cachedProfiles;

			// If no local results, show helpful message
			if (cachedProfiles.length === 0) {
				searchError =
					'No cached profiles found. Try entering an npub or hex pubkey directly.';
			}
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			handleSearch();
		}
	}

	function searchHashtag(tag: string) {
		query = `#${tag}`;
		activeTab = 'notes';
		handleSearch();
	}

	/** Load a saved search */
	function loadSavedSearch(saved: typeof searchStore.savedSearches[0]) {
		query = saved.query;
		searchStore.updateFilters(saved.filters);
		handleSearch();
	}

	/** Load from history */
	function loadFromHistory(entry: typeof searchStore.history[0]) {
		query = entry.query;
		activeTab = entry.tab;
		handleSearch();
	}

	/** Save current search */
	async function handleSaveSearch() {
		if (!saveSearchName.trim() || !query.trim()) return;
		await searchStore.saveSearch(saveSearchName.trim(), query.trim());
		saveSearchName = '';
		showSaveDialog = false;
	}

	/** Clear all history */
	async function handleClearHistory() {
		await searchStore.clearHistory();
	}

	/** Format timestamp for display */
	function formatHistoryTime(timestamp: number): string {
		const diff = Date.now() - timestamp;
		const minutes = Math.floor(diff / 60000);
		const hours = Math.floor(diff / 3600000);
		const days = Math.floor(diff / 86400000);

		if (minutes < 1) return 'just now';
		if (minutes < 60) return `${minutes}m ago`;
		if (hours < 24) return `${hours}h ago`;
		return `${days}d ago`;
	}

	// Cleanup subscription on component destroy
	onDestroy(() => {
		if (currentSubscription) {
			currentSubscription.stop();
			currentSubscription = null;
		}
	});
</script>

<svelte:head>
	<title>Search | AURA</title>
</svelte:head>

<div class="min-h-screen pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
	<header
		class="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur"
	>
		<div class="p-4 space-y-3">
			<!-- Search input row -->
			<div class="relative">
				<Search
					class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={query}
					placeholder={activeTab === 'users' ?
						'Enter npub or search by name...'
					:	'Search by #hashtag or keywords...'}
					class="pl-10 pr-28"
					onkeydown={handleKeydown}
				/>
				<div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
					{#if activeTab === 'notes'}
						<Button
							variant="ghost"
							size="icon"
							class="h-8 w-8"
							onclick={() => showFilters = !showFilters}
							title="Toggle filters"
						>
							<Filter class="h-4 w-4 {searchStore.hasActiveFilters() ? 'text-primary' : ''}" />
						</Button>
					{/if}
					<Button
						variant="ghost"
						size="sm"
						onclick={handleSearch}
						disabled={!query.trim() || isSearching}
					>
						Search
					</Button>
				</div>
			</div>

			<!-- Filter chips (quick indicators) -->
			{#if searchStore.hasActiveFilters() && activeTab === 'notes'}
				<div class="flex flex-wrap gap-2">
					{#if searchStore.filters.since}
						<Badge variant="secondary" class="gap-1">
							<Calendar class="h-3 w-3" />
							Since: {new Date(searchStore.filters.since * 1000).toLocaleDateString()}
							<button
								class="ml-1 hover:text-destructive"
								onclick={() => searchStore.updateFilters({ since: undefined })}
							>
								<X class="h-3 w-3" />
							</button>
						</Badge>
					{/if}
					{#if searchStore.filters.contentType && searchStore.filters.contentType !== 'all'}
						<Badge variant="secondary" class="gap-1">
							{searchStore.filters.contentType}
							<button
								class="ml-1 hover:text-destructive"
								onclick={() => searchStore.updateFilters({ contentType: 'all' })}
							>
								<X class="h-3 w-3" />
							</button>
						</Badge>
					{/if}
					<Button
						variant="ghost"
						size="sm"
						class="h-6 text-xs text-muted-foreground"
						onclick={() => searchStore.resetFilters()}
					>
						Clear all
					</Button>
				</div>
			{/if}

			<!-- Expanded filters panel -->
			{#if showFilters && activeTab === 'notes'}
				<Card class="p-4 space-y-4">
					<!-- Date presets -->
					<div>
						<span class="text-sm font-medium text-muted-foreground mb-2 block">
							Date Range
						</span>
						<div class="flex flex-wrap gap-2">
							{#each Object.entries(datePresetLabels) as [key, label]}
								<Button
									variant={searchStore.filters.since === DATE_PRESETS[key as keyof typeof DATE_PRESETS]() ? 'default' : 'outline'}
									size="sm"
									onclick={() => searchStore.setDatePreset(key as keyof typeof DATE_PRESETS)}
								>
									{label}
								</Button>
							{/each}
						</div>
					</div>

					<!-- Content type -->
					<div>
						<span class="text-sm font-medium text-muted-foreground mb-2 block">
							Content Type
						</span>
						<div class="flex flex-wrap gap-2">
							{#each contentTypes as ct}
								<Button
									variant={searchStore.filters.contentType === ct.value ? 'default' : 'outline'}
									size="sm"
									class="gap-1"
									onclick={() => searchStore.updateFilters({ contentType: ct.value })}
								>
									{#if ct.value === 'image'}
										<ImageIcon class="h-3 w-3" />
									{:else if ct.value === 'video'}
										<Video class="h-3 w-3" />
									{:else}
										<FileText class="h-3 w-3" />
									{/if}
									{ct.label}
								</Button>
							{/each}
						</div>
					</div>

					<!-- Save search button -->
					{#if query.trim()}
						<div class="flex items-center gap-2 pt-2 border-t border-border">
							{#if showSaveDialog}
								<Input
									bind:value={saveSearchName}
									placeholder="Name this search..."
									class="flex-1 h-8 text-sm"
									onkeydown={(e) => e.key === 'Enter' && handleSaveSearch()}
								/>
								<Button size="sm" onclick={handleSaveSearch} disabled={!saveSearchName.trim()}>
									<Save class="h-4 w-4 mr-1" />
									Save
								</Button>
								<Button variant="ghost" size="sm" onclick={() => showSaveDialog = false}>
									Cancel
								</Button>
							{:else}
								<Button variant="outline" size="sm" onclick={() => showSaveDialog = true}>
									<Star class="h-4 w-4 mr-1" />
									Save this search
								</Button>
							{/if}
						</div>
					{/if}
				</Card>
			{/if}
		</div>

		<!-- Tabs -->
		<div class="flex border-b border-border">
			<button
				class="flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors
					{activeTab === 'notes' ?
					'border-b-2 border-primary text-primary'
				:	'text-muted-foreground hover:text-foreground'}"
				onclick={() => {
					activeTab = 'notes';
					if (query) handleSearch();
				}}
			>
				<Search class="h-4 w-4" />
				Notes
			</button>
			<button
				class="flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors
					{activeTab === 'users' ?
					'border-b-2 border-primary text-primary'
				:	'text-muted-foreground hover:text-foreground'}"
				onclick={() => {
					activeTab = 'users';
					if (query) handleSearch();
				}}
			>
				<User class="h-4 w-4" />
				Users
			</button>
			<button
				class="flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors
					{activeTab === 'hashtags' ?
					'border-b-2 border-primary text-primary'
				:	'text-muted-foreground hover:text-foreground'}"
				onclick={() => {
					activeTab = 'hashtags';
				}}
			>
				<Hash class="h-4 w-4" />
				Hashtags
			</button>
		</div>
	</header>

	<div class="mx-auto max-w-2xl">
		{#if !query && activeTab !== 'hashtags'}
			<!-- Search history section -->
			{#if searchStore.history.length > 0}
				<div class="p-4 border-b border-border">
					<div class="mb-3 flex items-center justify-between">
						<div class="flex items-center gap-2">
							<History class="h-5 w-5 text-muted-foreground" />
							<h2 class="font-semibold">Recent Searches</h2>
						</div>
						<Button
							variant="ghost"
							size="sm"
							class="text-xs text-muted-foreground"
							onclick={handleClearHistory}
						>
							Clear all
						</Button>
					</div>
					<div class="space-y-1">
						{#each searchStore.history.slice(0, 5) as entry}
							<div class="flex items-center gap-2 group">
								<button
									class="flex-1 flex items-center gap-3 p-2 rounded-lg text-left hover:bg-muted/50 transition-colors"
									onclick={() => loadFromHistory(entry)}
								>
									<Clock class="h-4 w-4 text-muted-foreground" />
									<span class="flex-1 truncate">{entry.query}</span>
									<span class="text-xs text-muted-foreground">
										{formatHistoryTime(entry.timestamp)}
									</span>
								</button>
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
									onclick={() => searchStore.removeFromHistory(entry.query)}
								>
									<X class="h-4 w-4" />
								</Button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Saved searches section -->
			{#if searchStore.savedSearches.length > 0}
				<div class="p-4 border-b border-border">
					<div class="mb-3 flex items-center gap-2">
						<Star class="h-5 w-5 text-primary" />
						<h2 class="font-semibold">Saved Searches</h2>
					</div>
					<div class="space-y-1">
						{#each searchStore.savedSearches as saved}
							<div class="flex items-center gap-2 group">
								<button
									class="flex-1 flex items-center gap-3 p-2 rounded-lg text-left hover:bg-muted/50 transition-colors"
									onclick={() => loadSavedSearch(saved)}
								>
									<Bookmark class="h-4 w-4 text-primary" />
									<div class="flex-1 min-w-0">
										<span class="block font-medium truncate">{saved.name}</span>
										<span class="text-xs text-muted-foreground truncate block">{saved.query}</span>
									</div>
								</button>
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
									onclick={() => searchStore.removeSavedSearch(saved.id)}
								>
									<Trash2 class="h-4 w-4" />
								</Button>
							</div>
						{/each}
					</div>
				</div>
			{/if}

			<!-- Trending/Suggestions when no query -->
			<div class="p-4">
				<div class="mb-4 flex items-center gap-2">
					<TrendingUp class="h-5 w-5 text-primary" />
					<h2 class="font-semibold">Trending Hashtags</h2>
				</div>
				<div class="flex flex-wrap gap-2">
					{#each trendingHashtags as tag}
						<Button
							variant="secondary"
							size="sm"
							onclick={() => searchHashtag(tag)}
						>
							#{tag}
						</Button>
					{/each}
				</div>
			</div>
		{:else if activeTab === 'hashtags'}
			<!-- Hashtag exploration -->
			<div class="p-4">
				<h2 class="mb-4 font-semibold">Popular Hashtags</h2>
				<div class="grid gap-2">
					{#each trendingHashtags as tag}
						<Card
							class="cursor-pointer p-4 transition-colors hover:bg-muted/50"
							onclick={() => searchHashtag(tag)}
						>
							<div class="flex items-center justify-between">
								<div class="flex items-center gap-3">
									<div
										class="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10"
									>
										<Hash class="h-5 w-5 text-primary" />
									</div>
									<span class="font-medium">#{tag}</span>
								</div>
								<Badge variant="secondary">Trending</Badge>
							</div>
						</Card>
					{/each}
				</div>
			</div>
		{:else if isSearching}
			<!-- Loading state -->
			{#if activeTab === 'notes'}
				{#each Array(3) as _}
					<NoteSkeleton />
				{/each}
			{:else}
				<div class="space-y-2 p-4">
					{#each Array(5) as _}
						<div class="flex items-center gap-3 p-3">
							<Skeleton class="h-12 w-12 rounded-full" />
							<div class="space-y-2">
								<Skeleton class="h-4 w-32" />
								<Skeleton class="h-3 w-24" />
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{:else if searchError}
			<!-- Search error/info message -->
			<div class="p-4">
				<div class="rounded-lg border border-border bg-muted/50 p-4">
					<div class="flex items-start gap-3">
						<Info class="h-5 w-5 text-muted-foreground mt-0.5" />
						<div>
							<p class="text-sm text-muted-foreground">
								{searchError}
							</p>
							{#if activeTab === 'users'}
								<p class="text-xs text-muted-foreground mt-2">
									Tip: Use <code class="bg-muted px-1 rounded"
										>npub...</code
									> for direct lookup
								</p>
							{:else}
								<p class="text-xs text-muted-foreground mt-2">
									Tip: Use hashtags like <code
										class="bg-muted px-1 rounded"
										>#nostr</code
									> for better results
								</p>
							{/if}
						</div>
					</div>
				</div>
			</div>
		{:else if activeTab === 'notes'}
			<!-- Note results -->
			{#if noteResults.length === 0}
				<EmptyState
					icon={SearchX}
					title="No notes found"
					description={`No notes found for "${query}". Try using hashtags like #nostr for better results.`}
					variant="muted"
					size="md"
				/>
			{:else}
				{#each noteResults as note (note.id)}
					<NoteCard
						event={note}
						author={null}
						replyCount={0}
						reactionCount={0}
						repostCount={0}
					/>
				{/each}
			{/if}
		{:else if activeTab === 'users'}
			<!-- User results -->
			{#if userResults.length === 0 && !searchError}
				<EmptyState
					icon={User}
					title="No users found"
					description={`No cached profiles match "${query}". Enter an npub or hex pubkey for direct lookup.`}
					variant="muted"
					size="md"
				/>
			{:else if userResults.length === 0}
				<!-- Error already shown above -->
			{:else}
				<div class="divide-y divide-border">
					{#each userResults as user (user.pubkey)}
						<a
							href="/profile/{user.pubkey}"
							class="flex items-center gap-4 p-4 transition-colors hover:bg-muted/50"
						>
							<Avatar size="lg">
								<AvatarImage src={user.picture} />
								<AvatarFallback>
									{(user.display_name || user.name || 'A')
										.slice(0, 2)
										.toUpperCase()}
								</AvatarFallback>
							</Avatar>
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<p class="font-medium">
										{user.display_name ||
											user.name ||
											'Anonymous'}
									</p>
									{#if user.nip05}
										<Badge
											variant="success"
											class="text-xs"
										>
											{user.nip05}
										</Badge>
									{/if}
								</div>
								<p
									class="truncate text-sm text-muted-foreground"
								>
									{user.about || truncatePubkey(user.pubkey)}
								</p>
							</div>
							<Button
								variant="outline"
								size="sm"
							>
								View
							</Button>
						</a>
					{/each}
				</div>
			{/if}
		{/if}
	</div>
</div>
