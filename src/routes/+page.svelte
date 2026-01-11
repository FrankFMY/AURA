<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$stores/auth.svelte';
	import { feedStore } from '$stores/feed.svelte';
	import NoteCard from '$components/feed/NoteCard.svelte';
	import CreateNote from '$components/feed/CreateNote.svelte';
	import NoteSkeleton from '$components/feed/NoteSkeleton.svelte';
	import { Button } from '$components/ui/button';
	import { Spinner } from '$components/ui/spinner';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import TrendingUp from 'lucide-svelte/icons/trending-up';
	import Users from 'lucide-svelte/icons/users';
	import Globe from 'lucide-svelte/icons/globe';

	let feedTab = $state<'global' | 'following'>('global');
	let feedContainer: HTMLElement;

	onMount(() => {
		feedStore.load('global');
	});

	onDestroy(() => {
		feedStore.cleanup();
	});

	async function handleRefresh() {
		await feedStore.refresh();
	}

	async function handleTabChange(tab: 'global' | 'following') {
		feedTab = tab;
		await feedStore.load(tab);
	}

	// Infinite scroll
	function handleScroll() {
		if (!feedContainer) return;

		const { scrollTop, scrollHeight, clientHeight } = feedContainer;
		if (
			scrollHeight - scrollTop - clientHeight < 500 &&
			!feedStore.isLoading &&
			feedStore.hasMore
		) {
			feedStore.loadMore();
		}
	}
</script>

<svelte:head>
	<title>Feed | AURA</title>
</svelte:head>

<div class="flex h-screen flex-col pb-16 md:pb-0">
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
	<div
		bind:this={feedContainer}
		class="flex-1 overflow-y-auto"
		onscroll={handleScroll}
	>
		{#if feedStore.error}
			<div class="p-8 text-center">
				<p class="text-destructive">{feedStore.error}</p>
				<Button
					variant="outline"
					class="mt-4"
					onclick={handleRefresh}
				>
					Try again
				</Button>
			</div>
		{:else if feedStore.events.length === 0 && feedStore.isLoading}
			<!-- Loading skeletons -->
			{#each Array(5) as _}
				<NoteSkeleton />
			{/each}
		{:else if feedStore.events.length === 0}
			<div class="p-8 text-center">
				<TrendingUp class="mx-auto h-12 w-12 text-muted-foreground" />
				<h3 class="mt-4 text-lg font-medium">No posts yet</h3>
				<p class="mt-2 text-muted-foreground">
					{#if authStore.isAuthenticated}
						Be the first to post something!
					{:else}
						Login to see personalized content
					{/if}
				</p>
			</div>
		{:else}
			{#each feedStore.events as feedEvent (feedEvent.event.id)}
				<NoteCard
					event={feedEvent.event}
					author={feedEvent.author}
					replyCount={feedEvent.replyCount}
					reactionCount={feedEvent.reactionCount}
					repostCount={feedEvent.repostCount}
					hasReacted={feedEvent.hasReacted}
					hasReposted={feedEvent.hasReposted}
				/>
			{/each}

			<!-- Load more indicator -->
			{#if feedStore.isLoading}
				<div class="flex items-center justify-center p-4">
					<Spinner />
				</div>
			{:else if !feedStore.hasMore}
				<div class="p-8 text-center text-muted-foreground">
					You've reached the end
				</div>
			{/if}
		{/if}
	</div>
</div>
