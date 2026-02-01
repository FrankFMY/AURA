<script lang="ts">
	import { callsStore, isCallInvite, isCallResponse, isWebRTCSignal } from '$stores/calls.svelte';
	import { messagesStore } from '$stores/messages.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { browser } from '$app/environment';
	import IncomingCall from './IncomingCall.svelte';
	import ActiveCall from './ActiveCall.svelte';

	// Dev-only logging
	const debug = (...args: unknown[]) => {
		if (import.meta.env.DEV) {
			console.log('[CallProvider]', ...args);
		}
	};

	// Subscribe to incoming messages for call invites and WebRTC signals
	// Load from localStorage to persist across page refreshes
	let processedMessageIds = new Set<string>(loadProcessedIds());

	function loadProcessedIds(): string[] {
		if (!browser) return [];
		try {
			const stored = localStorage.getItem('aura-processed-call-messages');
			if (stored) {
				const ids = JSON.parse(stored);
				// Keep only last 100 IDs
				return Array.isArray(ids) ? ids.slice(-100) : [];
			}
		} catch (e) {
			console.error('[CallProvider] Failed to load processed IDs:', e);
		}
		return [];
	}

	function saveProcessedIds(): void {
		if (!browser) return;
		try {
			const ids = Array.from(processedMessageIds).slice(-100);
			localStorage.setItem('aura-processed-call-messages', JSON.stringify(ids));
		} catch (e) {
			console.error('[CallProvider] Failed to save processed IDs:', e);
		}
	}

	// Watch for new messages that might be call invites or WebRTC signals
	$effect(() => {
		if (!authStore.isAuthenticated) return;

		// Check all conversations for new messages
		const conversations = messagesStore.conversations;

		for (const conv of conversations) {
			// Get messages from conversation
			const messages = conv.messages || [];

			// Process recent messages (last 10) to catch signals
			const recentMessages = messages.slice(-10);

			for (const message of recentMessages) {
				if (processedMessageIds.has(message.id)) {
					continue;
				}

				// Skip messages from self
				if (message.pubkey === authStore.pubkey) {
					processedMessageIds.add(message.id);
					continue;
				}

				// Check if it's a WebRTC signal (highest priority)
				const signal = isWebRTCSignal(message.content);
				if (signal) {
					debug('Received WebRTC signal:', signal.signalType, 'room:', signal.roomId);
					processedMessageIds.add(message.id);
					callsStore.handleWebRTCSignal(signal);
					continue;
				}

				// Check if it's a call invite
				const invite = isCallInvite(message.content);
				if (invite) {
					processedMessageIds.add(message.id);
					callsStore.handleIncomingCall(message.pubkey, invite, message.created_at);
					continue;
				}

				// Check if it's a call response
				const response = isCallResponse(message.content);
				if (response) {
					processedMessageIds.add(message.id);
					callsStore.handleCallResponse(message.pubkey, response);
					continue;
				}

				processedMessageIds.add(message.id);
			}
		}

		// Cleanup old processed IDs and save to localStorage
		if (processedMessageIds.size > 200) {
			const ids = Array.from(processedMessageIds);
			processedMessageIds = new Set(ids.slice(-100));
		}
		saveProcessedIds();
	});

	const incomingCall = $derived(callsStore.incomingCall);
	const activeCall = $derived(callsStore.activeCall);

	async function handleAccept() {
		await callsStore.acceptCall();
	}

	async function handleDecline() {
		await callsStore.declineCall();
	}

	async function handleEndCall() {
		await callsStore.endCall();
	}
</script>

<!-- Incoming call overlay -->
{#if incomingCall}
	<IncomingCall
		call={incomingCall}
		onAccept={handleAccept}
		onDecline={handleDecline}
	/>
{/if}

<!-- Active call overlay -->
{#if activeCall}
	<ActiveCall
		call={activeCall}
		onEnd={handleEndCall}
	/>
{/if}
