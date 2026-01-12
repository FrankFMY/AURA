<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { get } from 'svelte/store';
	import ndkService from '$services/ndk';
	import { dbHelpers, type UserProfile } from '$db';
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import { validatePubkey } from '$lib/validators/schemas';
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

	type SearchTab = 'notes' | 'users' | 'hashtags';

	let query = $state('');
	let activeTab = $state<SearchTab>('notes');
	let isSearching = $state(false);
	let noteResults = $state<NDKEvent[]>([]);
	let userResults = $state<UserProfile[]>([]);
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

	// Get query from URL if present
	onMount(() => {
		const urlQuery = get(page).url.searchParams.get('q');
		if (urlQuery) {
			query = urlQuery;
			handleSearch();
		}
	});

	async function handleSearch() {
		if (!query.trim()) return;

		isSearching = true;
		noteResults = [];
		userResults = [];

		try {
			// Search notes
			if (activeTab === 'notes' || activeTab === 'hashtags') {
				const filter = {
					kinds: [1],
					search: query,
					limit: 30,
				};

				const events = await ndkService.ndk.fetchEvents(filter);
				noteResults = Array.from(events).sort(
					(a, b) => (b.created_at || 0) - (a.created_at || 0),
				);
			}

			// Search users
			if (activeTab === 'users') {
				// Check if query is an npub or hex pubkey - direct lookup
				const directPubkey = validatePubkey(query.trim());
				if (directPubkey) {
					// Direct profile lookup by pubkey
					try {
						await ndkService.fetchProfile(directPubkey);
						const profile =
							await dbHelpers.getProfile(directPubkey);
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
						// Still show the pubkey even if lookup fails
						userResults = [
							{
								pubkey: directPubkey,
								updated_at: Date.now(),
							},
						];
					}
				} else {
					// Text search for profiles - requires NIP-50 compatible relay
					const filter = {
						kinds: [0],
						search: query,
						limit: 20,
					};

					const events = await ndkService.ndk.fetchEvents(filter);

					for (const event of events) {
						try {
							const profile = JSON.parse(event.content);
							userResults = [
								...userResults,
								{
									pubkey: event.pubkey,
									...profile,
									updated_at: Date.now(),
								},
							];
						} catch {
							// Invalid profile JSON
						}
					}
				}
			}
		} catch (e) {
			console.error('Search failed:', e);
		} finally {
			isSearching = false;
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
</script>

<svelte:head>
	<title>Search | AURA</title>
</svelte:head>

<div class="min-h-screen pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
	<header
		class="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur"
	>
		<div class="p-4">
			<div class="relative">
				<Search
					class="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={query}
					placeholder="Search notes, users, or hashtags..."
					class="pl-10 pr-20"
					onkeydown={handleKeydown}
				/>
				<Button
					variant="ghost"
					size="sm"
					class="absolute right-1 top-1/2 -translate-y-1/2"
					onclick={handleSearch}
					disabled={!query.trim() || isSearching}
				>
					Search
				</Button>
			</div>
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
		{:else if activeTab === 'notes'}
			<!-- Note results -->
			{#if noteResults.length === 0}
				<EmptyState
					icon={SearchX}
					title="No notes found"
					description={`No notes found for "${query}". Try different keywords or check trending hashtags.`}
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
			{#if userResults.length === 0}
				<EmptyState
					icon={User}
					title="No users found"
					description={`No users found for "${query}". Try searching by name or npub.`}
					variant="muted"
					size="md"
				/>
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
