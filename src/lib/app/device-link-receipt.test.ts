import { describe, expect, it, vi } from 'vitest';
import type { ImportedDeviceLinkProfile } from '../core/device-link';
import { acceptDeviceLinkReceipt } from './device-link-receipt';

function profile(secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1)) {
	return {
		requestId: 'request-id',
		accountPubkey: 'a'.repeat(64),
		accountSecretKey: secret,
		displayName: 'Linked profile',
		dmRelays: ['wss://relay.example/']
	} satisfies ImportedDeviceLinkProfile;
}

describe('device-link receipt ownership', () => {
	it('wipes a transfer received at the deadline and returns an expired restart state', () => {
		const imported = profile();
		const result = acceptDeviceLinkReceipt({
			profile: imported,
			expiresAt: 1_000,
			isCurrent: () => true,
			now: () => 1_000,
			onExpire: vi.fn()
		});
		expect(result.status).toBe('expired');
		expect(imported.accountSecretKey).toEqual(new Uint8Array(32));
	});

	it('wipes a consumed transfer when timer construction fails', () => {
		const imported = profile();
		const result = acceptDeviceLinkReceipt({
			profile: imported,
			expiresAt: 2_000,
			isCurrent: () => true,
			now: () => 1_000,
			onExpire: vi.fn(),
			leaseFactory: () => {
				throw new Error('timer construction failed');
			}
		});
		expect(result.status).toBe('error');
		expect(imported.accountSecretKey).toEqual(new Uint8Array(32));
	});

	it('wipes the transfer when the lifecycle guard throws', () => {
		const imported = profile();
		const result = acceptDeviceLinkReceipt({
			profile: imported,
			expiresAt: 2_000,
			isCurrent: () => {
				throw new Error('lifecycle guard failed');
			},
			now: () => 2_000,
			onExpire: vi.fn()
		});
		expect(result.status).toBe('error');
		expect(imported.accountSecretKey).toEqual(new Uint8Array(32));
	});

	it('wipes stale delivery without creating a lease', () => {
		const imported = profile();
		const leaseFactory = vi.fn();
		const result = acceptDeviceLinkReceipt({
			profile: imported,
			expiresAt: 2_000,
			isCurrent: () => false,
			now: () => 1_000,
			onExpire: vi.fn(),
			leaseFactory
		});
		expect(result.status).toBe('stale');
		expect(leaseFactory).not.toHaveBeenCalled();
		expect(imported.accountSecretKey).toEqual(new Uint8Array(32));
	});
});
