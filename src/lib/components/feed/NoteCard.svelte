<script lang="ts">
	import { fade, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
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
	import { notificationsStore } from '$stores/notifications.svelte';
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
		const shareText = `${event.content.slice(0, 100)}${event.content.length > 100 ? '...' : ''}\n\n— ${displayName} on AURA`;

		try {
			if (navigator.share) {
				await navigator.share({
					url: noteUrl,
					title: `Note by ${displayName}`,
					text: shareText,
				});
			} else {
				await navigator.clipboard.writeText(noteUrl);
				notificationsStore.success('Link copied!', 'Share it anywhere');
			}
		} catch (e) {
			// User cancelled share dialog - try clipboard fallback
			if ((e as Error).name !== 'AbortError') {
				try {
					await navigator.clipboard.writeText(noteUrl);
					notificationsStore.success(
						'Link copied!',
						'Share it anywhere',
					);
				} catch {
					notificationsStore.error(
						'Failed to share',
						'Could not copy link',
					);
				}
			}
		}
	}
</script>

<article
	class="group relative border-b border-border p-4 transition-all duration-300 hover:bg-card/60 hover:border-primary/20"
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
				class="flex items-center justify-between text-muted-foreground -mx-1"
				role="group"
				aria-label="Note actions"
			>
				<a
					href="/note/{event.id}"
					class="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all duration-200 group/action"
					aria-label="View thread{replyCount > 0 ?
						`, ${replyCount} replies`
					:	''}"
				>
					<MessageCircle
						class="h-4 w-4 transition-transform group-hover/action:scale-110"
					/>
					{#if replyCount > 0}
						<span class="text-xs font-medium">{replyCount}</span>
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
							transition:scale={{
								duration: 150,
								start: 0.95,
								easing: cubicOut,
							}}
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
		transition:fade={{ duration: 200 }}
	></div>
	<div
		class="fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 p-4"
		transition:scale={{ duration: 250, start: 0.95, easing: cubicOut }}
	>
		<div
			class="rounded-lg border border-border bg-background shadow-xl card-elevated-lg"
		>
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
	/* Note content link styling */
	:global(.note-content a) {
		word-break: break-all;
		color: var(--accent);
		text-decoration: none;
		transition:
			color 0.2s ease,
			text-decoration 0.2s ease;
	}

	:global(.note-content a:hover) {
		color: var(--primary);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	/* Hashtag styling */
	:global(.note-content .hashtag) {
		color: var(--primary);
		font-weight: 500;
		transition: color 0.2s ease;
	}

	:global(.note-content .hashtag:hover) {
		color: var(--accent);
	}

	/* Mention styling */
	:global(.note-content .mention) {
		color: var(--accent);
		font-weight: 500;
		background: oklch(0.7 0.18 195 / 0.1);
		padding: 0.125rem 0.375rem;
		border-radius: 0.25rem;
		transition: background 0.2s ease;
	}

	:global(.note-content .mention:hover) {
		background: oklch(0.7 0.18 195 / 0.2);
	}
</style>
