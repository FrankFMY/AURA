<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$stores/auth.svelte';
	import { feedStore } from '$stores/feed.svelte';
	import { uiStore } from '$stores/ui.svelte';
	import NoteCard from '$components/feed/NoteCard.svelte';
	import CreateNote from '$components/feed/CreateNote.svelte';
	import NoteSkeleton from '$components/feed/NoteSkeleton.svelte';
	import { VirtualList } from '$components/ui/virtual-list';
	import { EmptyState } from '$components/ui/empty-state';
	import { ScrollToTop } from '$components/ui/scroll-to-top';
	import { Button } from '$components/ui/button';
	import { Spinner } from '$components/ui/spinner';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import TrendingUp from 'lucide-svelte/icons/trending-up';
	import Users from 'lucide-svelte/icons/users';
	import Globe from 'lucide-svelte/icons/globe';
	import UserPlus from 'lucide-svelte/icons/user-plus';
	import LogIn from 'lucide-svelte/icons/log-in';

	let feedTab = $state<'global' | 'following'>('global');
	let virtualList: ReturnType<typeof VirtualList> | undefined = $state();
	let showScrollTop = $state(false);
	let scrollPosition = $state(0);
	let lastScrollPos = 0;

	// Estimated height for note cards (will vary, but this is average)
	const ESTIMATED_NOTE_HEIGHT = 180;

	onMount(() => {
		feedStore.load('global');
	});

	onDestroy(() => {
		feedStore.cleanup();
		// Ensure nav is visible when leaving
		uiStore.setBottomNavVisible(true);
	});

	async function handleRefresh() {
		await feedStore.refresh();
		virtualList?.scrollToTop();
	}

	async function handleTabChange(tab: 'global' | 'following') {
		feedTab = tab;
		await feedStore.load(tab);
		virtualList?.scrollToTop('instant');
	}

	function handleEndReached() {
		if (!feedStore.isLoading && feedStore.hasMore) {
			feedStore.loadMore();
		}
	}

	function handleScrollToTop() {
		virtualList?.scrollToTop();
	}

	function handleScroll(pos: number) {
		scrollPosition = pos;

		if (pos <= 0) {
			uiStore.setBottomNavVisible(true);
			lastScrollPos = pos;
			return;
		}

		if (pos > lastScrollPos && pos > 50) {
			uiStore.setBottomNavVisible(false);
		} else {
			uiStore.setBottomNavVisible(true);
		}
		lastScrollPos = pos;
	}

	// Track scroll position for scroll-to-top button visibility
	$effect(() => {
		showScrollTop = scrollPosition > 500;
	});
</script>

<svelte:head>
	<title>Feed | AURA</title>
</svelte:head>

<div
	class="flex h-screen flex-col pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0"
>
	<!-- Header -->
	<header
		class="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60"
	>
		<div class="flex h-14 items-center justify-between px-4">
			<h1 class="text-xl font-bold">Feed</h1>
			<Button
				variant="ghost"
				size="icon"
				onclick={handleRefresh}
				disabled={feedStore.isLoading}
			>
				<RefreshCw
					class="h-5 w-5 {feedStore.isLoading ? 'animate-spin' : ''}"
				/>
			</Button>
		</div>

		<!-- Feed tabs -->
		{#if authStore.isAuthenticated}
			<div class="flex border-b border-border">
				<button
					class="flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors
						{feedTab === 'global' ?
						'border-b-2 border-primary text-primary'
					:	'text-muted-foreground hover:text-foreground'}"
					onclick={() => handleTabChange('global')}
				>
					<Globe class="h-4 w-4" />
					Global
				</button>
				<button
					class="flex flex-1 items-center justify-center gap-2 py-3 text-sm font-medium transition-colors
						{feedTab === 'following' ?
						'border-b-2 border-primary text-primary'
					:	'text-muted-foreground hover:text-foreground'}"
					onclick={() => handleTabChange('following')}
				>
					<Users class="h-4 w-4" />
					Following
				</button>
			</div>
		{/if}
	</header>

	<!-- Create note (if authenticated) -->
	{#if authStore.isAuthenticated}
		<CreateNote />
	{/if}

	<!-- Feed -->
	<div class="flex-1 overflow-hidden relative">
		{#if feedStore.error}
			<div class="p-8 text-center animate-fade-in">
				<div
					class="inline-flex items-center justify-center w-16 h-16 rounded-full bg-destructive/10 mb-4"
				>
					<TrendingUp class="h-8 w-8 text-destructive" />
				</div>
				<p class="text-destructive font-medium">{feedStore.error}</p>
				<Button
					variant="outline"
					class="mt-4 hover-glow-primary"
					onclick={handleRefresh}
				>
					<RefreshCw class="h-4 w-4 mr-2" />
					Try again
				</Button>
			</div>
		{:else if feedStore.events.length === 0 && feedStore.isLoading}
			<!-- Loading skeletons with stagger animation -->
			<div class="animate-fade-in">
				{#each Array(5) as _, i}
					<div class="stagger-{i + 1}">
						<NoteSkeleton />
					</div>
				{/each}
			</div>
		{:else if feedStore.events.length === 0}
			{#if feedTab === 'following'}
				<EmptyState
					icon={UserPlus}
					title="No posts from people you follow"
					description="Follow some users to see their posts here! Discover interesting people in the Global feed."
					variant="accent"
					size="lg"
					actionLabel="Explore Global"
					onAction={() => handleTabChange('global')}
				/>
			{:else if authStore.isAuthenticated}
				<EmptyState
					icon={TrendingUp}
					title="No posts yet"
					description="Be the first to post something! Share your thoughts with the Nostr community."
					variant="default"
					size="lg"
				/>
			{:else}
				<EmptyState
					icon={LogIn}
					title="Welcome to AURA"
					description="Login to see personalized content and connect with the decentralized social network."
					variant="default"
					size="lg"
				/>
			{/if}
		{:else}
			<!-- Virtualized feed list -->
			<VirtualList
				bind:this={virtualList}
				items={feedStore.events}
				itemHeight={ESTIMATED_NOTE_HEIGHT}
				overscan={3}
				height="100%"
				onEndReached={handleEndReached}
				endReachedThreshold={400}
				getKey={(item) => item.event.id}
				onScroll={handleScroll}
				class="h-full"
			>
				{#snippet children({ item: feedEvent })}
					<NoteCard
						event={feedEvent.event}
						author={feedEvent.author}
						replyCount={feedEvent.replyCount}
						reactionCount={feedEvent.reactionCount}
						repostCount={feedEvent.repostCount}
						hasReacted={feedEvent.hasReacted}
						hasReposted={feedEvent.hasReposted}
					/>
				{/snippet}
			</VirtualList>

			<!-- Load more indicator (overlay at bottom) -->
			{#if feedStore.isLoading}
				<div
					class="absolute bottom-0 left-0 right-0 flex items-center justify-center p-4 bg-linear-to-t from-background via-background/80 to-transparent"
				>
					<div
						class="flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border shadow-lg"
					>
						<Spinner size="sm" />
						<span class="text-sm text-muted-foreground"
							>Loading more...</span
						>
					</div>
				</div>
			{:else if !feedStore.hasMore && feedStore.events.length > 0}
				<div
					class="absolute bottom-0 left-0 right-0 p-6 text-center bg-linear-to-t from-background to-transparent"
				>
					<span class="text-sm text-muted-foreground"
						>You've reached the end</span
					>
				</div>
			{/if}
		{/if}

		<!-- Scroll to top button -->
		<ScrollToTop
			show={showScrollTop}
			onClick={handleScrollToTop}
			bottom="6rem"
		/>
	</div>
</div>
