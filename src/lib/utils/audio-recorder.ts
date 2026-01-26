/**
 * Audio Recorder Utility
 *
 * Records audio using MediaRecorder API with waveform visualization.
 */

export type RecorderState = 'inactive' | 'recording' | 'paused';

export interface AudioRecorderOptions {
	/** Max recording duration in seconds */
	maxDuration?: number;
	/** Audio MIME type */
	mimeType?: string;
	/** Sample rate for visualization */
	visualizationSampleRate?: number;
}

export interface RecordingResult {
	/** Audio blob */
	blob: Blob;
	/** Duration in seconds */
	duration: number;
	/** MIME type */
	mimeType: string;
}

const DEFAULT_OPTIONS: AudioRecorderOptions = {
	maxDuration: 60, // 1 minute max
	mimeType: 'audio/webm',
	visualizationSampleRate: 60 // 60 FPS for smooth visualization
};

/**
 * Audio Recorder Class
 */
export class AudioRecorder {
	private mediaRecorder: MediaRecorder | null = null;
	private audioContext: AudioContext | null = null;
	private analyser: AnalyserNode | null = null;
	private mediaStream: MediaStream | null = null;
	private chunks: Blob[] = [];
	private startTime: number = 0;
	private maxDurationTimeout: ReturnType<typeof setTimeout> | null = null;
	private visualizationInterval: ReturnType<typeof setInterval> | null = null;

	private options: Required<AudioRecorderOptions>;
	private state: RecorderState = 'inactive';
	private waveformData: number[] = [];

	// Callbacks
	private onStateChange?: (state: RecorderState) => void;
	private onWaveformUpdate?: (data: number[]) => void;
	private onDurationUpdate?: (seconds: number) => void;
	private onMaxDurationReached?: () => void;

	constructor(options: AudioRecorderOptions = {}) {
		this.options = { ...DEFAULT_OPTIONS, ...options } as Required<AudioRecorderOptions>;
	}

	/**
	 * Set state change callback
	 */
	setOnStateChange(callback: (state: RecorderState) => void): void {
		this.onStateChange = callback;
	}

	/**
	 * Set waveform update callback
	 */
	setOnWaveformUpdate(callback: (data: number[]) => void): void {
		this.onWaveformUpdate = callback;
	}

	/**
	 * Set duration update callback
	 */
	setOnDurationUpdate(callback: (seconds: number) => void): void {
		this.onDurationUpdate = callback;
	}

	/**
	 * Set max duration reached callback
	 */
	setOnMaxDurationReached(callback: () => void): void {
		this.onMaxDurationReached = callback;
	}

	/**
	 * Get current state
	 */
	getState(): RecorderState {
		return this.state;
	}

	/**
	 * Get current waveform data
	 */
	getWaveform(): number[] {
		return this.waveformData;
	}

	/**
	 * Get elapsed time in seconds
	 */
	getElapsedTime(): number {
		if (this.state === 'inactive' || !this.startTime) {
			return 0;
		}
		return (Date.now() - this.startTime) / 1000;
	}

	/**
	 * Check if recording is supported
	 */
	static isSupported(): boolean {
		return !!(
			typeof navigator !== 'undefined' &&
			navigator.mediaDevices &&
			typeof navigator.mediaDevices.getUserMedia === 'function' &&
			typeof window !== 'undefined' &&
			window.MediaRecorder &&
			window.AudioContext
		);
	}

	/**
	 * Get supported MIME type
	 */
	static getSupportedMimeType(): string {
		const types = [
			'audio/webm;codecs=opus',
			'audio/webm',
			'audio/ogg;codecs=opus',
			'audio/mp4'
		];

		for (const type of types) {
			if (MediaRecorder.isTypeSupported(type)) {
				return type;
			}
		}

		return 'audio/webm'; // Fallback
	}

	/**
	 * Request microphone permission
	 */
	async requestPermission(): Promise<boolean> {
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			// Stop all tracks to release the mic
			stream.getTracks().forEach((track) => track.stop());
			return true;
		} catch (e) {
			console.error('[AudioRecorder] Permission denied:', e);
			return false;
		}
	}

	/**
	 * Start recording
	 */
	async start(): Promise<void> {
		if (this.state === 'recording') {
			return;
		}

		try {
			// Get microphone access
			this.mediaStream = await navigator.mediaDevices.getUserMedia({
				audio: {
					echoCancellation: true,
					noiseSuppression: true,
					autoGainControl: true
				}
			});

			// Determine MIME type
			const mimeType = AudioRecorder.getSupportedMimeType();

			// Create MediaRecorder
			this.mediaRecorder = new MediaRecorder(this.mediaStream, { mimeType });
			this.chunks = [];

			this.mediaRecorder.ondataavailable = (event) => {
				if (event.data.size > 0) {
					this.chunks.push(event.data);
				}
			};

			// Setup audio analysis for visualization
			this.audioContext = new AudioContext();
			const source = this.audioContext.createMediaStreamSource(this.mediaStream);
			this.analyser = this.audioContext.createAnalyser();
			this.analyser.fftSize = 256;
			source.connect(this.analyser);

			// Start recording
			this.mediaRecorder.start(100); // Collect data every 100ms
			this.startTime = Date.now();
			this.state = 'recording';
			this.onStateChange?.(this.state);

			// Start visualization
			this.startVisualization();

			// Set max duration timeout
			if (this.options.maxDuration > 0) {
				this.maxDurationTimeout = setTimeout(() => {
					this.onMaxDurationReached?.();
					this.stop();
				}, this.options.maxDuration * 1000);
			}
		} catch (e) {
			console.error('[AudioRecorder] Failed to start:', e);
			this.cleanup();
			throw e;
		}
	}

	/**
	 * Stop recording and return result
	 */
	async stop(): Promise<RecordingResult | null> {
		if (this.state === 'inactive' || !this.mediaRecorder) {
			return null;
		}

		return new Promise((resolve) => {
			if (!this.mediaRecorder) {
				resolve(null);
				return;
			}

			const duration = this.getElapsedTime();
			const mimeType = this.mediaRecorder.mimeType || this.options.mimeType;

			this.mediaRecorder.onstop = () => {
				const blob = new Blob(this.chunks, { type: mimeType });
				this.cleanup();

				// Don't return if too short (less than 0.5 seconds)
				if (duration < 0.5) {
					resolve(null);
					return;
				}

				resolve({
					blob,
					duration,
					mimeType
				});
			};

			this.mediaRecorder.stop();
		});
	}

	/**
	 * Cancel recording without saving
	 */
	cancel(): void {
		this.cleanup();
	}

	/**
	 * Start waveform visualization
	 */
	private startVisualization(): void {
		if (!this.analyser) return;

		const bufferLength = this.analyser.frequencyBinCount;
		const dataArray = new Uint8Array(bufferLength);

		const updateInterval = 1000 / this.options.visualizationSampleRate;

		this.visualizationInterval = setInterval(() => {
			if (!this.analyser || this.state !== 'recording') return;

			this.analyser.getByteFrequencyData(dataArray);

			// Calculate average amplitude
			let sum = 0;
			for (let i = 0; i < bufferLength; i++) {
				sum += dataArray[i];
			}
			const average = sum / bufferLength / 255; // Normalize to 0-1

			// Keep last 50 values for waveform display
			this.waveformData = [...this.waveformData.slice(-49), average];
			this.onWaveformUpdate?.(this.waveformData);

			// Update duration
			this.onDurationUpdate?.(this.getElapsedTime());
		}, updateInterval);
	}

	/**
	 * Cleanup all resources
	 */
	private cleanup(): void {
		// Clear timeouts
		if (this.maxDurationTimeout) {
			clearTimeout(this.maxDurationTimeout);
			this.maxDurationTimeout = null;
		}

		if (this.visualizationInterval) {
			clearInterval(this.visualizationInterval);
			this.visualizationInterval = null;
		}

		// Stop media recorder
		if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
			try {
				this.mediaRecorder.stop();
			} catch (e) {
				// Ignore
			}
		}
		this.mediaRecorder = null;

		// Stop media stream
		if (this.mediaStream) {
			this.mediaStream.getTracks().forEach((track) => track.stop());
			this.mediaStream = null;
		}

		// Close audio context
		if (this.audioContext) {
			try {
				this.audioContext.close();
			} catch (e) {
				// Ignore
			}
			this.audioContext = null;
		}

		this.analyser = null;
		this.chunks = [];
		this.startTime = 0;
		this.waveformData = [];
		this.state = 'inactive';
		this.onStateChange?.(this.state);
	}
}

/**
 * Format duration for display
 */
export function formatDuration(seconds: number): string {
	const mins = Math.floor(seconds / 60);
	const secs = Math.floor(seconds % 60);
	return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default AudioRecorder;
