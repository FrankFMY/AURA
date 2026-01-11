<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { authStore } from '$stores/auth.svelte';
	import ndkService from '$services/ndk';
	import { contactsService } from '$services/contacts';
	import { dbHelpers, type UserProfile } from '$db';
	import type { NDKEvent } from '@nostr-dev-kit/ndk';
	import NoteCard from '$components/feed/NoteCard.svelte';
	import NoteSkeleton from '$components/feed/NoteSkeleton.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Badge } from '$components/ui/badge';
	import { Skeleton } from '$components/ui/skeleton';
	import { Spinner } from '$components/ui/spinner';
	import { truncatePubkey, copyToClipboard } from '$lib/utils';
	import { nip19 } from 'nostr-tools';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Copy from 'lucide-svelte/icons/copy';
	import Check from 'lucide-svelte/icons/check';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Zap from 'lucide-svelte/icons/zap';
	import Calendar from 'lucide-svelte/icons/calendar';
	import UserPlus from 'lucide-svelte/icons/user-plus';
	import UserMinus from 'lucide-svelte/icons/user-minus';
	import { ZapModal } from '$components/zap';

	let profile = $state<UserProfile | null>(null);
	let showZapModal = $state(false);
	let notes = $state<NDKEvent[]>([]);
	let isLoading = $state(true);
	let isLoadingNotes = $state(true);
	let copied = $state(false);
	let isFollowing = $state(false);
	let isFollowLoading = $state(false);
	let followingCount = $state(0);
	let followerCount = $state(0);

	const pubkey = $derived($page.params.pubkey ?? '');
	const isOwnProfile = $derived(authStore.pubkey === pubkey);
	const npub = $derived(pubkey ? nip19.npubEncode(pubkey) : '');

	const displayName = $derived(
		profile?.display_name || profile?.name || truncatePubkey(pubkey || ''),
	);

	const avatarInitials = $derived(displayName.slice(0, 2).toUpperCase());

	onMount(async () => {
		if (!pubkey) return;

		// Load cached profile
		const cached = await dbHelpers.getProfile(pubkey);
		if (cached) {
			profile = cached;
			isLoading = false;
		}

		// Check if following
		if (authStore.pubkey && authStore.pubkey !== pubkey) {
			await contactsService.fetchContacts(authStore.pubkey);
			isFollowing = contactsService.isFollowing(pubkey);
		}

		// Fetch fresh profile
		try {
			const event = await ndkService.fetchProfile(pubkey);
			if (event) {
				const parsed = JSON.parse(event.content);
				profile = { pubkey, ...parsed, updated_at: Date.now() };
			}
		} catch (e) {
			console.error('Failed to fetch profile:', e);
		} finally {
			isLoading = false;
		}

		// Fetch notes
		try {
			const filter = {
				kinds: [1],
				authors: [pubkey],
				limit: 30,
			};
			const events = await ndkService.ndk.fetchEvents(filter);
			notes = Array.from(events).sort(
				(a, b) => (b.created_at || 0) - (a.created_at || 0),
			);
		} catch (e) {
			console.error('Failed to fetch notes:', e);
		} finally {
			isLoadingNotes = false;
		}

		// Fetch following/follower counts
		try {
			// Following count (their kind:3 contact list)
			const followingFilter = { kinds: [3], authors: [pubkey], limit: 1 };
			const followingEvents =
				await ndkService.ndk.fetchEvents(followingFilter);
			const followingEvent = Array.from(followingEvents)[0];
			if (followingEvent) {
				followingCount = followingEvent.tags.filter(
					(t) => t[0] === 'p',
				).length;
			}
		} catch (e) {
			console.error('Failed to fetch follow counts:', e);
		}
	});

	async function handleCopyNpub() {
		await copyToClipboard(npub);
		copied = true;
		setTimeout(() => (copied = false), 2000);
	}

	function handleMessage() {
		// Navigate to messages with this user
		window.location.href = `/messages?start=${pubkey}`;
	}

	async function handleFollow() {
		if (!authStore.isAuthenticated || !pubkey) return;

		isFollowLoading = true;
		try {
			if (isFollowing) {
				await contactsService.unfollow(pubkey);
				isFollowing = false;
			} else {
				await contactsService.follow(pubkey);
				isFollowing = true;
			}
		} catch (e) {
			console.error('Failed to update follow status:', e);
		} finally {
			isFollowLoading = false;
		}
	}
</script>

<svelte:head>
	<title>{displayName} | AURA</title>
</svelte:head>

<div class="min-h-screen pb-16 md:pb-0">
	<!-- Banner -->
	<div
		class="relative h-32 bg-linear-to-br from-primary/20 to-accent/20 md:h-48"
	>
		{#if profile?.banner}
			<img
				src={profile.banner}
				alt="Profile banner"
				class="h-full w-full object-cover"
			/>
		{/if}
		<Button
			variant="ghost"
			size="icon"
			class="absolute left-4 top-4 bg-background/50 backdrop-blur"
			onclick={() => history.back()}
		>
			<ArrowLeft class="h-5 w-5" />
		</Button>
	</div>

	<!-- Profile header -->
	<div class="relative mx-auto max-w-2xl px-4">
		<!-- Avatar -->
		<div class="absolute -top-16 left-4 md:-top-20">
			<Avatar
				size="xl"
				class="h-24 w-24 border-4 border-background md:h-32 md:w-32"
			>
				<AvatarImage src={profile?.picture} />
				<AvatarFallback class="text-2xl"
					>{avatarInitials}</AvatarFallback
				>
			</Avatar>
		</div>

		<!-- Actions -->
		<div class="flex justify-end pt-4">
			{#if isOwnProfile}
				<Button
					variant="outline"
					href="/settings">Edit Profile</Button
				>
			{:else if authStore.isAuthenticated}
				<div class="flex gap-2">
					<Button
						variant="outline"
						size="icon"
						onclick={handleMessage}
						title="Send message"
					>
						<MessageCircle class="h-4 w-4" />
					</Button>
					{#if profile?.lud16}
						<Button
							variant="outline"
							size="icon"
							title="Send zap"
							onclick={() => (showZapModal = true)}
						>
							<Zap class="h-4 w-4" />
						</Button>
					{/if}
					<Button
						variant={isFollowing ? 'outline' : 'glow'}
						onclick={handleFollow}
						disabled={isFollowLoading}
						class="min-w-24"
					>
						{#if isFollowLoading}
							<Spinner class="h-4 w-4" />
						{:else if isFollowing}
							<UserMinus class="mr-1 h-4 w-4" />
							Unfollow
						{:else}
							<UserPlus class="mr-1 h-4 w-4" />
							Follow
						{/if}
					</Button>
				</div>
			{/if}
		</div>

		<!-- Info -->
		<div class="mt-8 space-y-4 md:mt-12">
			{#if isLoading}
				<Skeleton class="h-8 w-48" />
				<Skeleton class="h-4 w-32" />
			{:else}
				<div>
					<h1 class="text-2xl font-bold">{displayName}</h1>
					{#if profile?.nip05}
						<Badge
							variant="success"
							class="mt-1"
						>
							<Check class="mr-1 h-3 w-3" />
							{profile.nip05}
						</Badge>
					{/if}
				</div>

				<div class="flex items-center gap-2">
					<code
						class="rounded bg-muted px-2 py-1 font-mono text-xs text-muted-foreground"
					>
						{truncatePubkey(npub, 12)}
					</code>
					<Button
						variant="ghost"
						size="icon"
						class="h-8 w-8"
						onclick={handleCopyNpub}
					>
						{#if copied}
							<Check class="h-4 w-4 text-success" />
						{:else}
							<Copy class="h-4 w-4" />
						{/if}
					</Button>
				</div>

				{#if profile?.about}
					<p class="whitespace-pre-wrap text-muted-foreground">
						{profile.about}
					</p>
				{/if}

				<div class="flex flex-wrap gap-4 text-sm text-muted-foreground">
					{#if profile?.website}
						<a
							href={profile.website}
							target="_blank"
							rel="noopener noreferrer"
							class="flex items-center gap-1 hover:text-accent"
						>
							<ExternalLink class="h-4 w-4" />
							{profile.website.replace(/^https?:\/\//, '')}
						</a>
					{/if}
					{#if profile?.lud16}
						<div class="flex items-center gap-1">
							<Zap class="h-4 w-4 text-warning" />
							{profile.lud16}
						</div>
					{/if}
				</div>

				<!-- Stats -->
				<div class="flex gap-6 border-t border-border pt-4">
					<div>
						<span class="font-bold">{notes.length}</span>
						<span class="text-muted-foreground"> notes</span>
					</div>
					<div>
						<span class="font-bold">{followingCount}</span>
						<span class="text-muted-foreground"> following</span>
					</div>
				</div>
			{/if}
		</div>
	</div>

	<!-- Notes -->
	<div class="mx-auto max-w-2xl">
		<div class="border-t border-border">
			<div class="flex border-b border-border">
				<button
					class="flex-1 border-b-2 border-primary py-3 text-sm font-medium text-primary"
				>
					Notes
				</button>
				<button
					class="flex-1 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
				>
					Replies
				</button>
				<button
					class="flex-1 py-3 text-sm font-medium text-muted-foreground hover:text-foreground"
				>
					Media
				</button>
			</div>

			{#if isLoadingNotes}
				{#each Array(3) as _}
					<NoteSkeleton />
				{/each}
			{:else if notes.length === 0}
				<div class="p-8 text-center text-muted-foreground">
					No notes yet
				</div>
			{:else}
				{#each notes as note (note.id)}
					<NoteCard
						event={note}
						author={profile}
						replyCount={0}
						reactionCount={0}
						repostCount={0}
					/>
				{/each}
			{/if}
		</div>
	</div>
</div>

<!-- Zap Modal -->
{#if profile?.lud16 && pubkey}
	<ZapModal
		open={showZapModal}
		recipientPubkey={pubkey}
		recipientName={displayName}
		lnurl={profile.lud16}
		onclose={() => (showZapModal = false)}
	/>
{/if}
