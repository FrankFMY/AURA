<script lang="ts">
	import { callsStore, type ActiveCall } from '$stores/calls.svelte';
	import { jitsiService } from '$services/calls/jitsi';
	import { authStore } from '$stores/auth.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import Phone from 'lucide-svelte/icons/phone';
	import PhoneOff from 'lucide-svelte/icons/phone-off';
	import Video from 'lucide-svelte/icons/video';
	import VideoOff from 'lucide-svelte/icons/video-off';
	import Mic from 'lucide-svelte/icons/mic';
	import MicOff from 'lucide-svelte/icons/mic-off';
	import Monitor from 'lucide-svelte/icons/monitor';
	import Maximize from 'lucide-svelte/icons/maximize';
	import MessageSquare from 'lucide-svelte/icons/message-square';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	import { onMount, onDestroy } from 'svelte';

	interface Props {
		call: ActiveCall;
		onEnd: () => void;
	}

	let { call, onEnd }: Props = $props();

	let jitsiContainer: HTMLDivElement;
	let isInitializing = $state(true);
	let error = $state<string | null>(null);
	let callDuration = $state('0:00');
	let durationInterval: ReturnType<typeof setInterval> | null = null;
	let initTimeoutId: ReturnType<typeof setTimeout> | null = null;

	const isMuted = $derived(callsStore.isMuted);
	const isVideoEnabled = $derived(callsStore.isVideoEnabled);

	const peerName = $derived(
		call.peerProfile?.name ||
		call.peerProfile?.display_name ||
		call.peerPubkey.slice(0, 8) + '...'
	);

	onMount(async () => {
		try {
			// Set a fallback timeout - if videoConferenceJoined doesn't fire in 15 seconds,
			// assume we're connected anyway (Jitsi might be working but event not firing)
			initTimeoutId = setTimeout(() => {
				if (isInitializing) {
					console.warn('[Call] Timeout waiting for videoConferenceJoined, assuming connected');
					isInitializing = false;
					callsStore.markConnected();
					startDurationTimer();
				}
			}, 15000);

			await jitsiService.initCall({
				roomName: call.roomId,
				displayName: authStore.displayName || 'Anonymous',
				avatarUrl: authStore.avatar || undefined,
				startWithVideoMuted: call.callType === 'audio',
				startWithAudioMuted: false,
				parentNode: jitsiContainer,
				onVideoConferenceJoined: () => {
					console.log('[Call] videoConferenceJoined callback fired');
					if (initTimeoutId) {
						clearTimeout(initTimeoutId);
						initTimeoutId = null;
					}
					isInitializing = false;
					callsStore.markConnected();
					startDurationTimer();
				},
				onVideoConferenceLeft: () => {
					console.log('[Call] videoConferenceLeft callback fired');
					onEnd();
				},
				onParticipantJoined: (data) => {
					console.log('[Call] Participant joined:', data);
				},
				onParticipantLeft: (data) => {
					console.log('[Call] Participant left:', data);
				},
				onAudioMuteStatusChanged: (data) => {
					if (data.muted !== isMuted) {
						callsStore.toggleMute();
					}
				},
				onVideoMuteStatusChanged: (data) => {
					if (data.muted === isVideoEnabled) {
						callsStore.toggleVideo();
					}
				}
			});
		} catch (e) {
			console.error('[Call] Failed to initialize Jitsi:', e);
			error = 'Failed to start video call. Please try again.';
			isInitializing = false;
			if (initTimeoutId) {
				clearTimeout(initTimeoutId);
				initTimeoutId = null;
			}
		}
	});

	onDestroy(() => {
		jitsiService.dispose();
		if (durationInterval) {
			clearInterval(durationInterval);
		}
		if (initTimeoutId) {
			clearTimeout(initTimeoutId);
		}
	});

	function startDurationTimer() {
		const startTime = call.connectedAt || Date.now();
		durationInterval = setInterval(() => {
			const elapsed = Date.now() - startTime;
			callDuration = callsStore.formatDuration(elapsed);
		}, 1000);
	}

	function handleToggleMute() {
		jitsiService.toggleAudio();
		callsStore.toggleMute();
	}

	function handleToggleVideo() {
		jitsiService.toggleVideo();
		callsStore.toggleVideo();
	}

	function handleShareScreen() {
		jitsiService.toggleShareScreen();
	}

	function handleToggleChat() {
		jitsiService.toggleChat();
	}

	function handleHangup() {
		jitsiService.hangup();
		onEnd();
	}
</script>

<div class="fixed inset-0 z-[100] flex flex-col bg-black">
	<!-- Header -->
	<div class="absolute top-0 left-0 right-0 z-10 p-4 bg-gradient-to-b from-black/80 to-transparent">
		<div class="flex items-center justify-between">
			<div class="flex items-center gap-3">
				<Avatar size="sm">
					{#if call.peerProfile?.picture}
						<AvatarImage src={call.peerProfile.picture} alt={peerName} />
					{/if}
					<AvatarFallback class="text-xs">
						{peerName.slice(0, 2).toUpperCase()}
					</AvatarFallback>
				</Avatar>
				<div>
					<p class="text-white font-medium">{peerName}</p>
					<p class="text-white/60 text-sm">
						{#if call.status === 'connecting'}
							Connecting...
						{:else if call.status === 'connected'}
							{callDuration}
						{:else}
							{call.callType === 'video' ? 'Video Call' : 'Voice Call'}
						{/if}
					</p>
				</div>
			</div>

			{#if call.callType === 'video'}
				<div class="flex items-center gap-1 px-2 py-1 rounded bg-white/10">
					<Video class="h-4 w-4 text-white" />
					<span class="text-white text-xs">HD</span>
				</div>
			{/if}
		</div>
	</div>

	<!-- Jitsi container -->
	<div
		bind:this={jitsiContainer}
		class="flex-1 w-full h-full"
	>
		{#if isInitializing}
			<div class="flex flex-col items-center justify-center h-full gap-4">
				<Loader2 class="h-12 w-12 text-primary animate-spin" />
				<p class="text-white/80">
					{call.status === 'ringing' ? 'Calling...' : 'Connecting...'}
				</p>
			</div>
		{/if}

		{#if error}
			<div class="flex flex-col items-center justify-center h-full gap-4 p-8">
				<PhoneOff class="h-12 w-12 text-destructive" />
				<p class="text-white/80 text-center">{error}</p>
				<Button variant="outline" onclick={onEnd}>
					Close
				</Button>
			</div>
		{/if}
	</div>

	<!-- Controls -->
	<div class="absolute bottom-0 left-0 right-0 z-10 p-6 bg-gradient-to-t from-black/80 to-transparent">
		<div class="flex items-center justify-center gap-4">
			<!-- Mute button -->
			<button
				class="w-14 h-14 rounded-full flex items-center justify-center transition-colors
					{isMuted ? 'bg-destructive' : 'bg-white/20 hover:bg-white/30'}"
				onclick={handleToggleMute}
				title={isMuted ? 'Unmute' : 'Mute'}
			>
				{#if isMuted}
					<MicOff class="h-6 w-6 text-white" />
				{:else}
					<Mic class="h-6 w-6 text-white" />
				{/if}
			</button>

			<!-- Video toggle (only for video calls) -->
			{#if call.callType === 'video'}
				<button
					class="w-14 h-14 rounded-full flex items-center justify-center transition-colors
						{!isVideoEnabled ? 'bg-destructive' : 'bg-white/20 hover:bg-white/30'}"
					onclick={handleToggleVideo}
					title={isVideoEnabled ? 'Turn off camera' : 'Turn on camera'}
				>
					{#if isVideoEnabled}
						<Video class="h-6 w-6 text-white" />
					{:else}
						<VideoOff class="h-6 w-6 text-white" />
					{/if}
				</button>
			{/if}

			<!-- Screen share -->
			<button
				class="w-14 h-14 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
				onclick={handleShareScreen}
				title="Share screen"
			>
				<Monitor class="h-6 w-6 text-white" />
			</button>

			<!-- Chat -->
			<button
				class="w-14 h-14 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
				onclick={handleToggleChat}
				title="Chat"
			>
				<MessageSquare class="h-6 w-6 text-white" />
			</button>

			<!-- Hang up -->
			<button
				class="w-16 h-16 rounded-full bg-destructive hover:bg-destructive/90 flex items-center justify-center transition-colors"
				onclick={handleHangup}
				title="End call"
			>
				<PhoneOff class="h-7 w-7 text-white" />
			</button>
		</div>
	</div>
</div>
