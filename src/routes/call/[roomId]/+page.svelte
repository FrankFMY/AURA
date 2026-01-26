<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { callsStore } from '$stores/calls.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { ActiveCall } from '$components/calls';
	import { EmptyState } from '$components/ui/empty-state';
	import PhoneOff from 'lucide-svelte/icons/phone-off';

	const roomId = $derived($page.params.roomId);
	const activeCall = $derived(callsStore.activeCall);

	// Check if we have an active call matching this room
	const hasValidCall = $derived(
		activeCall !== null && activeCall.roomId === roomId
	);

	async function handleEnd() {
		await callsStore.endCall();
		goto('/messages');
	}

	// Redirect if no valid call
	$effect(() => {
		if (!authStore.isAuthenticated) {
			goto('/login');
		}
	});
</script>

<svelte:head>
	<title>Call | AURA</title>
</svelte:head>

{#if hasValidCall && activeCall}
	<ActiveCall
		call={activeCall}
		onEnd={handleEnd}
	/>
{:else}
	<div class="h-screen flex items-center justify-center bg-background">
		<EmptyState
			icon={PhoneOff}
			title="No active call"
			description="The call has ended or is not available."
			variant="muted"
			size="lg"
			actionLabel="Return to Messages"
			onAction={() => goto('/messages')}
		/>
	</div>
{/if}
