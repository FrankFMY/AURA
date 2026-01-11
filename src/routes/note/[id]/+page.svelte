<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { browser } from '$app/environment';
	import { authStore } from '$stores/auth.svelte';
	import ndkService from '$services/ndk';
	import { dbHelpers, type UserProfile } from '$db';
	import type { NDKEvent, NDKFilter } from '@nostr-dev-kit/ndk';
	import NoteCard from '$components/feed/NoteCard.svelte';
	import CreateNote from '$components/feed/CreateNote.svelte';
	import NoteSkeleton from '$components/feed/NoteSkeleton.svelte';
	import { Button } from '$components/ui/button';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { truncatePubkey, formatRelativeTime } from '$lib/utils';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import MessageCircle from 'lucide-svelte/icons/message-circle';

	let note = $state<NDKEvent | null>(null);
	let author = $state<UserProfile | null>(null);
	let parentNote = $state<NDKEvent | null>(null);
	let parentAuthor = $state<UserProfile | null>(null);
	let replies = $state<{ event: NDKEvent; author: UserProfile | null }[]>([]);
	let isLoading = $state(true);
	let isLoadingReplies = $state(true);
	let showReplyComposer = $state(false);

	const noteId = $derived($page.params.id ?? '');

	// OG Meta tags
	const ogTitle = $derived(
		author?.display_name || author?.name ?
			`${author.display_name || author.name} on AURA`
		:	'Note on AURA',
	);
	const ogDescription = $derived(
		note?.content ?
			note.content.slice(0, 200) +
				(note.content.length > 200 ? '...' : '')
		:	'A decentralized social post on AURA',
	);
	const ogImage = $derived(author?.picture || '/icon-192.svg');
	const canonicalUrl = $derived(
		browser ?
			`${window.location.origin}/note/${noteId}`
		:	`/note/${noteId}`,
	);

	// Profile cache
	const profileCache = new Map<string, UserProfile>();

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
		ndkService
			.fetchProfile(pubkey)
			.then(async () => {
				const profile = await dbHelpers.getProfile(pubkey);
				if (profile) {
					profileCache.set(pubkey, profile);
					// Update state if this is the main author
					if (note?.pubkey === pubkey) {
						author = profile;
					}
					// Update replies
					replies = replies.map((r) =>
						r.event.pubkey === pubkey ?
							{ ...r, author: profile }
						:	r,
					);
				}
			})
			.catch(console.error);

		return null;
	}

	onMount(async () => {
		if (!noteId) return;

		isLoading = true;

		try {
			// Fetch the note
			const filter: NDKFilter = {
				ids: [noteId],
				limit: 1,
			};
			const events = await ndkService.ndk.fetchEvents(filter);
			const foundNote = Array.from(events)[0];

			if (foundNote) {
				note = foundNote;
				author = await getProfile(foundNote.pubkey);

				// Check for parent note (if this is a reply)
				const replyTag = foundNote.tags.find(
					(t) =>
						t[0] === 'e' && (t[3] === 'reply' || t[3] === 'root'),
				);
				if (replyTag) {
					const parentFilter: NDKFilter = {
						ids: [replyTag[1]],
						limit: 1,
					};
					const parentEvents =
						await ndkService.ndk.fetchEvents(parentFilter);
					parentNote = Array.from(parentEvents)[0] || null;
					if (parentNote) {
						parentAuthor = await getProfile(parentNote.pubkey);
					}
				}
			}
		} catch (e) {
			console.error('Failed to fetch note:', e);
		} finally {
			isLoading = false;
		}

		// Fetch replies
		isLoadingReplies = true;
		try {
			const repliesFilter: NDKFilter = {
				kinds: [1],
				'#e': [noteId],
				limit: 50,
			};
			const replyEvents = await ndkService.ndk.fetchEvents(repliesFilter);

			const repliesWithAuthors = await Promise.all(
				Array.from(replyEvents)
					.sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
					.map(async (event) => ({
						event,
						author: await getProfile(event.pubkey),
					})),
			);

			replies = repliesWithAuthors;
		} catch (e) {
			console.error('Failed to fetch replies:', e);
		} finally {
			isLoadingReplies = false;
		}
	});

	function handleReplySuccess() {
		showReplyComposer = false;
		// Refresh replies
		// In a real app, the new reply would come via subscription
	}
</script>

<svelte:head>
	<title>{ogTitle} | AURA</title>
	<meta
		name="description"
		content={ogDescription}
	/>

	<!-- Open Graph -->
	<meta
		property="og:type"
		content="article"
	/>
	<meta
		property="og:title"
		content={ogTitle}
	/>
	<meta
		property="og:description"
		content={ogDescription}
	/>
	<meta
		property="og:image"
		content={ogImage}
	/>
	<meta
		property="og:url"
		content={canonicalUrl}
	/>
	<meta
		property="og:site_name"
		content="AURA"
	/>

	<!-- Twitter Card -->
	<meta
		name="twitter:card"
		content="summary"
	/>
	<meta
		name="twitter:title"
		content={ogTitle}
	/>
	<meta
		name="twitter:description"
		content={ogDescription}
	/>
	<meta
		name="twitter:image"
		content={ogImage}
	/>

	<!-- Canonical URL -->
	<link
		rel="canonical"
		href={canonicalUrl}
	/>
</svelte:head>

<div class="min-h-screen pb-16 md:pb-0">
	<!-- Header -->
	<header
		class="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur"
	>
		<div class="flex h-14 items-center gap-4 px-4">
			<Button
				variant="ghost"
				size="icon"
				onclick={() => history.back()}
			>
				<ArrowLeft class="h-5 w-5" />
			</Button>
			<h1 class="text-xl font-bold">Thread</h1>
		</div>
	</header>

	<div class="mx-auto max-w-2xl">
		{#if isLoading}
			<NoteSkeleton />
		{:else if !note}
			<div class="p-8 text-center">
				<p class="text-muted-foreground">Note not found</p>
			</div>
		{:else}
			<!-- Parent note (if this is a reply) -->
			{#if parentNote}
				<div class="border-b border-border bg-muted/30">
					<div class="p-4">
						<div
							class="flex items-center gap-2 mb-2 text-sm text-muted-foreground"
						>
							<ArrowLeft class="h-4 w-4 rotate-90" />
							<span>Replying to</span>
						</div>
						<a
							href="/note/{parentNote.id}"
							class="flex gap-3 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors"
						>
							<Avatar size="sm">
								<AvatarImage src={parentAuthor?.picture} />
								<AvatarFallback>
									{(
										parentAuthor?.display_name ||
										parentAuthor?.name ||
										'A'
									)
										.slice(0, 2)
										.toUpperCase()}
								</AvatarFallback>
							</Avatar>
							<div class="min-w-0 flex-1">
								<p class="text-sm font-medium">
									{parentAuthor?.display_name ||
										parentAuthor?.name ||
										truncatePubkey(parentNote.pubkey)}
								</p>
								<p
									class="text-sm text-muted-foreground line-clamp-2"
								>
									{parentNote.content.slice(0, 150)}{(
										parentNote.content.length > 150
									) ?
										'...'
									:	''}
								</p>
							</div>
						</a>
					</div>
				</div>
			{/if}

			<!-- Main note (expanded view) -->
			<div class="border-b border-border p-4">
				<div class="flex gap-3 mb-4">
					<a href="/profile/{note.pubkey}">
						<Avatar size="lg">
							<AvatarImage src={author?.picture} />
							<AvatarFallback>
								{(author?.display_name || author?.name || 'A')
									.slice(0, 2)
									.toUpperCase()}
							</AvatarFallback>
						</Avatar>
					</a>
					<div>
						<a
							href="/profile/{note.pubkey}"
							class="font-semibold hover:underline"
						>
							{author?.display_name ||
								author?.name ||
								truncatePubkey(note.pubkey)}
						</a>
						{#if author?.nip05}
							<span class="text-xs text-accent ml-1">✓</span>
						{/if}
						<p class="text-sm text-muted-foreground">
							@{author?.name || truncatePubkey(note.pubkey, 8)}
						</p>
					</div>
				</div>

				<!-- Content (larger text for main note) -->
				<div class="text-lg whitespace-pre-wrap wrap-break-words mb-4">
					{note.content}
				</div>

				<!-- Timestamp -->
				<div
					class="flex items-center gap-2 text-sm text-muted-foreground border-t border-border pt-4"
				>
					<time
						datetime={new Date(
							(note.created_at || 0) * 1000,
						).toISOString()}
					>
						{new Date(
							(note.created_at || 0) * 1000,
						).toLocaleString()}
					</time>
				</div>

				<!-- Stats -->
				<div
					class="flex gap-6 border-t border-border mt-4 pt-4 text-sm"
				>
					<div>
						<span class="font-semibold">{replies.length}</span>
						<span class="text-muted-foreground"> Replies</span>
					</div>
				</div>

				<!-- Reply button -->
				{#if authStore.isAuthenticated}
					<div class="mt-4">
						<Button
							variant="outline"
							class="w-full"
							onclick={() =>
								(showReplyComposer = !showReplyComposer)}
						>
							<MessageCircle class="mr-2 h-4 w-4" />
							Reply
						</Button>
					</div>
				{/if}
			</div>

			<!-- Reply composer -->
			{#if showReplyComposer && note}
				<CreateNote
					replyTo={note}
					onSuccess={handleReplySuccess}
					placeholder="Post your reply..."
				/>
			{/if}

			<!-- Replies -->
			<div>
				<div class="px-4 py-3 border-b border-border">
					<h2 class="font-semibold">Replies</h2>
				</div>

				{#if isLoadingReplies}
					{#each Array(3) as _}
						<NoteSkeleton />
					{/each}
				{:else if replies.length === 0}
					<div class="p-8 text-center text-muted-foreground">
						<MessageCircle class="mx-auto h-12 w-12 mb-4" />
						<p>No replies yet</p>
						{#if authStore.isAuthenticated}
							<p class="text-sm mt-2">Be the first to reply!</p>
						{/if}
					</div>
				{:else}
					{#each replies as reply (reply.event.id)}
						<div class="relative">
							<!-- Thread line -->
							<div
								class="absolute left-7 top-0 bottom-0 w-0.5 bg-border"
							></div>
							<NoteCard
								event={reply.event}
								author={reply.author}
								replyCount={0}
								reactionCount={0}
								repostCount={0}
							/>
						</div>
					{/each}
				{/if}
			</div>
		{/if}
	</div>
</div>
