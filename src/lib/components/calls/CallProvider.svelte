<script lang="ts">
	import { callsStore, isCallInvite, isCallResponse } from '$stores/calls.svelte';
	import { messagesStore } from '$stores/messages.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { goto } from '$app/navigation';
	import IncomingCall from './IncomingCall.svelte';

	// Subscribe to incoming messages for call invites
	let processedMessageIds = new Set<string>();

	// Watch for new messages that might be call invites
	$effect(() => {
		if (!authStore.isAuthenticated) return;

		// Check all conversations for new messages
		const conversations = messagesStore.conversations;

		for (const conv of conversations) {
			// Get messages from conversation
			const messages = conv.messages || [];
			const latestMessage = messages[messages.length - 1];

			if (!latestMessage || processedMessageIds.has(latestMessage.id)) {
				continue;
			}

			// Skip messages from self
			if (latestMessage.pubkey === authStore.pubkey) {
				processedMessageIds.add(latestMessage.id);
				continue;
			}

			// Check if it's a call invite
			const invite = isCallInvite(latestMessage.content);
			if (invite) {
				processedMessageIds.add(latestMessage.id);
				callsStore.handleIncomingCall(latestMessage.pubkey, invite);
				continue;
			}

			// Check if it's a call response
			const response = isCallResponse(latestMessage.content);
			if (response) {
				processedMessageIds.add(latestMessage.id);
				callsStore.handleCallResponse(latestMessage.pubkey, response);
			}

			processedMessageIds.add(latestMessage.id);
		}

		// Cleanup old processed IDs (keep last 100)
		if (processedMessageIds.size > 200) {
			const ids = Array.from(processedMessageIds);
			processedMessageIds = new Set(ids.slice(-100));
		}
	});

	const incomingCall = $derived(callsStore.incomingCall);

	async function handleAccept() {
		const roomId = await callsStore.acceptCall();
		if (roomId) {
			goto(`/call/${roomId}`);
		}
	}

	async function handleDecline() {
		await callsStore.declineCall();
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
