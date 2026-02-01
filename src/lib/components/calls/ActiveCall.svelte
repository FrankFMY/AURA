<script lang="ts">
	import { callsStore, type ActiveCall } from '$stores/calls.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import Phone from 'lucide-svelte/icons/phone';
	import PhoneOff from 'lucide-svelte/icons/phone-off';
	import Video from 'lucide-svelte/icons/video';
	import VideoOff from 'lucide-svelte/icons/video-off';
	import Mic from 'lucide-svelte/icons/mic';
	import MicOff from 'lucide-svelte/icons/mic-off';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	import { onMount, onDestroy } from 'svelte';

	// Dev-only logging
	const debug = (...args: unknown[]) => {
		if (import.meta.env.DEV) {
			console.log('[ActiveCall]', ...args);
		}
	};

	interface Props {
		call: ActiveCall;
		onEnd: () => void;
	}

	let { call, onEnd }: Props = $props();

	let localVideoEl = $state<HTMLVideoElement | null>(null);
	let remoteVideoEl = $state<HTMLVideoElement | null>(null);
	let remoteAudioEl = $state<HTMLAudioElement | null>(null);
	let callDuration = $state('0:00');
	let durationInterval: ReturnType<typeof setInterval> | null = null;

	const isMuted = $derived(callsStore.isMuted);
	const isVideoEnabled = $derived(callsStore.isVideoEnabled);
	const localStream = $derived(callsStore.localStream);
	const remoteStream = $derived(callsStore.remoteStream);

	const peerName = $derived(
		call.peerProfile?.name ||
		call.peerProfile?.display_name ||
		call.peerPubkey.slice(0, 8) + '...'
	);

	const isConnected = $derived(call.status === 'connected');
	const isConnecting = $derived(call.status === 'connecting' || call.status === 'ringing');

	onMount(() => {
		startDurationTimer();
	});

	onDestroy(() => {
		if (durationInterval) {
			clearInterval(durationInterval);
		}
	});

	// Attach local stream to video element
	$effect(() => {
		if (localVideoEl && localStream) {
			localVideoEl.srcObject = localStream;
		}
	});

	// Attach remote stream to video element
	$effect(() => {
		if (remoteVideoEl && remoteStream) {
			remoteVideoEl.srcObject = remoteStream;
		}
	});

	// Attach remote stream to audio element (for audio calls)
	$effect(() => {
		if (remoteAudioEl && remoteStream) {
			debug('Attaching remote stream to audio element');
			remoteAudioEl.srcObject = remoteStream;
			// Ensure playback starts
			remoteAudioEl.play().catch(e => {
				console.error('[ActiveCall] Failed to play audio:', e);
			});
		}
	});

	function startDurationTimer() {
		const startTime = call.connectedAt || Date.now();
		durationInterval = setInterval(() => {
			if (call.status === 'connected') {
				const elapsed = Date.now() - (call.connectedAt || startTime);
				callDuration = callsStore.formatDuration(elapsed);
			}
		}, 1000);
	}

	function handleToggleMute() {
		callsStore.toggleMute();
	}

	function handleToggleVideo() {
		callsStore.toggleVideo();
	}

	function handleHangup() {
		onEnd();
	}
</script>

<div class="fixed inset-0 z-100 flex flex-col bg-black">
	<!-- Hidden audio element for remote stream playback -->
	<audio
		bind:this={remoteAudioEl}
		autoplay
		playsinline
		class="hidden"
	></audio>

	<!-- Remote video (full screen) -->
	{#if call.callType === 'video'}
		<div class="absolute inset-0">
			{#if remoteStream}
				<video
					bind:this={remoteVideoEl}
					autoplay
					playsinline
					class="w-full h-full object-cover"
				></video>
			{:else}
				<div class="w-full h-full flex items-center justify-center bg-linear-to-b from-slate-900 to-black">
					<div class="text-center">
						<Avatar size="xl" class="mx-auto mb-4 w-32 h-32">
							{#if call.peerProfile?.picture}
								<AvatarImage src={call.peerProfile.picture} alt={peerName} />
							{/if}
							<AvatarFallback class="text-4xl bg-primary/20 text-primary">
								{peerName.slice(0, 2).toUpperCase()}
							</AvatarFallback>
						</Avatar>
						{#if isConnecting}
							<Loader2 class="h-8 w-8 text-white/60 animate-spin mx-auto" />
						{/if}
					</div>
				</div>
			{/if}
		</div>

		<!-- Local video (picture-in-picture) -->
		{#if localStream && isVideoEnabled}
			<div class="absolute top-20 right-4 w-32 h-44 rounded-2xl overflow-hidden shadow-2xl border-2 border-white/20 z-10">
				<video
					bind:this={localVideoEl}
					autoplay
					playsinline
					muted
					class="w-full h-full object-cover mirror"
				></video>
			</div>
		{/if}
	{:else}
		<!-- Audio call - show avatar -->
		<div class="absolute inset-0 flex items-center justify-center bg-linear-to-b from-slate-900 to-black">
			<div class="text-center">
				<div class="relative">
					<Avatar size="xl" class="mx-auto mb-6 w-40 h-40">
						{#if call.peerProfile?.picture}
							<AvatarImage src={call.peerProfile.picture} alt={peerName} />
						{/if}
						<AvatarFallback class="text-5xl bg-primary/20 text-primary">
							{peerName.slice(0, 2).toUpperCase()}
						</AvatarFallback>
					</Avatar>
					{#if isConnected}
						<div class="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 px-3 py-1 rounded-full bg-green-500/20 border border-green-500/30">
							<div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
							<span class="text-xs text-green-400">Connected</span>
						</div>
					{/if}
				</div>
				<h2 class="text-2xl font-semibold text-white mt-4">{peerName}</h2>
				{#if isConnecting}
					<div class="flex items-center justify-center gap-2 mt-2">
						<Loader2 class="h-4 w-4 text-white/60 animate-spin" />
						<span class="text-white/60">
							{call.status === 'ringing' ? 'Calling...' : 'Connecting...'}
						</span>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Header overlay -->
	<div class="absolute top-0 left-0 right-0 z-20 p-4 bg-linear-to-b from-black/60 to-transparent">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				{#if call.callType === 'video'}
					<Avatar size="sm">
						{#if call.peerProfile?.picture}
							<AvatarImage src={call.peerProfile.picture} alt={peerName} />
						{/if}
						<AvatarFallback class="text-xs">
							{peerName.slice(0, 2).toUpperCase()}
						</AvatarFallback>
					</Avatar>
				{/if}
				<div>
					<p class="text-white font-medium">{peerName}</p>
					<p class="text-white/60 text-sm">
						{#if isConnecting}
							{call.status === 'ringing' ? 'Calling...' : 'Connecting...'}
						{:else if isConnected}
							{callDuration}
						{/if}
					</p>
				</div>
			</div>

			<div class="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/10">
				{#if call.callType === 'video'}
					<Video class="h-4 w-4 text-white" />
				{:else}
					<Phone class="h-4 w-4 text-white" />
				{/if}
				<span class="text-white text-sm">
					{call.callType === 'video' ? 'Video' : 'Audio'}
				</span>
			</div>
		</div>
	</div>

	<!-- Controls overlay -->
	<div class="absolute bottom-0 left-0 right-0 z-20 p-8 bg-linear-to-t from-black/80 to-transparent">
		<div class="flex items-center justify-center gap-6">
			<!-- Mute button -->
			<button
				class="w-16 h-16 rounded-full flex items-center justify-center transition-all
					{isMuted ? 'bg-red-500 scale-110' : 'bg-white/20 hover:bg-white/30'}"
				onclick={handleToggleMute}
				title={isMuted ? 'Unmute' : 'Mute'}
			>
				{#if isMuted}
					<MicOff class="h-7 w-7 text-white" />
				{:else}
					<Mic class="h-7 w-7 text-white" />
				{/if}
			</button>

			<!-- Video toggle (only for video calls) -->
			{#if call.callType === 'video'}
				<button
					class="w-16 h-16 rounded-full flex items-center justify-center transition-all
						{!isVideoEnabled ? 'bg-red-500 scale-110' : 'bg-white/20 hover:bg-white/30'}"
					onclick={handleToggleVideo}
					title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
				>
					{#if isVideoEnabled}
						<Video class="h-7 w-7 text-white" />
					{:else}
						<VideoOff class="h-7 w-7 text-white" />
					{/if}
				</button>
			{/if}

			<!-- Hang up -->
			<button
				class="w-20 h-20 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center transition-all hover:scale-105 shadow-lg shadow-red-500/30"
				onclick={handleHangup}
				title="End call"
			>
				<PhoneOff class="h-8 w-8 text-white" />
			</button>
		</div>
	</div>
</div>

<style>
	.mirror {
		transform: scaleX(-1);
	}
</style>
