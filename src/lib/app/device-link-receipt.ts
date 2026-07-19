import type { ImportedDeviceLinkProfile } from '../core/device-link';
import { createExpiringSecretLease, type ExpiringSecretLease } from './expiring-secret';

export type DeviceLinkReceiptResult =
	| { status: 'received'; lease: ExpiringSecretLease }
	| { status: 'stale' }
	| { status: 'expired'; cause: unknown }
	| { status: 'error'; cause: unknown };

interface AcceptDeviceLinkReceiptOptions {
	profile: ImportedDeviceLinkProfile;
	expiresAt: number;
	isCurrent: () => boolean;
	now?: () => number;
	onExpire: () => void;
	leaseFactory?: typeof createExpiringSecretLease;
}

export function acceptDeviceLinkReceipt(
	options: AcceptDeviceLinkReceiptOptions
): DeviceLinkReceiptResult {
	const now = options.now ?? Date.now;
	const leaseFactory = options.leaseFactory ?? createExpiringSecretLease;
	let current: boolean;
	try {
		current = options.isCurrent();
	} catch (cause) {
		options.profile.accountSecretKey.fill(0);
		return { status: 'error', cause };
	}
	if (!current) {
		options.profile.accountSecretKey.fill(0);
		return { status: 'stale' };
	}
	try {
		return {
			status: 'received',
			lease: leaseFactory({
				secret: options.profile.accountSecretKey,
				expiresAt: options.expiresAt,
				now,
				onExpire: options.onExpire
			})
		};
	} catch (cause) {
		options.profile.accountSecretKey.fill(0);
		let expired = false;
		try {
			expired = options.expiresAt <= now();
		} catch {
			// A failed clock cannot prove expiry, but custody has already been revoked.
		}
		return expired ? { status: 'expired', cause } : { status: 'error', cause };
	}
}
