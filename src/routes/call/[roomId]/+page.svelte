<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { callsStore } from '$stores/calls.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { EmptyState } from '$components/ui/empty-state';
	import PhoneOff from 'lucide-svelte/icons/phone-off';
	import { onMount } from 'svelte';

	const roomId = $derived($page.params.roomId);
	const activeCall = $derived(callsStore.activeCall);

	// Check if we have an active call matching this room
	const hasValidCall = $derived(
		activeCall !== null && activeCall.roomId === roomId
	);

	// Redirect if no valid call (call UI is handled by CallProvider overlay)
	onMount(() => {
		if (!authStore.isAuthenticated) {
			goto('/login');
			return;
		}

		// If there's an active call, the overlay handles it
		// If no active call for this room, show empty state
	});
</script>

<svelte:head>
	<title>Call | AURA</title>
</svelte:head>

<!-- Call UI is handled by CallProvider overlay -->
<!-- This page just shows empty state if call ended -->
{#if !hasValidCall}
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
