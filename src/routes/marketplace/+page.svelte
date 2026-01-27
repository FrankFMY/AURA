<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { marketplaceStore, type ProductListing, type ProductCategory, type ProductCondition } from '$stores/marketplace.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { wotStore } from '$stores/wot.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import { Badge } from '$components/ui/badge';
	import { Card, CardHeader, CardContent, CardFooter } from '$components/ui/card';
	import { Skeleton } from '$components/ui/skeleton';
	import { EmptyState } from '$components/ui/empty-state';
	import { Spinner } from '$components/ui/spinner';
	import { TrustBadge, TrustFilter } from '$components/wot';
	import { truncatePubkey, formatRelativeTime } from '$lib/utils';
	import Search from 'lucide-svelte/icons/search';
	import Store from 'lucide-svelte/icons/store';
	import Package from 'lucide-svelte/icons/package';
	import Tag from 'lucide-svelte/icons/tag';
	import MapPin from 'lucide-svelte/icons/map-pin';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Plus from 'lucide-svelte/icons/plus';
	import Filter from 'lucide-svelte/icons/filter';
	import X from 'lucide-svelte/icons/x';
	import Zap from 'lucide-svelte/icons/zap';
	import Grid from 'lucide-svelte/icons/grid-3x3';
	import List from 'lucide-svelte/icons/list';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';

	// State
	let searchQuery = $state('');
	let showFilters = $state(false);
	let viewMode = $state<'grid' | 'list'>('grid');
	let selectedCategory = $state<ProductCategory | ''>('');
	let minPrice = $state<number | ''>('');
	let maxPrice = $state<number | ''>('');
	let showCreateModal = $state(false);
	let failedImages = $state<Set<string>>(new Set());

	// Track failed images
	function handleImageError(imageUrl: string) {
		failedImages = new Set([...failedImages, imageUrl]);
	}

	// Categories for filter
	const categories: { value: ProductCategory | ''; label: string }[] = [
		{ value: '', label: 'All Categories' },
		{ value: 'electronics', label: 'Electronics' },
		{ value: 'clothing', label: 'Clothing' },
		{ value: 'collectibles', label: 'Collectibles' },
		{ value: 'services', label: 'Services' },
		{ value: 'digital', label: 'Digital Goods' },
		{ value: 'books', label: 'Books' },
		{ value: 'home', label: 'Home & Garden' },
		{ value: 'other', label: 'Other' }
	];

	// Category icons
	const categoryIcons: Record<ProductCategory, string> = {
		electronics: '📱',
		clothing: '👕',
		collectibles: '🎨',
		services: '🛠️',
		digital: '💾',
		books: '📚',
		home: '🏠',
		other: '📦'
	};

	onMount(() => {
		marketplaceStore.loadListings();
	});

	onDestroy(() => {
		marketplaceStore.cleanup();
	});

	// Filter listings by WoT
	const filteredListings = $derived(
		wotStore.isInitialized
			? marketplaceStore.listings.filter(l => wotStore.passesFilter(l.pubkey))
			: marketplaceStore.listings
	);

	// Apply filters
	async function applyFilters() {
		await marketplaceStore.setFilters({
			category: selectedCategory || undefined,
			minPrice: minPrice !== '' ? Number(minPrice) : undefined,
			maxPrice: maxPrice !== '' ? Number(maxPrice) : undefined,
			query: searchQuery || undefined
		});
	}

	// Clear filters
	async function clearFilters() {
		searchQuery = '';
		selectedCategory = '';
		minPrice = '';
		maxPrice = '';
		await marketplaceStore.clearFilters();
	}

	// Handle search
	function handleSearch() {
		applyFilters();
	}

	// Handle contact seller
	async function handleContact(listing: ProductListing) {
		await marketplaceStore.contactSeller(listing);
		goto('/messages');
	}

	// Get placeholder image
	function getPlaceholderImage(category: ProductCategory): string {
		return `https://placehold.co/400x300/1a1a2e/ffffff?text=${encodeURIComponent(categoryIcons[category] || '📦')}`;
	}

	// Handle infinite scroll (throttled to prevent rapid fire)
	let lastScrollCheck = 0;
	const SCROLL_THROTTLE_MS = 300;

	function handleScroll(e: Event) {
		const now = Date.now();
		if (now - lastScrollCheck < SCROLL_THROTTLE_MS) return;
		lastScrollCheck = now;

		const target = e.target as HTMLElement;
		const threshold = 200;

		if (target.scrollHeight - target.scrollTop - target.clientHeight < threshold) {
			if (!marketplaceStore.isLoadingMore && marketplaceStore.hasMore) {
				marketplaceStore.loadMore();
			}
		}
	}
</script>

<svelte:head>
	<title>Marketplace | AURA</title>
</svelte:head>

<div class="flex h-dvh flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
	<!-- Header -->
	<div class="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
		<div class="p-4">
			<div class="flex items-center justify-between mb-4">
				<div class="flex items-center gap-2">
					<Store class="h-6 w-6 text-primary" />
					<h1 class="text-xl font-bold">Marketplace</h1>
				</div>
				<div class="flex items-center gap-2">
					<!-- Trust Filter -->
					{#if wotStore.isInitialized}
						<TrustFilter />
					{/if}
					<Button
						variant="ghost"
						size="icon"
						onclick={() => viewMode = viewMode === 'grid' ? 'list' : 'grid'}
					>
						{#if viewMode === 'grid'}
							<List class="h-5 w-5" />
						{:else}
							<Grid class="h-5 w-5" />
						{/if}
					</Button>
					<Button
						variant="ghost"
						size="icon"
						onclick={() => showFilters = !showFilters}
						class={showFilters ? 'bg-muted' : ''}
					>
						<Filter class="h-5 w-5" />
					</Button>
					{#if authStore.isAuthenticated}
						<Button variant="glow" size="sm" onclick={() => showCreateModal = true}>
							<Plus class="h-4 w-4 mr-1" />
							Sell
						</Button>
					{/if}
				</div>
			</div>

			<!-- Search -->
			<div class="relative">
				<Search class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
				<Input
					bind:value={searchQuery}
					placeholder="Search products..."
					class="pl-10 pr-10"
					onkeydown={(e) => e.key === 'Enter' && handleSearch()}
				/>
				{#if searchQuery}
					<button
						class="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
						onclick={() => { searchQuery = ''; applyFilters(); }}
					>
						<X class="h-4 w-4" />
					</button>
				{/if}
			</div>

			<!-- Filters Panel -->
			{#if showFilters}
				<div class="mt-4 p-4 rounded-lg bg-muted/50 space-y-4">
					<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
						<!-- Category -->
						<div class="space-y-1">
							<label for="category-filter" class="text-sm font-medium">Category</label>
							<select
								id="category-filter"
								bind:value={selectedCategory}
								class="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
								onchange={() => applyFilters()}
							>
								{#each categories as cat}
									<option value={cat.value}>{cat.label}</option>
								{/each}
							</select>
						</div>

						<!-- Min Price -->
						<div class="space-y-1">
							<label for="min-price-filter" class="text-sm font-medium">Min Price (sats)</label>
							<Input
								id="min-price-filter"
								type="number"
								value={minPrice === '' ? '' : String(minPrice)}
								oninput={(e) => {
									const val = (e.target as HTMLInputElement).value;
									minPrice = val === '' ? '' : parseInt(val) || 0;
								}}
								placeholder="0"
								onchange={() => applyFilters()}
							/>
						</div>

						<!-- Max Price -->
						<div class="space-y-1">
							<label for="max-price-filter" class="text-sm font-medium">Max Price (sats)</label>
							<Input
								id="max-price-filter"
								type="number"
								value={maxPrice === '' ? '' : String(maxPrice)}
								oninput={(e) => {
									const val = (e.target as HTMLInputElement).value;
									maxPrice = val === '' ? '' : parseInt(val) || 0;
								}}
								placeholder="No limit"
								onchange={() => applyFilters()}
							/>
						</div>
					</div>

					<div class="flex justify-end">
						<Button variant="ghost" size="sm" onclick={clearFilters}>
							Clear Filters
						</Button>
					</div>
				</div>
			{/if}

			<!-- Active Filters -->
			{#if selectedCategory || minPrice || maxPrice || searchQuery}
				<div class="flex flex-wrap gap-2 mt-3">
					{#if selectedCategory}
						<Badge variant="secondary" class="gap-1">
							{categoryIcons[selectedCategory]} {selectedCategory}
							<button onclick={() => { selectedCategory = ''; applyFilters(); }}>
								<X class="h-3 w-3" />
							</button>
						</Badge>
					{/if}
					{#if minPrice}
						<Badge variant="secondary" class="gap-1">
							Min: {minPrice} sats
							<button onclick={() => { minPrice = ''; applyFilters(); }}>
								<X class="h-3 w-3" />
							</button>
						</Badge>
					{/if}
					{#if maxPrice}
						<Badge variant="secondary" class="gap-1">
							Max: {maxPrice} sats
							<button onclick={() => { maxPrice = ''; applyFilters(); }}>
								<X class="h-3 w-3" />
							</button>
						</Badge>
					{/if}
				</div>
			{/if}
		</div>
	</div>

	<!-- Content -->
	<div class="flex-1 overflow-y-auto" onscroll={handleScroll}>
		{#if marketplaceStore.isLoading && marketplaceStore.listings.length === 0}
			<!-- Loading Skeleton -->
			<div class="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
				{#each Array(6) as _}
					<Card>
						<Skeleton class="h-48 w-full rounded-t-lg" />
						<CardContent class="p-4 space-y-2">
							<Skeleton class="h-5 w-3/4" />
							<Skeleton class="h-4 w-1/2" />
							<Skeleton class="h-6 w-24" />
						</CardContent>
					</Card>
				{/each}
			</div>
		{:else if filteredListings.length === 0}
			<EmptyState
				icon={Store}
				title="No listings found"
				description={wotStore.filterLevel !== 'all' ? "Try adjusting your trust filter to see more listings." : "Be the first to list something for sale!"}
				variant="muted"
				size="lg"
				actionLabel={authStore.isAuthenticated ? "Create Listing" : undefined}
				onAction={authStore.isAuthenticated ? () => showCreateModal = true : undefined}
			/>
		{:else}
			<!-- Listings Grid/List -->
			<div class="p-4 {viewMode === 'grid' ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-4'}">
				{#each filteredListings as listing (listing.id)}
					<Card class="overflow-hidden hover:shadow-lg transition-shadow cursor-pointer group">
						<!-- Image -->
						<div class="relative aspect-4/3 bg-muted overflow-hidden">
							{#if listing.images.length > 0 && !failedImages.has(listing.images[0])}
								<img
									src={listing.images[0]}
									alt={listing.title}
									class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
									loading="lazy"
									onerror={() => handleImageError(listing.images[0])}
								/>
							{:else}
								<div class="w-full h-full flex items-center justify-center text-4xl bg-linear-to-br from-muted to-muted/50">
									{categoryIcons[listing.category] || '📦'}
								</div>
							{/if}
							
							<!-- Category Badge -->
							<Badge class="absolute top-2 left-2 bg-background/80 backdrop-blur-sm">
								{categoryIcons[listing.category]} {listing.category}
							</Badge>

							<!-- Price Badge -->
							<div class="absolute bottom-2 right-2 px-3 py-1 rounded-full bg-primary text-primary-foreground font-bold flex items-center gap-1">
								<Zap class="h-4 w-4" />
								{marketplaceStore.formatPrice(listing.price, listing.currency)}
							</div>
						</div>

						<CardContent class="p-4">
							<h3 class="font-semibold text-lg line-clamp-1 mb-1">
								{listing.title}
							</h3>
							
							{#if listing.summary}
								<p class="text-sm text-muted-foreground line-clamp-2 mb-3">
									{listing.summary}
								</p>
							{/if}

							<!-- Seller info -->
							<div class="flex items-center justify-between">
								<a
									href="/profile/{listing.pubkey}"
									class="flex items-center gap-2 hover:opacity-80 transition-opacity"
									onclick={(e) => e.stopPropagation()}
								>
									<Avatar size="sm">
										<AvatarImage src={listing.seller?.picture} />
										<AvatarFallback>
											{(listing.seller?.display_name || listing.seller?.name || '?')[0]?.toUpperCase()}
										</AvatarFallback>
									</Avatar>
									<span class="text-sm text-muted-foreground flex items-center gap-1">
										{listing.seller?.display_name || listing.seller?.name || truncatePubkey(listing.pubkey)}
										<TrustBadge pubkey={listing.pubkey} size="sm" />
									</span>
								</a>

								{#if listing.location}
									<div class="flex items-center gap-1 text-xs text-muted-foreground">
										<MapPin class="h-3 w-3" />
										{listing.location}
									</div>
								{/if}
							</div>

							<!-- Tags -->
							{#if listing.tags.length > 0}
								<div class="flex flex-wrap gap-1 mt-3">
									{#each listing.tags.slice(0, 3) as tag}
										<Badge variant="outline" class="text-xs">#{tag}</Badge>
									{/each}
									{#if listing.tags.length > 3}
										<Badge variant="outline" class="text-xs">+{listing.tags.length - 3}</Badge>
									{/if}
								</div>
							{/if}
						</CardContent>

						<CardFooter class="p-4 pt-0 gap-2">
							<Button
								variant="outline"
								size="sm"
								class="flex-1"
								onclick={(e) => { e.stopPropagation(); handleContact(listing); }}
							>
								<MessageCircle class="h-4 w-4 mr-1" />
								Contact
							</Button>
							<Button
								variant="default"
								size="sm"
								class="flex-1"
								onclick={(e) => { e.stopPropagation(); marketplaceStore.selectListing(listing); }}
							>
								View Details
							</Button>
						</CardFooter>
					</Card>
				{/each}
			</div>

			<!-- Load more -->
			{#if marketplaceStore.isLoadingMore}
				<div class="flex justify-center p-4">
					<Spinner size="md" />
				</div>
			{:else if marketplaceStore.hasMore}
				<div class="flex justify-center p-4">
					<Button variant="outline" onclick={() => marketplaceStore.loadMore()}>
						Load More
					</Button>
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Product Detail Modal -->
{#if marketplaceStore.selectedListing}
	{@const listing = marketplaceStore.selectedListing}
	<div
		class="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center sm:p-4"
		onclick={() => marketplaceStore.selectListing(null)}
		onkeydown={(e) => e.key === 'Escape' && marketplaceStore.selectListing(null)}
		role="button"
		tabindex="0"
	>
		<Card
			class="w-full sm:max-w-2xl max-h-[85vh] sm:max-h-[90vh] overflow-y-auto bg-card rounded-t-2xl sm:rounded-xl safe-area-pb"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Images -->
			{#if listing.images.length > 0 && !failedImages.has(listing.images[0])}
				<div class="relative aspect-video bg-muted">
					<img
						src={listing.images[0]}
						alt={listing.title}
						class="w-full h-full object-contain"
						onerror={() => handleImageError(listing.images[0])}
					/>
				</div>
			{:else if listing.images.length > 0}
				<div class="relative aspect-video bg-muted flex items-center justify-center text-6xl">
					{categoryIcons[listing.category] || '📦'}
				</div>
			{/if}

			<CardHeader>
				<div class="flex items-start justify-between gap-4">
					<div>
						<h2 class="text-2xl font-bold">{listing.title}</h2>
						<div class="flex items-center gap-2 mt-1">
							<Badge>{categoryIcons[listing.category]} {listing.category}</Badge>
							{#if listing.condition}
								<Badge variant="outline">{listing.condition}</Badge>
							{/if}
						</div>
					</div>
					<Button
						variant="ghost"
						size="icon"
						onclick={() => marketplaceStore.selectListing(null)}
					>
						<X class="h-5 w-5" />
					</Button>
				</div>
			</CardHeader>

			<CardContent class="space-y-4">
				<!-- Price -->
				<div class="flex items-center gap-2 text-2xl font-bold text-primary">
					<Zap class="h-6 w-6" />
					{marketplaceStore.formatPrice(listing.price, listing.currency)}
				</div>

				<!-- Description -->
				{#if listing.summary}
					<p class="text-muted-foreground">{listing.summary}</p>
				{/if}
				
				{#if listing.content}
					<div class="prose prose-sm dark:prose-invert max-w-none">
						{listing.content}
					</div>
				{/if}

				<!-- Seller -->
				<div class="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
					<Avatar>
						<AvatarImage src={listing.seller?.picture} />
						<AvatarFallback>
							{(listing.seller?.display_name || listing.seller?.name || '?')[0]?.toUpperCase()}
						</AvatarFallback>
					</Avatar>
					<div class="flex-1">
						<p class="font-medium">
							{listing.seller?.display_name || listing.seller?.name || truncatePubkey(listing.pubkey)}
						</p>
						<p class="text-sm text-muted-foreground">Seller</p>
					</div>
					<a href="/profile/{listing.pubkey}">
						<Button variant="outline" size="sm">View Profile</Button>
					</a>
				</div>

				<!-- Location -->
				{#if listing.location}
					<div class="flex items-center gap-2 text-muted-foreground">
						<MapPin class="h-4 w-4" />
						{listing.location}
					</div>
				{/if}

				<!-- Shipping -->
				{#if listing.shipping && listing.shipping.length > 0}
					<div class="space-y-2">
						<h4 class="font-medium">Shipping Options</h4>
						{#each listing.shipping as ship}
							<div class="flex items-center justify-between p-2 rounded bg-muted/30">
								<span>{ship.name}</span>
								<span class="font-medium">
									{ship.cost > 0 ? `${ship.cost} sats` : 'Free'}
								</span>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Tags -->
				{#if listing.tags.length > 0}
					<div class="flex flex-wrap gap-2">
						{#each listing.tags as tag}
							<Badge variant="outline">#{tag}</Badge>
						{/each}
					</div>
				{/if}

				<!-- Posted date -->
				<p class="text-xs text-muted-foreground">
					Listed {formatRelativeTime(listing.created_at)}
				</p>
			</CardContent>

			<CardFooter class="gap-2">
				<Button
					variant="outline"
					class="flex-1"
					onclick={() => marketplaceStore.selectListing(null)}
				>
					Close
				</Button>
				<Button
					variant="glow"
					class="flex-1"
					onclick={() => { handleContact(listing); marketplaceStore.selectListing(null); }}
				>
					<MessageCircle class="h-4 w-4 mr-2" />
					Contact Seller
				</Button>
			</CardFooter>
		</Card>
	</div>
{/if}

<!-- Create Listing Modal (simplified for now) -->
{#if showCreateModal}
	<div
		class="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
		onclick={() => showCreateModal = false}
		onkeydown={(e) => e.key === 'Escape' && (showCreateModal = false)}
		role="button"
		tabindex="0"
	>
		<Card
			class="w-full max-w-md bg-card"
			onclick={(e) => e.stopPropagation()}
		>
			<CardHeader>
				<h2 class="text-xl font-bold flex items-center gap-2">
					<Package class="h-5 w-5" />
					Create Listing
				</h2>
			</CardHeader>
			<CardContent>
				<p class="text-muted-foreground">
					Listing creation feature coming soon! For now, you can create listings using other Nostr marketplace clients that support NIP-15.
				</p>
			</CardContent>
			<CardFooter>
				<Button variant="outline" class="w-full" onclick={() => showCreateModal = false}>
					Close
				</Button>
			</CardFooter>
		</Card>
	</div>
{/if}
