<script lang="ts">
	import { onMount } from 'svelte';
	import { bookmarksStore } from '$stores/bookmarks.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Spinner } from '$components/ui/spinner';
	import { BookmarkButton } from '$components/bookmarks';
	import MediaEmbed from '$lib/components/feed/MediaEmbed.svelte';
	import { formatRelativeTime, truncatePubkey } from '$lib/utils';
	import { parseNoteContent } from '$lib/validators/sanitize';
	import { VerifiedBadge } from '$components/verified';
	import Bookmark from 'lucide-svelte/icons/bookmark';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import { _ } from '$lib/i18n';

	let isRefreshing = $state(false);

	onMount(async () => {
		if (!authStore.isAuthenticated) {
			goto('/login');
			return;
		}
		await bookmarksStore.load();
	});

	async function handleRefresh() {
		isRefreshing = true;
		try {
			await bookmarksStore.load();
		} finally {
			isRefreshing = false;
		}
	}

	function extractMediaUrls(content: string): string[] {
		const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
		const urls = content.match(urlRegex) || [];

		return urls.filter((url) => {
			const lower = url.toLowerCase();
			return (
				/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(lower) ||
				/\.(mp4|webm|mov)(\?.*)?$/i.test(lower) ||
				lower.includes('youtube.com/watch') ||
				lower.includes('youtu.be/') ||
				lower.includes('nostr.build') ||
				lower.includes('void.cat')
			);
		});
	}
</script>

<svelte:head>
	<title>{$_('features.bookmarks.title')} - AURA</title>
</svelte:head>

<div class="mx-auto max-w-2xl">
	<!-- Header -->
	<header class="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-sm">
		<div class="flex items-center gap-3 p-4">
			<Button
				variant="ghost"
				size="icon"
				class="md:hidden"
				onclick={() => history.back()}
				aria-label="Go back"
			>
				<ArrowLeft class="h-5 w-5" />
			</Button>

			<div class="flex items-center gap-2 flex-1">
				<Bookmark class="h-5 w-5 text-amber-500" />
				<h1 class="text-xl font-bold">{$_('features.bookmarks.title')}</h1>
				{#if bookmarksStore.count > 0}
					<span class="text-sm text-muted-foreground">
						({bookmarksStore.count})
					</span>
				{/if}
			</div>

			<Button
				variant="ghost"
				size="icon"
				onclick={handleRefresh}
				disabled={isRefreshing || bookmarksStore.isLoading}
				aria-label="Refresh bookmarks"
			>
				<RefreshCw class="h-4 w-4 {isRefreshing ? 'animate-spin' : ''}" />
			</Button>
		</div>
	</header>

	<!-- Content -->
	<main>
		{#if bookmarksStore.isLoading}
			<div class="flex items-center justify-center p-12">
				<Spinner size="lg" />
			</div>
		{:else if bookmarksStore.error}
			<div class="p-8 text-center">
				<p class="text-destructive mb-4">{bookmarksStore.error}</p>
				<Button variant="outline" onclick={handleRefresh}>
					{$_('common.retry')}
				</Button>
			</div>
		{:else if bookmarksStore.bookmarkedEvents.length === 0}
			<div class="flex flex-col items-center justify-center p-12 text-center">
				<Bookmark class="h-16 w-16 text-muted-foreground/30 mb-4" />
				<h2 class="text-lg font-medium text-muted-foreground mb-2">
					{$_('features.bookmarks.empty')}
				</h2>
				<p class="text-sm text-muted-foreground max-w-xs">
					Save notes you want to revisit later by clicking the bookmark icon.
				</p>
			</div>
		{:else}
			<div class="divide-y divide-border">
				{#each bookmarksStore.bookmarkedEvents as { event, author, bookmark } (bookmark.eventId)}
					{@const parsedContent = parseNoteContent(event.content)}
					{@const mediaUrls = extractMediaUrls(event.content)}
					{@const displayName = author?.display_name || author?.name || truncatePubkey(event.pubkey)}
					{@const avatarInitials = (displayName).slice(0, 2).toUpperCase()}

					<article
						class="group p-4 transition-colors hover:bg-card/60"
						aria-label="Bookmarked note by {displayName}"
					>
						<div class="flex gap-3">
							<!-- Avatar -->
							<a
								href="/profile/{event.pubkey}"
								class="shrink-0"
							>
								<Avatar size="md">
									<AvatarImage src={author?.picture} alt="" />
									<AvatarFallback>{avatarInitials}</AvatarFallback>
								</Avatar>
							</a>

							<div class="min-w-0 flex-1">
								<!-- Header -->
								<div class="mb-1 flex items-center gap-2">
									<a
										href="/profile/{event.pubkey}"
										class="font-semibold text-foreground hover:underline"
									>
										{displayName}
									</a>
									{#if author?.nip05}
										<VerifiedBadge nip05={author.nip05} pubkey={event.pubkey} size="sm" />
									{/if}
									<span class="text-muted-foreground">·</span>
									<time
										class="text-sm text-muted-foreground"
										datetime={new Date((event.created_at || 0) * 1000).toISOString()}
									>
										{formatRelativeTime(event.created_at || 0)}
									</time>
								</div>

								<!-- Content -->
								<a href="/note/{event.id}" class="block">
									<div class="mb-3 wrap-break-words text-foreground note-content">
										{@html parsedContent.html}
									</div>

									{#if mediaUrls.length > 0}
										<div class="mb-3 grid gap-2 {mediaUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'}">
											{#each mediaUrls.slice(0, 2) as mediaUrl (mediaUrl)}
												<MediaEmbed url={mediaUrl} />
											{/each}
										</div>
									{/if}
								</a>

								<!-- Actions -->
								<div class="flex items-center justify-between">
									<span class="text-xs text-muted-foreground">
										Saved {formatRelativeTime(bookmark.addedAt)}
									</span>
									<BookmarkButton eventId={event.id} />
								</div>
							</div>
						</div>
					</article>
				{/each}
			</div>
		{/if}

		{#if bookmarksStore.isSyncing}
			<div class="fixed bottom-20 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-full bg-background/95 px-4 py-2 shadow-lg border border-border backdrop-blur-sm">
				<Spinner size="sm" />
				<span class="text-sm text-muted-foreground">Syncing...</span>
			</div>
		{/if}
	</main>
</div>

<style>
	:global(.note-content a) {
		word-break: break-all;
		color: var(--accent);
		text-decoration: none;
	}

	:global(.note-content a:hover) {
		text-decoration: underline;
	}
</style>
