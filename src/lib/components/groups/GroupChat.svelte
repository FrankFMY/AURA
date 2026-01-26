<script lang="ts">
	import { groupsStore, type Group, type GroupMessage } from '$stores/groups.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { dbHelpers, type UserProfile } from '$db';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import { Skeleton } from '$components/ui/skeleton';
	import { formatRelativeTime } from '$lib/utils';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Send from 'lucide-svelte/icons/send';
	import Settings from 'lucide-svelte/icons/settings';
	import Users from 'lucide-svelte/icons/users';
	import Hash from 'lucide-svelte/icons/hash';
	import Reply from 'lucide-svelte/icons/reply';
	import X from 'lucide-svelte/icons/x';
	import { onMount, tick } from 'svelte';

	interface Props {
		group: Group;
		onBack: () => void;
		onSettings?: () => void;
	}

	let { group, onBack, onSettings }: Props = $props();

	let messageInput = $state('');
	let replyingTo = $state<GroupMessage | null>(null);
	let messagesContainer: HTMLDivElement;
	let isSending = $state(false);

	const messages = $derived(groupsStore.messages.get(group.id) || []);
	const isLoadingMessages = $derived(groupsStore.isLoadingMessages);

	// Profile cache for message authors
	let profileCache = $state<Map<string, UserProfile | null>>(new Map());

	onMount(() => {
		// Subscribe to messages for this group
		groupsStore.subscribeToMessages(group.id);

		return () => {
			// Cleanup handled by store
		};
	});

	// Auto-scroll to bottom when new messages arrive
	$effect(() => {
		if (messages.length > 0 && messagesContainer) {
			tick().then(() => {
				messagesContainer.scrollTop = messagesContainer.scrollHeight;
			});
		}
	});

	// Load profiles for message authors
	$effect(() => {
		const pubkeys = new Set(messages.map((m) => m.pubkey));
		for (const pubkey of pubkeys) {
			if (!profileCache.has(pubkey)) {
				dbHelpers.getProfile(pubkey).then((profile) => {
					profileCache.set(pubkey, profile || null);
					profileCache = new Map(profileCache);
				});
			}
		}
	});

	async function handleSend() {
		if (!messageInput.trim() || isSending) return;

		isSending = true;
		const content = messageInput.trim();
		const replyToId = replyingTo?.id;

		// Clear input immediately for better UX
		messageInput = '';
		replyingTo = null;

		try {
			const success = await groupsStore.sendMessage(group.id, content, replyToId);
			if (!success) {
				// Restore input if failed
				messageInput = content;
			}
		} catch (e) {
			console.error('Failed to send message:', e);
			messageInput = content;
		} finally {
			isSending = false;
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSend();
		}
	}

	function setReplyTo(message: GroupMessage) {
		replyingTo = message;
	}

	function clearReply() {
		replyingTo = null;
	}

	function getProfile(pubkey: string): UserProfile | null {
		return profileCache.get(pubkey) || null;
	}

	function getDisplayName(message: GroupMessage): string {
		const profile = message.profile || getProfile(message.pubkey);
		return profile?.name || profile?.display_name || message.pubkey.slice(0, 8) + '...';
	}

	function isOwnMessage(pubkey: string): boolean {
		return authStore.pubkey === pubkey;
	}

	// Group consecutive messages from same author
	function shouldShowAuthor(index: number): boolean {
		if (index === 0) return true;
		const current = messages[index];
		const previous = messages[index - 1];
		// Show author if different from previous or more than 5 min gap
		return (
			current.pubkey !== previous.pubkey ||
			current.createdAt - previous.createdAt > 300
		);
	}
</script>

<div class="flex flex-col h-full">
	<!-- Header -->
	<div class="flex items-center gap-3 p-4 border-b border-border bg-background">
		<Button variant="ghost" size="icon" onclick={onBack}>
			<ArrowLeft class="h-5 w-5" />
		</Button>

		<Avatar size="md">
			{#if group.picture}
				<AvatarImage src={group.picture} alt="" />
			{/if}
			<AvatarFallback class="bg-primary/10">
				<Hash class="h-5 w-5 text-primary" />
			</AvatarFallback>
		</Avatar>

		<div class="flex-1 min-w-0">
			<h2 class="font-semibold truncate">{group.name}</h2>
			{#if group.about}
				<p class="text-sm text-muted-foreground truncate">{group.about}</p>
			{/if}
		</div>

		{#if onSettings}
			<Button variant="ghost" size="icon" onclick={onSettings}>
				<Settings class="h-5 w-5" />
			</Button>
		{/if}
	</div>

	<!-- Messages -->
	<div
		bind:this={messagesContainer}
		class="flex-1 overflow-y-auto p-4 space-y-1"
	>
		{#if isLoadingMessages}
			<!-- Loading skeleton -->
			<div class="space-y-4">
				{#each Array(5) as _}
					<div class="flex items-start gap-3">
						<Skeleton class="h-8 w-8 rounded-full" />
						<div class="space-y-2">
							<Skeleton class="h-4 w-24" />
							<Skeleton class="h-12 w-48 rounded-lg" />
						</div>
					</div>
				{/each}
			</div>
		{:else if messages.length === 0}
			<div class="flex flex-col items-center justify-center h-full text-center">
				<Users class="h-12 w-12 text-muted-foreground mb-4" />
				<p class="text-muted-foreground">No messages yet</p>
				<p class="text-sm text-muted-foreground">Be the first to say something!</p>
			</div>
		{:else}
			{#each messages as message, index (message.id)}
				{@const showAuthor = shouldShowAuthor(index)}
				{@const isOwn = isOwnMessage(message.pubkey)}
				{@const profile = message.profile || getProfile(message.pubkey)}

				<div class="group {isOwn ? 'flex flex-row-reverse' : 'flex'} items-end gap-2 {showAuthor ? 'mt-4' : 'mt-0.5'}">
					<!-- Avatar (only for non-own messages with author shown) -->
					{#if !isOwn && showAuthor}
						<Avatar size="sm">
							{#if profile?.picture}
								<AvatarImage src={profile.picture} alt="" />
							{/if}
							<AvatarFallback class="text-xs">
								{(profile?.name || message.pubkey)[0].toUpperCase()}
							</AvatarFallback>
						</Avatar>
					{:else if !isOwn}
						<div class="w-8"></div>
					{/if}

					<div class="max-w-[75%] {isOwn ? 'items-end' : 'items-start'} flex flex-col">
						<!-- Author name (only if shown) -->
						{#if showAuthor && !isOwn}
							<span class="text-xs text-muted-foreground mb-1 ml-1">
								{getDisplayName(message)}
							</span>
						{/if}

						<!-- Reply reference -->
						{#if message.replyTo}
							{@const repliedMessage = messages.find((m) => m.id === message.replyTo)}
							{#if repliedMessage}
								<div class="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1 mb-1 ml-1 border-l-2 border-primary/50">
									<span class="font-medium">{getDisplayName(repliedMessage)}</span>
									<p class="truncate max-w-[200px]">{repliedMessage.content}</p>
								</div>
							{/if}
						{/if}

						<!-- Message bubble -->
						<div
							class="relative rounded-2xl px-3 py-2 {isOwn
								? 'bg-primary text-primary-foreground rounded-br-md'
								: 'bg-muted rounded-bl-md'}"
						>
							<p class="whitespace-pre-wrap break-words">{message.content}</p>

							<!-- Time (shown on hover) -->
							<span
								class="absolute {isOwn ? '-left-16' : '-right-16'} bottom-0 text-xs text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
							>
								{formatRelativeTime(message.createdAt)}
							</span>
						</div>

						<!-- Reply button (shown on hover) -->
						<button
							class="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground p-1 mt-1"
							onclick={() => setReplyTo(message)}
						>
							<Reply class="h-3 w-3" />
						</button>
					</div>
				</div>
			{/each}
		{/if}
	</div>

	<!-- Reply indicator -->
	{#if replyingTo}
		<div class="px-4 py-2 border-t border-border bg-muted/30 flex items-center gap-2">
			<Reply class="h-4 w-4 text-muted-foreground" />
			<div class="flex-1 min-w-0">
				<span class="text-xs text-muted-foreground">Replying to </span>
				<span class="text-xs font-medium">{getDisplayName(replyingTo)}</span>
				<p class="text-sm truncate text-muted-foreground">{replyingTo.content}</p>
			</div>
			<Button variant="ghost" size="icon" class="h-6 w-6" onclick={clearReply}>
				<X class="h-4 w-4" />
			</Button>
		</div>
	{/if}

	<!-- Input -->
	{#if authStore.isAuthenticated}
		<div class="p-4 border-t border-border bg-background">
			<div class="flex items-center gap-2">
				<Input
					bind:value={messageInput}
					placeholder="Type a message..."
					class="flex-1"
					onkeydown={handleKeyDown}
					disabled={isSending}
				/>
				<Button
					onclick={handleSend}
					disabled={!messageInput.trim() || isSending}
					size="icon"
				>
					<Send class="h-4 w-4" />
				</Button>
			</div>
		</div>
	{:else}
		<div class="p-4 border-t border-border bg-muted/30 text-center">
			<p class="text-sm text-muted-foreground">Log in to send messages</p>
		</div>
	{/if}
</div>
