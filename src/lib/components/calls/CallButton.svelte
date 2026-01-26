<script lang="ts">
	import { callsStore, type CallType } from '$stores/calls.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { goto } from '$app/navigation';
	import { Button } from '$components/ui/button';
	import Phone from 'lucide-svelte/icons/phone';
	import Video from 'lucide-svelte/icons/video';
	import Loader2 from 'lucide-svelte/icons/loader-2';

	interface Props {
		pubkey: string;
		variant?: 'default' | 'outline' | 'ghost';
		size?: 'default' | 'sm' | 'lg' | 'icon';
		showLabel?: boolean;
		callType?: CallType;
	}

	let {
		pubkey,
		variant = 'outline',
		size = 'default',
		showLabel = true,
		callType = 'video'
	}: Props = $props();

	let isStarting = $state(false);

	const canCall = $derived(
		authStore.isAuthenticated &&
		authStore.pubkey !== pubkey &&
		!callsStore.isInCall
	);

	async function handleCall() {
		if (!canCall || isStarting) return;

		isStarting = true;

		try {
			const roomId = await callsStore.startCall(pubkey, callType);
			if (roomId) {
				goto(`/call/${roomId}`);
			}
		} catch (e) {
			console.error('Failed to start call:', e);
		} finally {
			isStarting = false;
		}
	}
</script>

<Button
	{variant}
	{size}
	onclick={handleCall}
	disabled={!canCall || isStarting}
	class="gap-2"
>
	{#if isStarting}
		<Loader2 class="h-4 w-4 animate-spin" />
	{:else if callType === 'video'}
		<Video class="h-4 w-4" />
	{:else}
		<Phone class="h-4 w-4" />
	{/if}
	{#if showLabel}
		{callType === 'video' ? 'Video Call' : 'Call'}
	{/if}
</Button>
