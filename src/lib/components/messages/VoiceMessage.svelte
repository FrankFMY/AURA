<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { formatDuration } from '$lib/utils/audio-recorder';
	import { Button } from '$components/ui/button';
	import Play from 'lucide-svelte/icons/play';
	import Pause from 'lucide-svelte/icons/pause';
	import Mic from 'lucide-svelte/icons/mic';

	interface Props {
		/** URL of the audio file */
		url: string;
		/** Duration in seconds (optional, will be read from audio if not provided) */
		duration?: number;
		/** Optional waveform data for visualization */
		waveform?: number[];
	}

	let { url, duration: propDuration, waveform: propWaveform }: Props = $props();

	let audio: HTMLAudioElement | null = null;
	let isPlaying = $state(false);
	let isLoading = $state(true);
	let currentTime = $state(0);
	let totalDuration = $state(0);
	let error = $state<string | null>(null);

	// Initialize totalDuration from prop
	$effect(() => {
		if (propDuration) {
			totalDuration = propDuration;
		}
	});

	// Default waveform if not provided
	const defaultWaveform = Array(30).fill(0).map(() => 0.2 + Math.random() * 0.6);
	const displayWaveform = $derived(propWaveform || defaultWaveform);

	// Progress percentage
	const progress = $derived(totalDuration > 0 ? (currentTime / totalDuration) * 100 : 0);

	onMount(() => {
		audio = new Audio(url);

		audio.addEventListener('loadedmetadata', () => {
			isLoading = false;
			if (!propDuration) {
				totalDuration = audio?.duration || 0;
			}
		});

		audio.addEventListener('timeupdate', () => {
			currentTime = audio?.currentTime || 0;
		});

		audio.addEventListener('ended', () => {
			isPlaying = false;
			currentTime = 0;
		});

		audio.addEventListener('error', () => {
			error = 'Failed to load audio';
			isLoading = false;
		});

		audio.addEventListener('play', () => {
			isPlaying = true;
		});

		audio.addEventListener('pause', () => {
			isPlaying = false;
		});

		// Preload
		audio.load();
	});

	onDestroy(() => {
		if (audio) {
			audio.pause();
			audio.src = '';
		}
	});

	function togglePlay() {
		if (!audio || isLoading) return;

		if (isPlaying) {
			audio.pause();
		} else {
			audio.play();
		}
	}

	function seek(e: MouseEvent) {
		if (!audio || isLoading || !totalDuration) return;

		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const percentage = x / rect.width;
		const newTime = percentage * totalDuration;

		audio.currentTime = Math.max(0, Math.min(newTime, totalDuration));
	}
</script>

<div class="flex items-center gap-2 rounded-xl bg-muted/50 p-2 max-w-xs">
	<!-- Play/Pause button -->
	<Button
		variant="ghost"
		size="icon"
		class="h-10 w-10 rounded-full bg-primary/10 hover:bg-primary/20 shrink-0"
		onclick={togglePlay}
		disabled={isLoading || !!error}
		aria-label={isPlaying ? 'Pause' : 'Play'}
	>
		{#if isLoading}
			<div class="h-4 w-4 animate-pulse rounded-full bg-primary/50"></div>
		{:else if error}
			<Mic class="h-4 w-4 text-destructive" />
		{:else if isPlaying}
			<Pause class="h-4 w-4 text-primary fill-primary" />
		{:else}
			<Play class="h-4 w-4 text-primary fill-primary ml-0.5" />
		{/if}
	</Button>

	<!-- Waveform and progress -->
	<div class="flex-1 min-w-0">
		<!-- Waveform bars -->
		<button
			class="flex items-end gap-0.5 h-8 w-full cursor-pointer"
			onclick={seek}
			disabled={isLoading || !!error}
			aria-label="Seek"
		>
			{#each displayWaveform as value, i (i)}
				{@const barProgress = (i / displayWaveform.length) * 100}
				<div
					class="flex-1 rounded-full transition-colors {barProgress <= progress ? 'bg-primary' : 'bg-primary/30'}"
					style="height: {Math.max(4, value * 28)}px"
				></div>
			{/each}
		</button>

		<!-- Duration -->
		<div class="flex justify-between text-xs text-muted-foreground mt-1">
			<span class="tabular-nums">{formatDuration(currentTime)}</span>
			<span class="tabular-nums">{formatDuration(totalDuration)}</span>
		</div>
	</div>
</div>
