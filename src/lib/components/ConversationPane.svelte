<script lang="ts">
	import { ChevronLeft, LockKeyhole, MessageCircle, Send } from 'lucide-svelte';

	interface MessageView {
		rumorId: string;
		direction: 'incoming' | 'outgoing';
		content: string;
		createdAt: number;
		stateLabel: string;
	}

	interface Props {
		activeConversation: string;
		conversationLabel: string;
		messages: MessageView[];
		unseenBelow: number;
		error: string;
		sendBusy: boolean;
		mobileComposer: boolean;
		composer: string;
		composerInput?: HTMLTextAreaElement;
		messageSpace?: HTMLDivElement;
		onBack: () => void;
		onScroll: () => void;
		onRevealLatest: () => void;
		onSend: () => void | Promise<void>;
		onComposerInput: (value: string, element: HTMLTextAreaElement) => void;
		onComposerKeydown: (event: KeyboardEvent) => void;
	}

	let {
		activeConversation,
		conversationLabel,
		messages,
		unseenBelow,
		error,
		sendBusy,
		mobileComposer,
		composer = $bindable(),
		composerInput = $bindable(),
		messageSpace = $bindable(),
		onBack,
		onScroll,
		onRevealLatest,
		onSend,
		onComposerInput,
		onComposerKeydown
	}: Props = $props();
</script>

<section class="conversation-pane" class:hidden-mobile={!activeConversation}>
	{#if activeConversation}
		<header class="conversation-header">
			<button class="mobile-back" aria-label="Back to chats" onclick={onBack}>
				<ChevronLeft size={21} />
			</button>
			<span class="avatar small">{activeConversation.slice(0, 2).toUpperCase()}</span>
			<div>
				<strong>{conversationLabel}</strong>
				<small>Private relay routing</small>
			</div>
		</header>
		<div class="message-space" bind:this={messageSpace} onscroll={onScroll} aria-live="polite">
			{#if messages.length === 0}
				<div class="conversation-empty">
					<LockKeyhole size={24} />
					<h2>A private beginning</h2>
					<p>Messages appear here only after encryption and durable local persistence.</p>
				</div>
			{:else}
				<div class="message-stack">
					{#each messages as message (message.rumorId)}
						<article class="bubble" class:mine={message.direction === 'outgoing'}>
							<p>{message.content}</p>
							<footer>
								<time>
									{new Date(message.createdAt * 1000).toLocaleTimeString([], {
										hour: '2-digit',
										minute: '2-digit'
									})}
								</time>
								<span>{message.stateLabel}</span>
							</footer>
						</article>
					{/each}
				</div>
			{/if}
		</div>
		{#if unseenBelow > 0}
			<button class="new-message-chip" onclick={onRevealLatest}>
				{unseenBelow} new {unseenBelow === 1 ? 'message' : 'messages'}
			</button>
		{/if}
		{#if error}<div class="composer-error" role="alert">{error}</div>{/if}
		<form
			class="composer"
			aria-busy={sendBusy}
			onsubmit={(event) => {
				event.preventDefault();
				void onSend();
			}}
		>
			<textarea
				bind:this={composerInput}
				bind:value={composer}
				rows="1"
				maxlength="16384"
				enterkeyhint={mobileComposer ? 'enter' : 'send'}
				placeholder="Write a message"
				aria-label="Message"
				oninput={(event) => onComposerInput(event.currentTarget.value, event.currentTarget)}
				onkeydown={onComposerKeydown}></textarea>
			<button
				type="submit"
				aria-label="Send message"
				disabled={sendBusy || !composer.trim()}
				onpointerdown={(event) => event.preventDefault()}
			>
				<Send size={19} />
			</button>
		</form>
	{:else}
		<div class="desktop-empty">
			<div class="quiet-orbit large"><MessageCircle size={28} /></div>
			<h2>Choose a conversation</h2>
			<p>Your private messages will open here.</p>
		</div>
	{/if}
</section>
