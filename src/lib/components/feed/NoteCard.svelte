<script lang="ts">
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import type { UserProfile } from '$db';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { formatRelativeTime, truncatePubkey } from '$lib/utils';
	import { parseNoteContent, sanitizeUrl } from '$lib/validators/sanitize';
	import { feedStore } from '$stores/feed.svelte';
	import { walletStore } from '$stores/wallet.svelte';
	import Heart from 'lucide-svelte/icons/heart';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Repeat2 from 'lucide-svelte/icons/repeat-2';
	import Zap from 'lucide-svelte/icons/zap';
	import Share from 'lucide-svelte/icons/share';
	import ImageOff from 'lucide-svelte/icons/image-off';

	interface Props {
		event: NDKEvent;
		author: UserProfile | null;
		replyCount?: number;
		reactionCount?: number;
		repostCount?: number;
		hasReacted?: boolean;
		hasReposted?: boolean;
		onReply?: () => void;
	}

	let {
		event,
		author,
		replyCount = 0,
		reactionCount = 0,
		repostCount = 0,
		hasReacted = false,
		hasReposted = false,
		onReply,
	}: Props = $props();

	let isReacting = $state(false);
	let isReposting = $state(false);
	let isZapping = $state(false);
	let imageErrors = $state<Set<string>>(new Set());

	// Parse content safely using DOMPurify-based sanitization
	const parsedContent = $derived(parseNoteContent(event.content));
	const safeHtml = $derived(parsedContent.html);
	const imageUrls = $derived(
		parsedContent.imageUrls
			.map(sanitizeUrl)
			.filter((url) => url && !imageErrors.has(url)),
	);

	const displayName = $derived(
		author?.display_name || author?.name || truncatePubkey(event.pubkey),
	);

	const avatarInitials = $derived(
		(author?.display_name || author?.name || 'A').slice(0, 2).toUpperCase(),
	);

	function handleImageError(url: string) {
		imageErrors = new Set([...imageErrors, url]);
	}

	async function handleReact() {
		if (isReacting || hasReacted) return;
		isReacting = true;
		try {
			await feedStore.react(event);
		} finally {
			isReacting = false;
		}
	}

	async function handleRepost() {
		if (isReposting || hasReposted) return;
		isReposting = true;
		try {
			await feedStore.repost(event);
		} finally {
			isReposting = false;
		}
	}

	async function handleZap() {
		if (!walletStore.isConnected) {
			// Could show a modal to connect wallet
			alert('Please connect a wallet first in Settings');
			return;
		}

		isZapping = true;
		try {
			await walletStore.zapNote(event, 21); // Default 21 sats
		} catch (e) {
			console.error('Zap failed:', e);
		} finally {
			isZapping = false;
		}
	}

	async function handleShare() {
		const noteUrl = `${window.location.origin}/note/${event.id}`;
		try {
			if (navigator.share) {
				await navigator.share({
					url: noteUrl,
					title: `Note by ${displayName}`,
				});
			} else {
				await navigator.clipboard.writeText(noteUrl);
			}
		} catch (e) {
			// User cancelled or clipboard failed
			console.debug('Share failed:', e);
		}
	}
</script>

<article
	class="group border-b border-border p-4 transition-colors hover:bg-card/50"
	aria-label="Note by {displayName}"
>
	<div class="flex gap-3">
		<!-- Avatar -->
		<a
			href="/profile/{event.pubkey}"
			class="shrink-0"
			aria-label="View {displayName}'s profile"
		>
			<Avatar size="md">
				<AvatarImage
					src={author?.picture}
					alt=""
				/>
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
					<span
						class="text-xs text-accent"
						title="Verified: {author.nip05}"
						aria-label="Verified user"
					>
						✓
					</span>
				{/if}
				<span
					class="text-muted-foreground"
					aria-hidden="true">·</span
				>
				<time
					class="text-sm text-muted-foreground"
					datetime={new Date(
						(event.created_at || 0) * 1000,
					).toISOString()}
				>
					{formatRelativeTime(event.created_at || 0)}
				</time>
			</div>

			<!-- Content - Safely sanitized HTML -->
			<div
				class="mb-3 whitespace-pre-wrap wrap-break-word text-foreground note-content"
			>
				{@html safeHtml}
			</div>

			<!-- Images with error handling -->
			{#if imageUrls.length > 0}
				<div
					class="mb-3 grid gap-2 {imageUrls.length > 1 ?
						'grid-cols-2'
					:	'grid-cols-1'}"
				>
					{#each imageUrls.slice(0, 4) as imageUrl (imageUrl)}
						<a
							href={imageUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="relative block overflow-hidden rounded-lg bg-muted"
						>
							<img
								src={imageUrl}
								alt=""
								class="max-h-80 w-full rounded-lg object-cover transition-opacity hover:opacity-90"
								loading="lazy"
								decoding="async"
								onerror={() => handleImageError(imageUrl)}
							/>
						</a>
					{/each}
					{#if imageUrls.length > 4}
						<div
							class="flex items-center justify-center rounded-lg bg-muted text-muted-foreground"
						>
							+{imageUrls.length - 4} more
						</div>
					{/if}
				</div>
			{/if}

			<!-- Broken image indicators -->
			{#if imageErrors.size > 0}
				<div
					class="mb-3 flex items-center gap-2 text-xs text-muted-foreground"
				>
					<ImageOff class="h-3 w-3" />
					<span
						>{imageErrors.size} image{imageErrors.size > 1 ?
							's'
						:	''} failed to load</span
					>
				</div>
			{/if}

			<!-- Actions -->
			<div
				class="flex items-center justify-between text-muted-foreground"
				role="group"
				aria-label="Note actions"
			>
				<Button
					variant="ghost"
					size="sm"
					class="gap-1.5 hover:text-primary"
					onclick={onReply}
					aria-label="Reply to note{replyCount > 0 ?
						`, ${replyCount} replies`
					:	''}"
				>
					<MessageCircle class="h-4 w-4" />
					{#if replyCount > 0}
						<span class="text-xs">{replyCount}</span>
					{/if}
				</Button>

				<Button
					variant="ghost"
					size="sm"
					class="gap-1.5 hover:text-success {hasReposted ?
						'text-success'
					:	''}"
					onclick={handleRepost}
					disabled={isReposting}
					aria-label="{hasReposted ? 'Reposted' : 'Repost'}{(
						repostCount > 0
					) ?
						`, ${repostCount} reposts`
					:	''}"
					aria-pressed={hasReposted}
				>
					<Repeat2 class="h-4 w-4" />
					{#if repostCount > 0}
						<span class="text-xs">{repostCount}</span>
					{/if}
				</Button>

				<Button
					variant="ghost"
					size="sm"
					class="gap-1.5 hover:text-destructive {hasReacted ?
						'text-destructive'
					:	''}"
					onclick={handleReact}
					disabled={isReacting}
					aria-label="{hasReacted ? 'Liked' : 'Like'}{(
						reactionCount > 0
					) ?
						`, ${reactionCount} likes`
					:	''}"
					aria-pressed={hasReacted}
				>
					<Heart class="h-4 w-4 {hasReacted ? 'fill-current' : ''}" />
					{#if reactionCount > 0}
						<span class="text-xs">{reactionCount}</span>
					{/if}
				</Button>

				<Button
					variant="ghost"
					size="sm"
					class="gap-1.5 hover:text-warning"
					onclick={handleZap}
					disabled={isZapping}
					aria-label="Send zap"
				>
					<Zap class="h-4 w-4 {isZapping ? 'animate-pulse' : ''}" />
				</Button>

				<Button
					variant="ghost"
					size="sm"
					class="hover:text-accent"
					onclick={handleShare}
					aria-label="Share note"
				>
					<Share class="h-4 w-4" />
				</Button>
			</div>
		</div>
	</div>
</article>

<style>
	/* Ensure note content links are styled properly */
	:global(.note-content a) {
		word-break: break-all;
	}
</style>
