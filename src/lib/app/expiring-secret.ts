export interface ExpiringSecretLease {
	take(): Uint8Array;
	cancel(): void;
}

interface CreateExpiringSecretLeaseOptions {
	secret: Uint8Array;
	expiresAt: number;
	now?: () => number;
	setTimer?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
	clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
	onExpire: () => void;
}

export function createExpiringSecretLease(
	options: CreateExpiringSecretLeaseOptions
): ExpiringSecretLease {
	if (!(options.secret instanceof Uint8Array) || options.secret.length < 1) {
		throw new Error('expiring secret must contain bytes');
	}
	if (!Number.isSafeInteger(options.expiresAt)) {
		options.secret.fill(0);
		throw new Error('secret expiry is invalid');
	}
	const clock = options.now ?? Date.now;
	let now: number;
	try {
		now = clock();
	} catch (error) {
		options.secret.fill(0);
		throw error;
	}
	if (!Number.isSafeInteger(now)) {
		options.secret.fill(0);
		throw new Error('secret expiry is invalid');
	}
	if (options.expiresAt <= now) {
		options.secret.fill(0);
		throw new Error('expiring secret is already expired');
	}
	let active = true;
	const expire = (): void => {
		if (!active) return;
		active = false;
		options.secret.fill(0);
		try {
			options.onExpire();
		} catch {
			// Notification is non-authoritative after custody has been revoked.
		}
	};
	const setTimer = options.setTimer ?? setTimeout;
	const clearTimer = options.clearTimer ?? clearTimeout;
	let timer: ReturnType<typeof setTimeout>;
	try {
		timer = setTimer(expire, options.expiresAt - now);
	} catch (error) {
		active = false;
		options.secret.fill(0);
		throw error;
	}
	const clearTimerSafely = (): void => {
		try {
			clearTimer(timer);
		} catch {
			// Timer cleanup cannot regain ownership or suppress mandatory wiping/handoff.
		}
	};
	return {
		take(): Uint8Array {
			if (!active) throw new Error('expiring secret is no longer available');
			let current: number;
			try {
				current = clock();
			} catch (error) {
				active = false;
				options.secret.fill(0);
				clearTimerSafely();
				throw error;
			}
			if (!Number.isSafeInteger(current)) {
				active = false;
				options.secret.fill(0);
				clearTimerSafely();
				throw new Error('secret expiry is invalid');
			}
			if (current >= options.expiresAt) {
				expire();
				clearTimerSafely();
				throw new Error('expiring secret is no longer available');
			}
			active = false;
			clearTimerSafely();
			return options.secret;
		},
		cancel(): void {
			if (!active) return;
			active = false;
			options.secret.fill(0);
			clearTimerSafely();
		}
	};
}
