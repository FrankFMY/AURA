<script lang="ts">
	import { onDestroy } from 'svelte';
	import { AudioRecorder, formatDuration, type RecordingResult } from '$lib/utils/audio-recorder';
	import { notificationsStore } from '$stores/notifications.svelte';
	import { Button } from '$components/ui/button';
	import Mic from 'lucide-svelte/icons/mic';
	import Square from 'lucide-svelte/icons/square';
	import X from 'lucide-svelte/icons/x';
	import Send from 'lucide-svelte/icons/send';

	interface Props {
		/** Callback when recording is ready to send */
		onRecorded: (result: RecordingResult) => void;
		/** Callback when recording is cancelled */
		onCancel?: () => void;
		/** Max duration in seconds */
		maxDuration?: number;
	}

	let { onRecorded, onCancel, maxDuration = 60 }: Props = $props();

	let recorder: AudioRecorder | null = null;
	let isRecording = $state(false);
	let duration = $state(0);
	let waveform = $state<number[]>([]);
	let pendingResult = $state<RecordingResult | null>(null);
	let isSupported = $state(true);

	// Check support on mount
	if (typeof window !== 'undefined') {
		isSupported = AudioRecorder.isSupported();
	}

	async function startRecording() {
		if (isRecording || !isSupported) return;

		try {
			recorder = new AudioRecorder({ maxDuration });

			recorder.setOnStateChange((state) => {
				isRecording = state === 'recording';
			});

			recorder.setOnWaveformUpdate((data) => {
				waveform = data;
			});

			recorder.setOnDurationUpdate((secs) => {
				duration = secs;
			});

			recorder.setOnMaxDurationReached(() => {
				notificationsStore.warning('Max duration reached', `Recording limited to ${maxDuration}s`);
			});

			await recorder.start();
		} catch (e) {
			console.error('Failed to start recording:', e);
			notificationsStore.error(
				'Microphone access denied',
				'Please allow microphone access to record voice messages'
			);
			isRecording = false;
		}
	}

	async function stopRecording() {
		if (!recorder || !isRecording) return;

		const result = await recorder.stop();
		if (result) {
			pendingResult = result;
		} else {
			// Recording too short
			notificationsStore.warning('Recording too short', 'Hold longer to record');
			cancelRecording();
		}
	}

	function cancelRecording() {
		if (recorder) {
			recorder.cancel();
		}
		pendingResult = null;
		duration = 0;
		waveform = [];
		onCancel?.();
	}

	function sendRecording() {
		if (pendingResult) {
			onRecorded(pendingResult);
			pendingResult = null;
			duration = 0;
			waveform = [];
		}
	}

	// Handle hold-to-record
	function handlePointerDown() {
		startRecording();
	}

	function handlePointerUp() {
		if (isRecording) {
			stopRecording();
		}
	}

	// Cleanup on destroy
	onDestroy(() => {
		if (recorder) {
			recorder.cancel();
		}
	});
</script>

{#if !isSupported}
	<Button
		variant="ghost"
		size="icon"
		disabled
		title="Voice messages not supported in this browser"
	>
		<Mic class="h-4 w-4 opacity-50" />
	</Button>
{:else if pendingResult}
	<!-- Preview state -->
	<div class="flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5">
		<Button
			variant="ghost"
			size="icon"
			class="h-8 w-8 text-destructive hover:text-destructive"
			onclick={cancelRecording}
			title="Cancel"
		>
			<X class="h-4 w-4" />
		</Button>

		<div class="flex items-center gap-2">
			<Mic class="h-4 w-4 text-primary" />
			<span class="text-sm font-medium text-primary">
				{formatDuration(pendingResult.duration)}
			</span>
		</div>

		<Button
			variant="glow"
			size="icon"
			class="h-8 w-8"
			onclick={sendRecording}
			title="Send voice message"
		>
			<Send class="h-4 w-4" />
		</Button>
	</div>
{:else if isRecording}
	<!-- Recording state -->
	<div class="flex items-center gap-2 rounded-full bg-destructive/10 px-3 py-1.5">
		<Button
			variant="ghost"
			size="icon"
			class="h-8 w-8 text-destructive hover:text-destructive"
			onclick={cancelRecording}
			title="Cancel"
		>
			<X class="h-4 w-4" />
		</Button>

		<!-- Waveform visualization -->
		<div class="flex items-center gap-0.5 h-6">
			{#each waveform.slice(-20) as value, i (i)}
				<div
					class="w-1 bg-destructive rounded-full transition-all"
					style="height: {Math.max(4, value * 24)}px"
				></div>
			{/each}
			{#if waveform.length < 20}
				{#each Array(20 - waveform.length) as _, i (i)}
					<div class="w-1 h-1 bg-destructive/30 rounded-full"></div>
				{/each}
			{/if}
		</div>

		<span class="text-sm font-medium text-destructive tabular-nums min-w-12">
			{formatDuration(duration)}
		</span>

		<Button
			variant="ghost"
			size="icon"
			class="h-8 w-8 bg-destructive text-destructive-foreground hover:bg-destructive/90"
			onpointerup={handlePointerUp}
			title="Release to stop"
		>
			<Square class="h-3 w-3 fill-current" />
		</Button>
	</div>
{:else}
	<!-- Idle state - hold to record button -->
	<Button
		variant="ghost"
		size="icon"
		class="hover:text-primary hover:bg-primary/10"
		onpointerdown={handlePointerDown}
		onpointerup={handlePointerUp}
		onpointerleave={handlePointerUp}
		title="Hold to record voice message"
	>
		<Mic class="h-4 w-4" />
	</Button>
{/if}
