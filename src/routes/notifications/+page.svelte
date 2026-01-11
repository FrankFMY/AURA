<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$stores/auth.svelte';
	import {
		socialNotificationsStore,
		type SocialNotification,
		type SocialNotificationType,
	} from '$stores/social-notifications.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Badge } from '$components/ui/badge';
	import { Skeleton } from '$components/ui/skeleton';
	import { formatRelativeTime, truncatePubkey } from '$lib/utils';
	import Bell from 'lucide-svelte/icons/bell';
	import Heart from 'lucide-svelte/icons/heart';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Repeat2 from 'lucide-svelte/icons/repeat-2';
	import Zap from 'lucide-svelte/icons/zap';
	import UserPlus from 'lucide-svelte/icons/user-plus';
	import AtSign from 'lucide-svelte/icons/at-sign';
	import Check from 'lucide-svelte/icons/check';
	import CheckCheck from 'lucide-svelte/icons/check-check';

	type FilterType = 'all' | SocialNotificationType;
	let activeFilter = $state<FilterType>('all');

	const filteredNotifications = $derived(
		activeFilter === 'all' ?
			socialNotificationsStore.notifications
		:	socialNotificationsStore.notifications.filter(
				(n) => n.type === activeFilter,
			),
	);

	const filters: { type: FilterType; label: string; icon: typeof Bell }[] = [
		{ type: 'all', label: 'All', icon: Bell },
		{ type: 'mention', label: 'Mentions', icon: AtSign },
		{ type: 'reply', label: 'Replies', icon: MessageCircle },
		{ type: 'reaction', label: 'Likes', icon: Heart },
		{ type: 'repost', label: 'Reposts', icon: Repeat2 },
		{ type: 'zap', label: 'Zaps', icon: Zap },
		{ type: 'follow', label: 'Follows', icon: UserPlus },
	];

	function getNotificationIcon(type: SocialNotificationType) {
		switch (type) {
			case 'mention':
				return AtSign;
			case 'reply':
				return MessageCircle;
			case 'reaction':
				return Heart;
			case 'repost':
				return Repeat2;
			case 'zap':
				return Zap;
			case 'follow':
				return UserPlus;
		}
	}

	function getNotificationColor(type: SocialNotificationType): string {
		switch (type) {
			case 'mention':
				return 'text-accent';
			case 'reply':
				return 'text-primary';
			case 'reaction':
				return 'text-destructive';
			case 'repost':
				return 'text-success';
			case 'zap':
				return 'text-warning';
			case 'follow':
				return 'text-primary';
		}
	}

	function getNotificationText(notification: SocialNotification): string {
		const name =
			notification.actorProfile?.display_name ||
			notification.actorProfile?.name ||
			truncatePubkey(notification.actorPubkey);

		switch (notification.type) {
			case 'mention':
				return `${name} mentioned you`;
			case 'reply':
				return `${name} replied to you`;
			case 'reaction':
				return `${name} liked your note`;
			case 'repost':
				return `${name} reposted your note`;
			case 'zap':
				return notification.amount ?
						`${name} zapped you ⚡${notification.amount} sats`
					:	`${name} zapped you`;
			case 'follow':
				return `${name} followed you`;
		}
	}

	onMount(() => {
		if (authStore.isAuthenticated) {
			socialNotificationsStore.startSubscriptions();
		}
	});

	onDestroy(() => {
		socialNotificationsStore.stopSubscriptions();
	});

	function handleNotificationClick(notification: SocialNotification) {
		socialNotificationsStore.markAsRead(notification.id);

		// Navigate based on type
		if (notification.targetEventId) {
			// Would navigate to note - for now just mark as read
		} else if (notification.type === 'follow') {
			window.location.href = `/profile/${notification.actorPubkey}`;
		}
	}
</script>

<svelte:head>
	<title>Notifications | AURA</title>
</svelte:head>

<div class="min-h-screen pb-16 md:pb-0">
	<!-- Header -->
	<header
		class="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur"
	>
		<div class="flex h-14 items-center justify-between px-4">
			<div class="flex items-center gap-2">
				<h1 class="text-xl font-bold">Notifications</h1>
				{#if socialNotificationsStore.unreadCount > 0}
					<Badge
						variant="destructive"
						class="h-5 px-1.5 text-xs"
					>
						{socialNotificationsStore.unreadCount}
					</Badge>
				{/if}
			</div>
			{#if socialNotificationsStore.notifications.length > 0}
				<Button
					variant="ghost"
					size="sm"
					onclick={() => socialNotificationsStore.markAllAsRead()}
				>
					<CheckCheck class="mr-1 h-4 w-4" />
					Mark all read
				</Button>
			{/if}
		</div>

		<!-- Filters -->
		<div class="flex gap-1 overflow-x-auto px-4 pb-2">
			{#each filters as filter}
				<Button
					variant={activeFilter === filter.type ? 'default' : 'ghost'}
					size="sm"
					class="shrink-0"
					onclick={() => (activeFilter = filter.type)}
				>
					{@const Icon = filter.icon}
					<Icon class="mr-1 h-3 w-3" />
					{filter.label}
				</Button>
			{/each}
		</div>
	</header>

	<div class="mx-auto max-w-2xl">
		{#if !authStore.isAuthenticated}
			<div
				class="flex flex-col items-center justify-center p-8 text-center"
			>
				<Bell class="mb-4 h-12 w-12 text-muted-foreground" />
				<h2 class="text-lg font-semibold">
					Login to see notifications
				</h2>
				<p class="text-muted-foreground">
					Connect your Nostr account to receive notifications
				</p>
				<Button
					variant="glow"
					class="mt-4"
					href="/login"
				>
					Login
				</Button>
			</div>
		{:else if socialNotificationsStore.isLoading && filteredNotifications.length === 0}
			<!-- Loading skeletons -->
			<div class="divide-y divide-border">
				{#each Array(5) as _}
					<div class="flex items-start gap-3 p-4">
						<Skeleton class="h-10 w-10 rounded-full" />
						<div class="flex-1 space-y-2">
							<Skeleton class="h-4 w-48" />
							<Skeleton class="h-3 w-32" />
						</div>
					</div>
				{/each}
			</div>
		{:else if filteredNotifications.length === 0}
			<div
				class="flex flex-col items-center justify-center p-8 text-center"
			>
				<Bell class="mb-4 h-12 w-12 text-muted-foreground" />
				<h2 class="text-lg font-semibold">No notifications yet</h2>
				<p class="text-muted-foreground">
					{activeFilter === 'all' ?
						"When someone interacts with you, you'll see it here"
					:	`No ${activeFilter} notifications`}
				</p>
			</div>
		{:else}
			<div class="divide-y divide-border">
				{#each filteredNotifications as notification (notification.id)}
					{@const Icon = getNotificationIcon(notification.type)}
					<button
						class="flex w-full items-start gap-3 p-4 text-left transition-colors hover:bg-muted/50 {(
							notification.read
						) ?
							'opacity-60'
						:	''}"
						onclick={() => handleNotificationClick(notification)}
					>
						<!-- Actor avatar -->
						<div class="relative">
							<Avatar size="md">
								<AvatarImage
									src={notification.actorProfile?.picture}
								/>
								<AvatarFallback>
									{(
										notification.actorProfile
											?.display_name ||
										notification.actorProfile?.name ||
										'A'
									)
										.slice(0, 2)
										.toUpperCase()}
								</AvatarFallback>
							</Avatar>
							<!-- Type icon badge -->
							<div
								class="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-background border border-border"
							>
								<Icon
									class="h-3 w-3 {getNotificationColor(
										notification.type,
									)}"
								/>
							</div>
						</div>

						<!-- Content -->
						<div class="min-w-0 flex-1">
							<p class="font-medium">
								{getNotificationText(notification)}
							</p>
							{#if notification.content}
								<p
									class="mt-1 truncate text-sm text-muted-foreground"
								>
									{notification.content}
								</p>
							{/if}
							<p class="mt-1 text-xs text-muted-foreground">
								{formatRelativeTime(notification.createdAt)}
							</p>
						</div>

						<!-- Unread indicator -->
						{#if !notification.read}
							<div
								class="h-2 w-2 rounded-full bg-primary shrink-0 mt-2"
							></div>
						{/if}
					</button>
				{/each}
			</div>
		{/if}
	</div>
</div>
