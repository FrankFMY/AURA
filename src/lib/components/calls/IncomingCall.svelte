<script lang="ts">
	import { callsStore, type IncomingCallData } from '$stores/calls.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import Phone from 'lucide-svelte/icons/phone';
	import PhoneOff from 'lucide-svelte/icons/phone-off';
	import Video from 'lucide-svelte/icons/video';
	import { onMount, onDestroy } from 'svelte';

	interface Props {
		call: IncomingCallData;
		onAccept: () => void;
		onDecline: () => void;
	}

	let { call, onAccept, onDecline }: Props = $props();

	let ringInterval: ReturnType<typeof setInterval> | null = null;

	// Play ring sound (visual pulse for now)
	onMount(() => {
		// Could add audio ringtone here
		// const audio = new Audio('/sounds/ringtone.mp3');
		// audio.loop = true;
		// audio.play();
	});

	onDestroy(() => {
		if (ringInterval) {
			clearInterval(ringInterval);
		}
	});

	const displayName = $derived(
		call.callerProfile?.name ||
		call.callerProfile?.display_name ||
		call.callerPubkey.slice(0, 8) + '...'
	);

	const avatarInitials = $derived(
		displayName.slice(0, 2).toUpperCase()
	);
</script>

<!-- Fullscreen incoming call overlay -->
<div class="fixed inset-0 z-[100] flex items-center justify-center bg-gradient-to-b from-background to-background/95 backdrop-blur-lg">
	<!-- Animated background rings -->
	<div class="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none">
		<div class="absolute w-64 h-64 rounded-full border border-primary/20 animate-ping-slow"></div>
		<div class="absolute w-96 h-96 rounded-full border border-primary/10 animate-ping-slower"></div>
	</div>

	<div class="relative z-10 flex flex-col items-center gap-8 p-8">
		<!-- Call type indicator -->
		<div class="flex items-center gap-2 text-muted-foreground">
			{#if call.callType === 'video'}
				<Video class="h-5 w-5" />
				<span>Incoming Video Call</span>
			{:else}
				<Phone class="h-5 w-5" />
				<span>Incoming Voice Call</span>
			{/if}
		</div>

		<!-- Caller avatar with pulse -->
		<div class="relative">
			<div class="absolute -inset-4 rounded-full bg-primary/20 animate-pulse"></div>
			<Avatar size="xl" class="relative border-4 border-primary/50 !h-24 !w-24">
				{#if call.callerProfile?.picture}
					<AvatarImage src={call.callerProfile.picture} alt={displayName} />
				{/if}
				<AvatarFallback class="text-4xl bg-primary/10">
					{avatarInitials}
				</AvatarFallback>
			</Avatar>
		</div>

		<!-- Caller name -->
		<div class="text-center">
			<h2 class="text-2xl font-semibold">{displayName}</h2>
			<p class="text-muted-foreground mt-1">is calling you...</p>
		</div>

		<!-- Action buttons -->
		<div class="flex items-center gap-8 mt-4">
			<!-- Decline button -->
			<button
				class="flex flex-col items-center gap-2 group"
				onclick={onDecline}
			>
				<div class="w-16 h-16 rounded-full bg-destructive flex items-center justify-center transition-transform group-hover:scale-110 group-active:scale-95">
					<PhoneOff class="h-7 w-7 text-white" />
				</div>
				<span class="text-sm text-muted-foreground group-hover:text-destructive transition-colors">
					Decline
				</span>
			</button>

			<!-- Accept button -->
			<button
				class="flex flex-col items-center gap-2 group"
				onclick={onAccept}
			>
				<div class="w-16 h-16 rounded-full bg-success flex items-center justify-center transition-transform group-hover:scale-110 group-active:scale-95 animate-pulse">
					{#if call.callType === 'video'}
						<Video class="h-7 w-7 text-white" />
					{:else}
						<Phone class="h-7 w-7 text-white" />
					{/if}
				</div>
				<span class="text-sm text-muted-foreground group-hover:text-success transition-colors">
					Accept
				</span>
			</button>
		</div>
	</div>
</div>

<style>
	@keyframes ping-slow {
		0% {
			transform: scale(1);
			opacity: 0.5;
		}
		75%, 100% {
			transform: scale(1.5);
			opacity: 0;
		}
	}

	@keyframes ping-slower {
		0% {
			transform: scale(1);
			opacity: 0.3;
		}
		75%, 100% {
			transform: scale(2);
			opacity: 0;
		}
	}

	.animate-ping-slow {
		animation: ping-slow 2s cubic-bezier(0, 0, 0.2, 1) infinite;
	}

	.animate-ping-slower {
		animation: ping-slower 2.5s cubic-bezier(0, 0, 0.2, 1) infinite;
		animation-delay: 0.5s;
	}
</style>
