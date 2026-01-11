<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { messagesStore } from '$stores/messages.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import { Textarea } from '$components/ui/textarea';
	import { Spinner } from '$components/ui/spinner';
	import { Badge } from '$components/ui/badge';
	import { Skeleton } from '$components/ui/skeleton';
	import { formatRelativeTime, truncatePubkey } from '$lib/utils';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Send from 'lucide-svelte/icons/send';
	import Plus from 'lucide-svelte/icons/plus';
	import Search from 'lucide-svelte/icons/search';
	import Lock from 'lucide-svelte/icons/lock';
	import AlertCircle from 'lucide-svelte/icons/alert-circle';

	let messageInput = $state('');
	let searchQuery = $state('');
	let showNewConversation = $state(false);
	let newConversationPubkey = $state('');
	let messagesContainer: HTMLElement | undefined = $state(undefined);

	const activeConv = $derived(messagesStore.getActiveConversation());

	onMount(() => {
		messagesStore.loadConversations();
	});

	onDestroy(() => {
		messagesStore.cleanup();
	});

	// Auto-scroll to bottom when new messages arrive
	$effect(() => {
		if (activeConv?.messages && messagesContainer) {
			messagesContainer.scrollTop = messagesContainer.scrollHeight;
		}
	});

	async function handleSendMessage() {
		if (!messageInput.trim() || !messagesStore.activeConversation) return;

		const content = messageInput;
		messageInput = '';

		try {
			await messagesStore.sendMessage(
				messagesStore.activeConversation,
				content,
			);
		} catch (e) {
			// Show error
			messageInput = content;
		}
	}

	async function handleStartConversation() {
		if (!newConversationPubkey.trim()) return;

		await messagesStore.startConversation(newConversationPubkey);
		newConversationPubkey = '';
		showNewConversation = false;
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			handleSendMessage();
		}
	}

	const filteredConversations = $derived(
		messagesStore.conversations.filter((c) => {
			if (!searchQuery) return true;
			const name = c.profile?.display_name || c.profile?.name || c.pubkey;
			return name.toLowerCase().includes(searchQuery.toLowerCase());
		}),
	);
</script>

<svelte:head>
	<title>Messages | AURA</title>
</svelte:head>

<div class="flex h-screen pb-16 md:pb-0">
	<!-- Conversation list -->
	<div
		class="w-full border-r border-border md:w-80 {(
			messagesStore.activeConversation
		) ?
			'hidden md:block'
		:	''}"
	>
		<div
			class="sticky top-0 z-10 border-b border-border bg-background/95 p-4 backdrop-blur"
		>
			<div class="mb-4 flex items-center justify-between">
				<h1 class="text-xl font-bold">Messages</h1>
				<Button
					variant="ghost"
					size="icon"
					onclick={() => (showNewConversation = !showNewConversation)}
				>
					<Plus class="h-5 w-5" />
				</Button>
			</div>

			{#if showNewConversation}
				<div class="mb-4 space-y-2">
					<Input
						bind:value={newConversationPubkey}
						placeholder="Enter npub or pubkey..."
						class="font-mono text-sm"
					/>
					<Button
						variant="glow"
						size="sm"
						class="w-full"
						onclick={handleStartConversation}
						disabled={!newConversationPubkey.trim()}
					>
						Start Conversation
					</Button>
				</div>
			{/if}

			<div class="relative">
				<Search
					class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					bind:value={searchQuery}
					placeholder="Search conversations..."
					class="pl-10"
				/>
			</div>
		</div>

		<div class="divide-y divide-border">
			{#if messagesStore.isLoading && messagesStore.conversations.length === 0}
				{#each Array(5) as _}
					<div class="flex items-center gap-3 p-4">
						<Skeleton class="h-12 w-12 rounded-full" />
						<div class="flex-1 space-y-2">
							<Skeleton class="h-4 w-24" />
							<Skeleton class="h-3 w-full" />
						</div>
					</div>
				{/each}
			{:else if filteredConversations.length === 0}
				<div class="p-8 text-center">
					<Lock class="mx-auto h-12 w-12 text-muted-foreground" />
					<p class="mt-4 text-muted-foreground">
						No conversations yet
					</p>
					<p class="text-sm text-muted-foreground">
						Start a new encrypted chat
					</p>
				</div>
			{:else}
				{#each filteredConversations as conversation (conversation.pubkey)}
					<button
						class="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-muted/50
							{messagesStore.activeConversation === conversation.pubkey ? 'bg-muted' : ''}"
						onclick={() =>
							messagesStore.openConversation(conversation.pubkey)}
					>
						<Avatar size="lg">
							<AvatarImage src={conversation.profile?.picture} />
							<AvatarFallback>
								{(conversation.profile?.display_name ||
									conversation.profile?.name ||
									conversation.pubkey)?.[0]?.toUpperCase() ||
									'?'}
							</AvatarFallback>
						</Avatar>
						<div class="min-w-0 flex-1">
							<div class="flex items-center justify-between">
								<p class="font-medium">
									{conversation.profile?.display_name ||
										conversation.profile?.name ||
										truncatePubkey(conversation.pubkey)}
								</p>
								{#if conversation.unread_count > 0}
									<Badge
										variant="default"
										class="text-xs"
									>
										{conversation.unread_count}
									</Badge>
								{/if}
							</div>
							<p class="truncate text-sm text-muted-foreground">
								{conversation.last_message_preview ||
									'Start chatting'}
							</p>
							{#if conversation.last_message_at}
								<p class="text-xs text-muted-foreground">
									{formatRelativeTime(
										conversation.last_message_at,
									)}
								</p>
							{/if}
						</div>
					</button>
				{/each}
			{/if}
		</div>
	</div>

	<!-- Chat view -->
	<div
		class="flex flex-1 flex-col {messagesStore.activeConversation ? '' : (
			'hidden md:flex'
		)}"
	>
		{#if activeConv}
			<!-- Chat header -->
			<div
				class="flex items-center gap-3 border-b border-border bg-background/95 p-4 backdrop-blur"
			>
				<Button
					variant="ghost"
					size="icon"
					class="md:hidden"
					onclick={() => messagesStore.closeConversation()}
				>
					<ArrowLeft class="h-5 w-5" />
				</Button>
				<Avatar>
					<AvatarImage src={activeConv.profile?.picture} />
					<AvatarFallback>
						{(activeConv.profile?.display_name ||
							activeConv.profile?.name ||
							activeConv.pubkey)?.[0]?.toUpperCase() || '?'}
					</AvatarFallback>
				</Avatar>
				<div>
					<p class="font-medium">
						{activeConv.profile?.display_name ||
							activeConv.profile?.name ||
							truncatePubkey(activeConv.pubkey)}
					</p>
					<div class="flex items-center gap-1 text-xs text-success">
						<Lock class="h-3 w-3" />
						End-to-end encrypted
					</div>
				</div>
			</div>

			<!-- Messages -->
			<div
				bind:this={messagesContainer}
				class="flex-1 space-y-4 overflow-y-auto p-4"
			>
				{#each activeConv.messages as message (message.id)}
					<div
						class="flex {message.isOutgoing ? 'justify-end' : (
							'justify-start'
						)}"
					>
						<div
							class="max-w-[80%] rounded-2xl px-4 py-2 {(
								message.isOutgoing
							) ?
								'bg-primary text-primary-foreground'
							:	'bg-muted'}"
						>
							{#if !message.decrypted}
								<div
									class="flex items-center gap-2 text-sm text-warning"
								>
									<AlertCircle class="h-4 w-4" />
									<span>Failed to decrypt</span>
								</div>
							{:else}
								<p class="whitespace-pre-wrap wrap-break-word">
									{message.content}
								</p>
							{/if}
							<p
								class="mt-1 text-right text-xs {(
									message.isOutgoing
								) ?
									'text-primary-foreground/70'
								:	'text-muted-foreground'}"
							>
								{formatRelativeTime(message.created_at)}
							</p>
						</div>
					</div>
				{/each}
			</div>

			<!-- Input -->
			<div class="border-t border-border bg-background p-4">
				<div class="flex items-end gap-2">
					<Textarea
						bind:value={messageInput}
						placeholder="Type a message..."
						rows={1}
						class="min-h-[44px] max-h-32 resize-none"
						onkeydown={handleKeydown}
					/>
					<Button
						variant="glow"
						size="icon"
						onclick={handleSendMessage}
						disabled={!messageInput.trim() ||
							messagesStore.isSending}
					>
						{#if messagesStore.isSending}
							<Spinner size="sm" />
						{:else}
							<Send class="h-5 w-5" />
						{/if}
					</Button>
				</div>
			</div>
		{:else}
			<!-- No conversation selected -->
			<div class="flex flex-1 items-center justify-center">
				<div class="text-center">
					<Lock class="mx-auto h-16 w-16 text-muted-foreground" />
					<h2 class="mt-4 text-xl font-semibold">Private Messages</h2>
					<p class="mt-2 text-muted-foreground">
						Select a conversation or start a new one
					</p>
				</div>
			</div>
		{/if}
	</div>
</div>
