/**
 * Confetti Animation Utilities
 * 
 * Lightning-themed celebration effects for successful zaps.
 */

import confetti from 'canvas-confetti';

/** Lightning colors */
const LIGHTNING_COLORS = ['#fbbf24', '#f59e0b', '#ffffff', '#fcd34d', '#fef3c7'];

/**
 * Fire lightning confetti for successful zap
 */
export function fireZapConfetti(): void {
	// Create multiple bursts for dramatic effect
	const count = 200;
	const defaults = {
		origin: { y: 0.7 },
		colors: LIGHTNING_COLORS,
		disableForReducedMotion: true,
	};

	function fire(particleRatio: number, opts: confetti.Options) {
		confetti({
			...defaults,
			...opts,
			particleCount: Math.floor(count * particleRatio),
		});
	}

	// Fire multiple bursts with different settings
	fire(0.25, {
		spread: 26,
		startVelocity: 55,
	});

	fire(0.2, {
		spread: 60,
	});

	fire(0.35, {
		spread: 100,
		decay: 0.91,
		scalar: 0.8,
	});

	fire(0.1, {
		spread: 120,
		startVelocity: 25,
		decay: 0.92,
		scalar: 1.2,
	});

	fire(0.1, {
		spread: 120,
		startVelocity: 45,
	});
}

/**
 * Fire simple success confetti
 */
export function fireSuccessConfetti(): void {
	confetti({
		particleCount: 100,
		spread: 70,
		origin: { y: 0.6 },
		colors: ['#22c55e', '#4ade80', '#86efac'],
		disableForReducedMotion: true,
	});
}

/**
 * Fire emoji confetti (lightning bolts)
 */
export function fireLightningEmoji(): void {
	const scalar = 2;
	const lightning = confetti.shapeFromText({ text: '⚡', scalar });

	confetti({
		shapes: [lightning],
		scalar,
		particleCount: 30,
		spread: 70,
		origin: { y: 0.6 },
		disableForReducedMotion: true,
	});
}

/**
 * Fire confetti from both sides (celebration)
 */
export function fireSideConfetti(): void {
	const end = Date.now() + 500;

	const frame = () => {
		confetti({
			particleCount: 3,
			angle: 60,
			spread: 55,
			origin: { x: 0 },
			colors: LIGHTNING_COLORS,
			disableForReducedMotion: true,
		});
		confetti({
			particleCount: 3,
			angle: 120,
			spread: 55,
			origin: { x: 1 },
			colors: LIGHTNING_COLORS,
			disableForReducedMotion: true,
		});

		if (Date.now() < end) {
			requestAnimationFrame(frame);
		}
	};

	frame();
}

export default {
	fireZapConfetti,
	fireSuccessConfetti,
	fireLightningEmoji,
	fireSideConfetti,
};
