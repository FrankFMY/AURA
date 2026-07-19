<script lang="ts">
	import { ArrowRight, MessageCircle, Plus, Wifi, WifiOff } from 'lucide-svelte';

	export interface ChatSummary {
		pubkey: string;
		label: string;
		lastAt: number;
		unread: number;
	}

	type ConnectionState = 'connecting' | 'online' | 'offline';

	interface Props {
		activeConversation: string;
		chats: ChatSummary[];
		connection: ConnectionState;
		newChatOpen: boolean;
		contactInput: string;
		contactError: string;
		contactInputElement?: HTMLTextAreaElement;
		onOpenNewChat: () => void | Promise<void>;
		onCancelNewChat: () => void;
		onBeginChat: () => void | Promise<void>;
		onOpenConversation: (pubkey: string) => void | Promise<void>;
	}

	let {
		activeConversation,
		chats,
		connection,
		newChatOpen,
		contactInput = $bindable(),
		contactError,
		contactInputElement = $bindable(),
		onOpenNewChat,
		onCancelNewChat,
		onBeginChat,
		onOpenConversation
	}: Props = $props();
</script>

<section class="chat-list-pane" class:hidden-mobile={Boolean(activeConversation)}>
	<header class="pane-header">
		<div>
			<p class="eyebrow">AURA</p>
			<h1>Chats</h1>
		</div>
		<button class="icon-button" aria-label="New chat" onclick={() => void onOpenNewChat()}>
			<Plus size={20} />
		</button>
	</header>
	<div class="connection-pill" class:offline={connection === 'offline'}>
		{#if connection === 'online'}
			<Wifi size={14} /> Private relays connected
		{:else if connection === 'connecting'}
			<span class="pulse"></span> Connecting private relays
		{:else}
			<WifiOff size={14} /> Working offline
		{/if}
	</div>
	{#if newChatOpen}
		<form
			class="new-chat-inline"
			onsubmit={(event) => {
				event.preventDefault();
				void onBeginChat();
			}}
		>
			<div class="new-chat-inline-heading">
				<div>
					<strong>Start a private chat</strong>
					<p>Paste an <span class="mono">npub</span> or lowercase public key.</p>
				</div>
				<button type="button" class="text-button" onclick={onCancelNewChat}>Cancel</button>
			</div>
			<label>
				<span>Contact identifier</span>
				<textarea
					bind:this={contactInputElement}
					bind:value={contactInput}
					rows="3"
					autocapitalize="none"
					autocomplete="off"
					spellcheck="false"
					placeholder="npub1…"></textarea>
			</label>
			{#if contactError}<div class="inline-error" role="alert">{contactError}</div>{/if}
			<button class="button primary full" type="submit">
				Open conversation <ArrowRight size={18} />
			</button>
		</form>
	{:else if chats.length === 0}
		<div class="empty-list">
			<div class="quiet-orbit"><MessageCircle size={24} /></div>
			<h2>Your quiet inbox</h2>
			<p>Start with an <span>npub</span> or open a signed invitation.</p>
			<button class="button secondary" onclick={() => void onOpenNewChat()}>
				Start a conversation
			</button>
		</div>
	{:else}
		<div class="chat-items">
			{#each chats as chat}
				<button
					class="chat-item"
					class:active={activeConversation === chat.pubkey}
					onclick={() => void onOpenConversation(chat.pubkey)}
				>
					<span class="avatar">{chat.pubkey.slice(0, 2).toUpperCase()}</span>
					<span class="chat-meta">
						<strong>{chat.label}</strong>
						<small>Private conversation</small>
					</span>
					<time>
						{new Date(chat.lastAt * 1000).toLocaleDateString([], {
							month: 'short',
							day: 'numeric'
						})}
					</time>
				</button>
			{/each}
		</div>
	{/if}
</section>
