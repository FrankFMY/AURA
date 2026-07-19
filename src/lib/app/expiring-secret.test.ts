import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExpiringSecretLease } from './expiring-secret';

afterEach(() => vi.useRealTimers());

describe('expiring secret lease', () => {
	it('zeroizes the exact owned buffer at expiry', () => {
		vi.useFakeTimers();
		const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
		const onExpire = vi.fn();
		createExpiringSecretLease({ secret, expiresAt: 10_000, now: () => 7_000, onExpire });

		vi.advanceTimersByTime(2_999);
		expect(secret).not.toEqual(new Uint8Array(32));
		vi.advanceTimersByTime(1);
		expect(secret).toEqual(new Uint8Array(32));
		expect(onExpire).toHaveBeenCalledOnce();
	});

	it('hands off the exact buffer and cancels expiry without wiping it', () => {
		vi.useFakeTimers();
		const secret = new Uint8Array(32).fill(7);
		const onExpire = vi.fn();
		const lease = createExpiringSecretLease({
			secret,
			expiresAt: 10_000,
			now: () => 7_000,
			onExpire
		});

		expect(lease.take()).toBe(secret);
		vi.advanceTimersByTime(3_000);
		expect(secret).toEqual(new Uint8Array(32).fill(7));
		expect(onExpire).not.toHaveBeenCalled();
		secret.fill(0);
	});

	it('rejects a handoff when the clock expired before a delayed timer ran', () => {
		vi.useFakeTimers();
		let now = 7_000;
		const secret = new Uint8Array(32).fill(5);
		const onExpire = vi.fn();
		const lease = createExpiringSecretLease({
			secret,
			expiresAt: 10_000,
			now: () => now,
			onExpire
		});

		now = 10_000;
		expect(() => lease.take()).toThrow(/no longer available/i);
		expect(secret).toEqual(new Uint8Array(32));
		expect(onExpire).toHaveBeenCalledOnce();
	});

	it('rejects and zeroizes a lease created at its deadline', () => {
		const secret = new Uint8Array(32).fill(6);
		const onExpire = vi.fn();
		expect(() =>
			createExpiringSecretLease({ secret, expiresAt: 10_000, now: () => 10_000, onExpire })
		).toThrow(/already expired/i);
		expect(secret).toEqual(new Uint8Array(32));
		expect(onExpire).not.toHaveBeenCalled();
	});

	it('zeroizes if the expiry timer cannot be created', () => {
		const secret = new Uint8Array(32).fill(8);
		vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce(() => {
			throw new Error('timer unavailable');
		});
		expect(() =>
			createExpiringSecretLease({ secret, expiresAt: 10_000, now: () => 7_000, onExpire: vi.fn() })
		).toThrow(/timer unavailable/i);
		expect(secret).toEqual(new Uint8Array(32));
	});

	it('zeroizes through throwing clocks and throwing timer cleanup', () => {
		const initialClockSecret = new Uint8Array(32).fill(10);
		expect(() =>
			createExpiringSecretLease({
				secret: initialClockSecret,
				expiresAt: 10_000,
				now: () => {
					throw new Error('clock unavailable');
				},
				onExpire: vi.fn()
			})
		).toThrow(/clock unavailable/i);
		expect(initialClockSecret).toEqual(new Uint8Array(32));

		let clockCalls = 0;
		const takeSecret = new Uint8Array(32).fill(11);
		const takeLease = createExpiringSecretLease({
			secret: takeSecret,
			expiresAt: 10_000,
			now: () => {
				clockCalls += 1;
				if (clockCalls === 1) return 7_000;
				throw new Error('clock failed during take');
			},
			clearTimer: () => {
				throw new Error('clear failed');
			},
			onExpire: vi.fn()
		});
		expect(() => takeLease.take()).toThrow(/clock failed during take/i);
		expect(takeSecret).toEqual(new Uint8Array(32));

		const cancelSecret = new Uint8Array(32).fill(12);
		const cancelLease = createExpiringSecretLease({
			secret: cancelSecret,
			expiresAt: 10_000,
			now: () => 7_000,
			clearTimer: () => {
				throw new Error('clear failed');
			},
			onExpire: vi.fn()
		});
		expect(() => cancelLease.cancel()).not.toThrow();
		expect(cancelSecret).toEqual(new Uint8Array(32));
	});

	it('cancellation zeroizes immediately and is idempotent', () => {
		vi.useFakeTimers();
		const secret = new Uint8Array(32).fill(9);
		const onExpire = vi.fn();
		const lease = createExpiringSecretLease({
			secret,
			expiresAt: 10_000,
			now: () => 7_000,
			onExpire
		});

		lease.cancel();
		lease.cancel();
		expect(secret).toEqual(new Uint8Array(32));
		vi.advanceTimersByTime(3_000);
		expect(onExpire).not.toHaveBeenCalled();
	});
});
