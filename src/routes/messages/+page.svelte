<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { messagesStore } from '$stores/messages.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { cashuStore } from '$stores/cashu.svelte';
	import { mediaService } from '$services/media';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import { Textarea } from '$components/ui/textarea';
	import { Spinner } from '$components/ui/spinner';
	import { Badge } from '$components/ui/badge';
	import { Skeleton } from '$components/ui/skeleton';
	import { EmptyState } from '$components/ui/empty-state';
	import { CashuTokenBubble, SendCashuModal } from '$components/cashu';
	import VoiceRecorder from '$lib/components/messages/VoiceRecorder.svelte';
	import VoiceMessage from '$lib/components/messages/VoiceMessage.svelte';
	import { formatRelativeTime, truncatePubkey } from '$lib/utils';
	import { notificationsStore } from '$stores/notifications.svelte';
	import { isCallInvite, isCallResponse } from '$stores/calls.svelte';
	import { CallButton } from '$components/calls';
	import ArrowLeft from 'lucide-svelte/icons/arrow-left';
	import Phone from 'lucide-svelte/icons/phone';
	import Video from 'lucide-svelte/icons/video';
	import PhoneOutgoing from 'lucide-svelte/icons/phone-outgoing';
	import PhoneIncoming from 'lucide-svelte/icons/phone-incoming';
	import Send from 'lucide-svelte/icons/send';
	import Plus from 'lucide-svelte/icons/plus';
	import Search from 'lucide-svelte/icons/search';
	import Lock from 'lucide-svelte/icons/lock';
	import Shield from 'lucide-svelte/icons/shield';
	import ShieldCheck from 'lucide-svelte/icons/shield-check';
	import AlertCircle from 'lucide-svelte/icons/alert-circle';
	import MessageSquare from 'lucide-svelte/icons/message-square';
	import Coins from 'lucide-svelte/icons/coins';
	import type { RecordingResult } from '$lib/utils/audio-recorder';

	let messageInput = $state('');
	let searchQuery = $state('');
	let showNewConversation = $state(false);
	let newConversationPubkey = $state('');
	let messagesContainer: HTMLElement | undefined = $state(undefined);
	let showSendCashu = $state(false);
	let isUploadingVoice = $state(false);

	const activeConv = $derived(messagesStore.getActiveConversation());
	const hasCashuBalance = $derived(cashuStore.isConnected && cashuStore.totalBalance > 0);

	/**
	 * Check if message content contains an audio URL
	 */
	function containsAudioUrl(content: string | undefined | null): boolean {
		if (!content) return false;
		return mediaService.extractAudioUrl(content) !== null;
	}

	/**
	 * Extract audio URL from message content
	 */
	function extractAudioUrl(content: string | undefined | null): string | null {
		return mediaService.extractAudioUrl(content || '');
	}

	/**
	 * Handle voice message recorded
	 */
	async function handleVoiceRecorded(result: RecordingResult) {
		if (!messagesStore.activeConversation) return;

		isUploadingVoice = true;

		try {
			// Create file from blob
			const file = new File(
				[result.blob],
				`voice-${Date.now()}.webm`,
				{ type: result.mimeType }
			);

			// Upload to media service
			const uploadResult = await mediaService.upload(file);

			// Send message with audio URL
			await messagesStore.sendMessage(
				messagesStore.activeConversation,
				uploadResult.url
			);
		} catch (e) {
			console.error('Failed to send voice message:', e);
			notificationsStore.error(
				'Failed to send',
				'Could not upload voice message. Please try again.'
			);
		} finally {
			isUploadingVoice = false;
		}
	}

	/**
	 * Check if message is a call-related message (invite or response)
	 */
	function isCallMessage(content: string | undefined | null): boolean {
		if (!content) return false;
		const trimmed = content.trim();
		return isCallInvite(trimmed) !== null || isCallResponse(trimmed) !== null;
	}

	/**
	 * Get call message data for rendering
	 */
	function getCallMessageData(content: string | undefined | null): {
		type: 'invite' | 'response';
		callType: 'audio' | 'video';
		action?: 'accept' | 'decline' | 'end';
	} | null {
		if (!content) return null;
		const trimmed = content.trim();

		const invite = isCallInvite(trimmed);
		if (invite) {
			return { type: 'invite', callType: invite.callType };
		}

		const response = isCallResponse(trimmed);
		if (response) {
			return { type: 'response', callType: 'video', action: response.action };
		}

		return null;
	}

	/**
	 * Check if message content is empty (whitespace only or null/undefined)
	 */
	function isEmptyMessage(content: string | undefined | null): boolean {
		return !content || content.trim().length === 0;
	}

	/**
	 * Check if a message content contains a Cashu token
	 */
	function containsCashuToken(content: string | undefined | null): boolean {
		return cashuStore.looksLikeCashuToken(content);
	}

	/**
	 * Extract Cashu token from message content
	 */
	function extractCashuToken(content: string | undefined | null): string | null {
		return cashuStore.extractToken(content);
	}

	/**
	 * Handle sending eCash token in chat
	 */
	async function handleSendCashu(token: string, amount: number) {
		if (!messagesStore.activeConversation) return;

		try {
			// Send the token as a message
			await messagesStore.sendMessage(
				messagesStore.activeConversation,
				token
			);
			showSendCashu = false;
		} catch (e) {
			console.error('Failed to send eCash:', e);
		}
	}

	onMount(async () => {
		// Only load if not already loaded (layout may have already loaded)
		if (messagesStore.conversations.length === 0) {
			await messagesStore.loadConversations();
		}

		// Check for start parameter to open/create conversation with specific user
		const startPubkey = $page.url.searchParams.get('start');
		if (startPubkey) {
			// Start conversation with this user
			await messagesStore.startConversation(startPubkey);
			// Clear the query parameter from URL without reload
			goto('/messages', { replaceState: true });
		}
	});

	onDestroy(() => {
		// Don't cleanup subscription - it should persist for badge updates
		// Just close active conversation
		messagesStore.closeConversation();
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

<div class="flex h-dvh pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
	<!-- Conversation list -->
	<div
		class="w-full border-r border-border md:w-80 lg:w-96 {(
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
				<EmptyState
					icon={Lock}
					title="No conversations yet"
					description="Start a new encrypted chat with someone on Nostr"
					variant="accent"
					size="md"
					actionLabel="New Chat"
					onAction={() => (showNewConversation = true)}
				/>
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
							{#if conversation.last_message_at && conversation.last_message_preview}
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
				<a
					href="/profile/{activeConv.pubkey}"
					class="flex flex-1 items-center gap-3 hover:opacity-80 transition-opacity min-w-0"
				>
					<Avatar>
						<AvatarImage src={activeConv.profile?.picture} />
						<AvatarFallback>
							{(activeConv.profile?.display_name ||
								activeConv.profile?.name ||
								activeConv.pubkey)?.[0]?.toUpperCase() || '?'}
						</AvatarFallback>
					</Avatar>
					<div class="min-w-0">
						<p class="font-medium truncate">
							{activeConv.profile?.display_name ||
								activeConv.profile?.name ||
								truncatePubkey(activeConv.pubkey)}
						</p>
						{#if messagesStore.preferNip17}
							<div
								class="flex items-center gap-1 text-xs text-success"
							>
								<ShieldCheck class="h-3 w-3" />
								Private (NIP-17)
							</div>
						{:else}
							<div
								class="flex items-center gap-1 text-xs text-amber-500"
							>
								<Lock class="h-3 w-3" />
								Encrypted (NIP-04)
							</div>
						{/if}
					</div>
				</a>

				<!-- Call buttons -->
				<div class="flex items-center gap-1">
					<CallButton
						pubkey={activeConv.pubkey}
						variant="ghost"
						size="icon"
						showLabel={false}
						callType="audio"
					/>
					<CallButton
						pubkey={activeConv.pubkey}
						variant="ghost"
						size="icon"
						showLabel={false}
						callType="video"
					/>
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
						{#if message.decrypted && isCallMessage(message.content)}
							<!-- Call Message (Invite/Response) -->
							{@const callData = getCallMessageData(message.content)}
							{#if callData}
								<div
									class="flex items-center gap-3 rounded-2xl px-4 py-3 {(
										message.isOutgoing
									) ?
										'bg-primary/10 text-primary'
									:	'bg-muted'}"
								>
									<div
										class="flex h-10 w-10 items-center justify-center rounded-full {(
											message.isOutgoing
										) ?
											'bg-primary/20'
										:	'bg-accent'}"
									>
										{#if callData.type === 'invite'}
											{#if message.isOutgoing}
												<PhoneOutgoing class="h-5 w-5" />
											{:else}
												<PhoneIncoming class="h-5 w-5" />
											{/if}
										{:else if callData.callType === 'video'}
											<Video class="h-5 w-5" />
										{:else}
											<Phone class="h-5 w-5" />
										{/if}
									</div>
									<div class="flex flex-col">
										<span class="text-sm font-medium">
											{#if callData.type === 'invite'}
												{#if message.isOutgoing}
													{callData.callType === 'video' ? 'Video call' : 'Voice call'}
												{:else}
													Incoming {callData.callType === 'video' ? 'video' : 'voice'} call
												{/if}
											{:else if callData.action === 'accept'}
												Call accepted
											{:else if callData.action === 'decline'}
												Call declined
											{:else}
												Call ended
											{/if}
										</span>
										<span class="text-xs text-muted-foreground">
											{formatRelativeTime(message.created_at)}
										</span>
									</div>
								</div>
							{/if}
						{:else if message.decrypted && containsCashuToken(message.content)}
							<!-- Cashu Token Message -->
							{@const token = extractCashuToken(message.content)}
							{#if token}
								<CashuTokenBubble
									{token}
									isOutgoing={message.isOutgoing}
									senderPubkey={message.isOutgoing ? undefined : activeConv.pubkey}
								/>
							{/if}
						{:else if message.decrypted && containsAudioUrl(message.content)}
							<!-- Voice Message -->
							{@const audioUrl = extractAudioUrl(message.content)}
							{#if audioUrl}
								<div class="flex flex-col gap-1">
									<VoiceMessage url={audioUrl} />
									<div
										class="flex items-center justify-end gap-1 text-xs text-muted-foreground"
									>
										{#if message.protocol === 'nip17'}
											<span title="Private (NIP-17)">
												<ShieldCheck class="h-3 w-3 text-green-500" />
											</span>
										{:else if message.protocol === 'nip04'}
											<span title="Encrypted (NIP-04)">
												<Lock class="h-3 w-3 opacity-50" />
											</span>
										{/if}
										<span>{formatRelativeTime(message.created_at)}</span>
									</div>
								</div>
							{/if}
						{:else}
							<!-- Regular Message -->
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
								{:else if isEmptyMessage(message.content)}
									<div
										class="flex items-center gap-2 text-sm text-muted-foreground italic"
									>
										<span>Empty message</span>
									</div>
								{:else}
									<p
										class="whitespace-pre-wrap wrap-break-words break-all"
									>
										{message.content}
									</p>
								{/if}
								<div
									class="mt-1 flex items-center justify-end gap-1 text-xs {(
										message.isOutgoing
									) ?
										'text-primary-foreground/70'
									:	'text-muted-foreground'}"
								>
									{#if message.protocol === 'nip17'}
										<span title="Private (NIP-17)">
											<ShieldCheck class="h-3 w-3 text-green-500" />
										</span>
									{:else if message.protocol === 'nip04'}
										<span title="Encrypted (NIP-04)">
											<Lock class="h-3 w-3 opacity-50" />
										</span>
									{/if}
									<span>{formatRelativeTime(message.created_at)}</span>
								</div>
							</div>
						{/if}
					</div>
				{/each}
			</div>

			<!-- Input -->
			<div class="border-t border-border bg-background p-4">
				<div class="flex items-end gap-2">
					<!-- eCash button -->
					{#if hasCashuBalance}
						<Button
							variant="ghost"
							size="icon"
							class="shrink-0 text-amber-500 hover:text-amber-600 hover:bg-amber-500/10"
							onclick={() => showSendCashu = true}
							title="Send eCash"
						>
							<Coins class="h-5 w-5" />
						</Button>
					{/if}

					<!-- Voice recorder -->
					{#if isUploadingVoice}
						<div class="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5">
							<Spinner size="sm" />
							<span class="text-sm text-muted-foreground">Uploading...</span>
						</div>
					{:else}
						<VoiceRecorder
							onRecorded={handleVoiceRecorded}
							maxDuration={60}
						/>
					{/if}

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
				<EmptyState
					icon={MessageSquare}
					title="Private Messages"
					description="Select a conversation from the list or start a new encrypted chat"
					variant="muted"
					size="lg"
				/>
			</div>
		{/if}
	</div>
</div>

<!-- Send eCash Modal -->
<SendCashuModal
	bind:open={showSendCashu}
	onSend={handleSendCashu}
	onClose={() => showSendCashu = false}
/>
