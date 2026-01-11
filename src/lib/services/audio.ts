/**
 * Audio Service
 * 
 * Manages sound effects with user preference support.
 * Uses Web Audio API for reliable playback.
 */

import { browser } from '$app/environment';
import { dbHelpers } from '$db';

/** Sound effect types */
export type SoundEffect = 'zap' | 'notification' | 'success' | 'error';

/** Audio context singleton */
let audioContext: AudioContext | null = null;

/** Sound enabled state */
let soundsEnabled = true;

/** Sound buffers cache */
const soundBuffers = new Map<SoundEffect, AudioBuffer>();

/**
 * Initialize audio context (must be called after user interaction)
 */
function getAudioContext(): AudioContext | null {
	if (!browser) return null;
	
	if (!audioContext) {
		try {
			audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
		} catch (e) {
			console.warn('Web Audio API not supported:', e);
			return null;
		}
	}
	
	// Resume if suspended (browsers require user interaction)
	if (audioContext.state === 'suspended') {
		audioContext.resume();
	}
	
	return audioContext;
}

/**
 * Generate a simple tone using oscillator
 * This creates sounds without needing external audio files
 */
function playTone(
	frequency: number,
	duration: number,
	type: OscillatorType = 'sine',
	volume: number = 0.3,
): void {
	const ctx = getAudioContext();
	if (!ctx || !soundsEnabled) return;

	const oscillator = ctx.createOscillator();
	const gainNode = ctx.createGain();

	oscillator.connect(gainNode);
	gainNode.connect(ctx.destination);

	oscillator.type = type;
	oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

	// Fade out envelope
	gainNode.gain.setValueAtTime(volume, ctx.currentTime);
	gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

	oscillator.start(ctx.currentTime);
	oscillator.stop(ctx.currentTime + duration);
}

/**
 * Play a coin/zap sound (ascending tone)
 */
export function playZapSound(): void {
	if (!soundsEnabled) return;
	
	const ctx = getAudioContext();
	if (!ctx) return;

	// Play ascending arpeggio like Mario coin
	const notes = [523, 659, 784, 1047]; // C5, E5, G5, C6
	const duration = 0.08;

	notes.forEach((freq, i) => {
		setTimeout(() => {
			playTone(freq, duration, 'square', 0.15);
		}, i * 50);
	});
}

/**
 * Play notification sound (gentle bell)
 */
export function playNotificationSound(): void {
	if (!soundsEnabled) return;
	
	// Two-tone gentle notification
	playTone(880, 0.15, 'sine', 0.2); // A5
	setTimeout(() => {
		playTone(1108, 0.2, 'sine', 0.15); // C#6
	}, 100);
}

/**
 * Play success sound (happy chord)
 */
export function playSuccessSound(): void {
	if (!soundsEnabled) return;
	
	// Major chord
	playTone(523, 0.3, 'sine', 0.15); // C5
	setTimeout(() => playTone(659, 0.25, 'sine', 0.12), 50); // E5
	setTimeout(() => playTone(784, 0.2, 'sine', 0.1), 100); // G5
}

/**
 * Play error sound (low buzz)
 */
export function playErrorSound(): void {
	if (!soundsEnabled) return;
	
	playTone(200, 0.2, 'sawtooth', 0.15);
	setTimeout(() => {
		playTone(150, 0.3, 'sawtooth', 0.1);
	}, 100);
}

/**
 * Play sound by effect name
 */
export function playSound(effect: SoundEffect): void {
	switch (effect) {
		case 'zap':
			playZapSound();
			break;
		case 'notification':
			playNotificationSound();
			break;
		case 'success':
			playSuccessSound();
			break;
		case 'error':
			playErrorSound();
			break;
	}
}

/**
 * Enable or disable sounds
 */
export async function setSoundsEnabled(enabled: boolean): Promise<void> {
	soundsEnabled = enabled;
	await dbHelpers.setSetting('sounds_enabled', enabled);
}

/**
 * Get sounds enabled state
 */
export function isSoundsEnabled(): boolean {
	return soundsEnabled;
}

/**
 * Initialize audio service (load settings)
 */
export async function initAudioService(): Promise<void> {
	if (!browser) return;
	
	const enabled = await dbHelpers.getSetting<boolean>('sounds_enabled', true);
	soundsEnabled = enabled ?? true;
}

/**
 * Trigger haptic feedback if available
 */
export function vibrate(pattern: number | number[] = 10): void {
	if (!browser) return;
	
	if ('vibrate' in navigator) {
		try {
			navigator.vibrate(pattern);
		} catch {
			// Vibration not supported
		}
	}
}

/**
 * Combined feedback (sound + haptic)
 */
export function feedback(effect: SoundEffect): void {
	playSound(effect);
	
	// Haptic patterns
	switch (effect) {
		case 'zap':
			vibrate([10, 30, 10, 30, 10]);
			break;
		case 'success':
			vibrate([10, 50, 20]);
			break;
		case 'error':
			vibrate([50, 30, 50]);
			break;
		default:
			vibrate(10);
	}
}

export default {
	playSound,
	playZapSound,
	playNotificationSound,
	playSuccessSound,
	playErrorSound,
	setSoundsEnabled,
	isSoundsEnabled,
	initAudioService,
	vibrate,
	feedback,
};
