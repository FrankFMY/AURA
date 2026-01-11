<script lang="ts">
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import type { UserProfile } from '$db';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Textarea } from '$components/ui/textarea';
	import { Spinner } from '$components/ui/spinner';
	import { ZapModal } from '$components/zap';
	import MediaEmbed from './MediaEmbed.svelte';
	import { formatRelativeTime, truncatePubkey } from '$lib/utils';
	import { parseNoteContent, sanitizeUrl } from '$lib/validators/sanitize';
	import { feedStore } from '$stores/feed.svelte';
	import Heart from 'lucide-svelte/icons/heart';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Repeat2 from 'lucide-svelte/icons/repeat-2';
	import Zap from 'lucide-svelte/icons/zap';
	import Share from 'lucide-svelte/icons/share';
	import X from 'lucide-svelte/icons/x';
	import Send from 'lucide-svelte/icons/send';

	interface Props {
		event: NDKEvent;
		author: UserProfile | null;
		replyCount?: number;
		reactionCount?: number;
		repostCount?: number;
		zapCount?: number;
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
		zapCount = 0,
		hasReacted = false,
		hasReposted = false,
		onReply,
	}: Props = $props();

	let isReacting = $state(false);
	let isReposting = $state(false);
	let showZapModal = $state(false);
	let showRepostMenu = $state(false);
	let showQuoteModal = $state(false);
	let quoteContent = $state('');

	// Parse content safely using DOMPurify-based sanitization
	const parsedContent = $derived(parseNoteContent(event.content));
	const safeHtml = $derived(parsedContent.html);

	// Extract all media URLs from content (images, videos, YouTube)
	const mediaUrls = $derived(extractMediaUrls(event.content));

	function extractMediaUrls(content: string): string[] {
		const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;
		const urls = content.match(urlRegex) || [];

		// Filter to media-like URLs
		return urls.filter((url) => {
			const lower = url.toLowerCase();
			return (
				// Images
				/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(lower) ||
				// Videos
				/\.(mp4|webm|mov)(\?.*)?$/i.test(lower) ||
				// YouTube
				lower.includes('youtube.com/watch') ||
				lower.includes('youtu.be/') ||
				lower.includes('youtube.com/shorts/') ||
				// Image hosting services
				lower.includes('nostr.build') ||
				lower.includes('imgbb.com') ||
				lower.includes('imgur.com') ||
				lower.includes('i.imgur.com') ||
				lower.includes('primal.b-cdn.net') ||
				lower.includes('void.cat')
			);
		});
	}

	const displayName = $derived(
		author?.display_name || author?.name || truncatePubkey(event.pubkey),
	);

	const avatarInitials = $derived(
		(author?.display_name || author?.name || 'A').slice(0, 2).toUpperCase(),
	);

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
		showRepostMenu = false;
		try {
			await feedStore.repost(event);
		} finally {
			isReposting = false;
		}
	}

	async function handleQuoteRepost() {
		showRepostMenu = false;
		showQuoteModal = true;
	}

	async function submitQuoteRepost() {
		if (!quoteContent.trim()) return;

		isReposting = true;
		try {
			// Create quote post with nostr:nevent reference
			const noteId = event.id;
			const quotedContent = `${quoteContent}\n\nnostr:nevent1${noteId}`;
			await feedStore.publishNote(quotedContent);
			quoteContent = '';
			showQuoteModal = false;
		} finally {
			isReposting = false;
		}
	}

	function handleZap() {
		// Check if author has lightning address
		if (!author?.lud16) {
			// Still open modal - it will show error
		}
		showZapModal = true;
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

			<!-- Media embeds (images, videos, YouTube) -->
			{#if mediaUrls.length > 0}
				<div
					class="mb-3 grid gap-2 {mediaUrls.length > 1 ?
						'grid-cols-2'
					:	'grid-cols-1'}"
				>
					{#each mediaUrls.slice(0, 4) as mediaUrl (mediaUrl)}
						<MediaEmbed url={mediaUrl} />
					{/each}
					{#if mediaUrls.length > 4}
						<div
							class="flex items-center justify-center rounded-lg bg-muted text-muted-foreground p-4"
						>
							+{mediaUrls.length - 4} more
						</div>
					{/if}
				</div>
			{/if}

			<!-- Actions -->
			<div
				class="flex items-center justify-between text-muted-foreground"
				role="group"
				aria-label="Note actions"
			>
				<a
					href="/note/{event.id}"
					class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-primary hover:bg-accent/10 transition-colors"
					aria-label="View thread{replyCount > 0 ?
						`, ${replyCount} replies`
					:	''}"
				>
					<MessageCircle class="h-4 w-4" />
					{#if replyCount > 0}
						<span class="text-xs">{replyCount}</span>
					{/if}
				</a>

				<div class="relative">
					<Button
						variant="ghost"
						size="sm"
						class="gap-1.5 hover:text-success {hasReposted ?
							'text-success'
						:	''}"
						onclick={() => (showRepostMenu = !showRepostMenu)}
						disabled={isReposting}
						aria-label="{hasReposted ? 'Reposted' : 'Repost'}{(
							repostCount > 0
						) ?
							`, ${repostCount} reposts`
						:	''}"
						aria-pressed={hasReposted}
						aria-expanded={showRepostMenu}
					>
						<Repeat2 class="h-4 w-4" />
						{#if repostCount > 0}
							<span class="text-xs">{repostCount}</span>
						{/if}
					</Button>

					<!-- Repost menu dropdown -->
					{#if showRepostMenu}
						<div
							class="absolute bottom-full left-0 mb-1 w-40 rounded-lg border border-border bg-background shadow-lg z-10"
							role="menu"
						>
							<button
								class="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
								onclick={handleRepost}
								role="menuitem"
							>
								<Repeat2 class="h-4 w-4" />
								Repost
							</button>
							<button
								class="flex w-full items-center gap-2 px-3 py-2 text-sm hover:bg-muted"
								onclick={handleQuoteRepost}
								role="menuitem"
							>
								<MessageCircle class="h-4 w-4" />
								Quote
							</button>
						</div>
					{/if}
				</div>

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
					class="gap-1.5 hover:text-warning {author?.lud16 ? '' : (
						'opacity-50'
					)}"
					onclick={handleZap}
					disabled={!author?.lud16}
					aria-label={author?.lud16 ? 'Send zap' : (
						'User cannot receive zaps'
					)}
					title={author?.lud16 ? 'Send zap' : (
						'User has no lightning address'
					)}
				>
					<Zap class="h-4 w-4" />
					{#if zapCount > 0}
						<span class="text-xs">{zapCount}</span>
					{/if}
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

<!-- Zap Modal -->
{#if author?.lud16}
	<ZapModal
		open={showZapModal}
		recipientPubkey={event.pubkey}
		recipientName={displayName}
		lnurl={author.lud16}
		eventId={event.id}
		onclose={() => (showZapModal = false)}
	/>
{/if}

<!-- Quote Modal -->
{#if showQuoteModal}
	<div
		class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
		onclick={() => (showQuoteModal = false)}
		onkeydown={(e) => e.key === 'Escape' && (showQuoteModal = false)}
		role="button"
		tabindex="-1"
	></div>
	<div
		class="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 p-4"
	>
		<div class="rounded-lg border border-border bg-background shadow-lg">
			<div
				class="flex items-center justify-between border-b border-border p-4"
			>
				<h2 class="font-semibold">Quote this note</h2>
				<Button
					variant="ghost"
					size="icon"
					onclick={() => (showQuoteModal = false)}
				>
					<X class="h-4 w-4" />
				</Button>
			</div>
			<div class="p-4">
				<Textarea
					bind:value={quoteContent}
					placeholder="Add your thoughts..."
					rows={3}
					class="mb-3"
				/>
				<!-- Quoted note preview -->
				<div class="rounded-lg border border-border p-3 bg-muted/50">
					<div class="flex items-center gap-2 mb-2">
						<Avatar size="sm">
							<AvatarImage src={author?.picture} />
							<AvatarFallback>{avatarInitials}</AvatarFallback>
						</Avatar>
						<span class="text-sm font-medium">{displayName}</span>
					</div>
					<p class="text-sm text-muted-foreground line-clamp-3">
						{event.content.slice(0, 200)}{(
							event.content.length > 200
						) ?
							'...'
						:	''}
					</p>
				</div>
			</div>
			<div class="border-t border-border p-4">
				<Button
					variant="glow"
					class="w-full"
					onclick={submitQuoteRepost}
					disabled={isReposting || !quoteContent.trim()}
				>
					{#if isReposting}
						<Spinner class="mr-2 h-4 w-4" />
						Posting...
					{:else}
						<Send class="mr-2 h-4 w-4" />
						Post Quote
					{/if}
				</Button>
			</div>
		</div>
	</div>
{/if}

<style>
	/* Ensure note content links are styled properly */
	:global(.note-content a) {
		word-break: break-all;
	}
</style>
