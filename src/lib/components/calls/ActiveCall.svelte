<script lang="ts">
	import { callsStore, type ActiveCall } from '$stores/calls.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import Phone from 'lucide-svelte/icons/phone';
	import PhoneOff from 'lucide-svelte/icons/phone-off';
	import Video from 'lucide-svelte/icons/video';
	import ExternalLink from 'lucide-svelte/icons/external-link';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	import { onMount, onDestroy } from 'svelte';

	interface Props {
		call: ActiveCall;
		onEnd: () => void;
	}

	let { call, onEnd }: Props = $props();

	let callDuration = $state('0:00');
	let durationInterval: ReturnType<typeof setInterval> | null = null;
	let jitsiWindow: Window | null = null;
	let windowCheckInterval: ReturnType<typeof setInterval> | null = null;

	const peerName = $derived(
		call.peerProfile?.name ||
		call.peerProfile?.display_name ||
		call.peerPubkey.slice(0, 8) + '...'
	);

	const jitsiUrl = $derived(callsStore.getJitsiUrl(call.roomId));

	onMount(() => {
		// Mark as connected immediately since we're opening in new tab
		if (call.status === 'connecting' || call.status === 'ringing') {
			callsStore.markConnected();
		}
		startDurationTimer();

		// Open Jitsi in new tab automatically
		openJitsiWindow();

		// Check if window was closed
		windowCheckInterval = setInterval(() => {
			if (jitsiWindow && jitsiWindow.closed) {
				console.log('[Call] Jitsi window was closed');
				jitsiWindow = null;
				// Don't auto-end - user might want to reopen
			}
		}, 1000);
	});

	onDestroy(() => {
		if (durationInterval) {
			clearInterval(durationInterval);
		}
		if (windowCheckInterval) {
			clearInterval(windowCheckInterval);
		}
		// Close Jitsi window when component unmounts
		if (jitsiWindow && !jitsiWindow.closed) {
			jitsiWindow.close();
		}
	});

	function startDurationTimer() {
		const startTime = call.connectedAt || Date.now();
		durationInterval = setInterval(() => {
			const elapsed = Date.now() - startTime;
			callDuration = callsStore.formatDuration(elapsed);
		}, 1000);
	}

	function openJitsiWindow() {
		// Build URL with display name
		const displayName = authStore.displayName || 'Anonymous';
		const urlWithParams = `${jitsiUrl}#userInfo.displayName="${encodeURIComponent(displayName)}"`;

		jitsiWindow = window.open(
			urlWithParams,
			'jitsi_call',
			'width=800,height=600,menubar=no,toolbar=no,location=no,status=no'
		);

		if (!jitsiWindow) {
			console.warn('[Call] Could not open Jitsi window - popup blocked?');
		}
	}

	function handleHangup() {
		if (jitsiWindow && !jitsiWindow.closed) {
			jitsiWindow.close();
		}
		onEnd();
	}

	function handleReopenJitsi() {
		if (jitsiWindow && !jitsiWindow.closed) {
			jitsiWindow.focus();
		} else {
			openJitsiWindow();
		}
	}
</script>

<div class="fixed inset-0 z-[100] flex flex-col bg-gradient-to-b from-slate-900 to-black">
	<!-- Header -->
	<div class="p-6">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-4">
				<Avatar size="lg">
					{#if call.peerProfile?.picture}
						<AvatarImage src={call.peerProfile.picture} alt={peerName} />
					{/if}
					<AvatarFallback class="text-lg bg-primary/20 text-primary">
						{peerName.slice(0, 2).toUpperCase()}
					</AvatarFallback>
				</Avatar>
				<div>
					<h2 class="text-xl font-semibold text-white">{peerName}</h2>
					<p class="text-white/60">
						{#if call.status === 'connected'}
							{callDuration}
						{:else}
							Connecting...
						{/if}
					</p>
				</div>
			</div>

			<div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10">
				{#if call.callType === 'video'}
					<Video class="h-4 w-4 text-white" />
					<span class="text-white text-sm">Video Call</span>
				{:else}
					<Phone class="h-4 w-4 text-white" />
					<span class="text-white text-sm">Voice Call</span>
				{/if}
			</div>
		</div>
	</div>

	<!-- Main content -->
	<div class="flex-1 flex flex-col items-center justify-center p-8">
		<div class="text-center max-w-md">
			<div class="mb-8">
				<div class="w-32 h-32 mx-auto rounded-full bg-primary/20 flex items-center justify-center mb-6">
					{#if call.callType === 'video'}
						<Video class="h-16 w-16 text-primary" />
					{:else}
						<Phone class="h-16 w-16 text-primary" />
					{/if}
				</div>

				<h3 class="text-2xl font-semibold text-white mb-2">Call in Progress</h3>
				<p class="text-white/60 mb-4">
					The video call is open in a separate window.
				</p>
			</div>

			<div class="bg-white/5 rounded-2xl p-6 mb-8">
				<p class="text-sm text-white/80 mb-4">
					If the video window didn't open or was closed, click the button below to open it again.
				</p>
				<Button
					variant="outline"
					class="w-full border-white/20 text-white hover:bg-white/10"
					onclick={handleReopenJitsi}
				>
					<ExternalLink class="h-4 w-4 mr-2" />
					Open Video Window
				</Button>
			</div>

			<p class="text-xs text-white/40 mb-8">
				Room: {call.roomId}
			</p>
		</div>
	</div>

	<!-- End call button -->
	<div class="p-6 flex justify-center">
		<button
			class="w-20 h-20 rounded-full bg-destructive hover:bg-destructive/90 flex items-center justify-center transition-colors shadow-lg shadow-destructive/30"
			onclick={handleHangup}
			title="End call"
		>
			<PhoneOff class="h-8 w-8 text-white" />
		</button>
	</div>
</div>
