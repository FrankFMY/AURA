import { getPublicKey, type Event } from 'nostr-tools';
import {
	unwrapDeviceLinkTransfer,
	type ImportedDeviceLinkProfile,
	type VerifiedDeviceLinkRequest
} from '../core/device-link';
import { normalizeDmRelayUrls } from './dm-relays';
import type { RelayPool, SubscriptionCloser } from './relay-client';

export interface DeviceLinkReceiverOptions {
	pool: RelayPool;
	request: VerifiedDeviceLinkRequest;
	/** Ownership is transferred; stop, expiry, or success zeroizes this exact buffer. */
	receiverSecretKey: Uint8Array;
	now?: () => number;
	onTransfer: (profile: ImportedDeviceLinkProfile) => void;
	onInvalidEvent?: (error: Error) => void;
	onClose?: (reasons: string[]) => void;
	onExpire?: () => void;
}

export interface DeviceLinkPublishResult {
	accepted: number;
	attempted: number;
}

function systemNow(): number {
	return Math.floor(Date.now() / 1000);
}

export class DeviceLinkReceiver {
	readonly #pool: RelayPool;
	readonly #request: VerifiedDeviceLinkRequest;
	readonly #receiverSecretKey: Uint8Array;
	readonly #now: () => number;
	readonly #onTransfer: (profile: ImportedDeviceLinkProfile) => void;
	readonly #onInvalidEvent?: (error: Error) => void;
	readonly #onClose?: (reasons: string[]) => void;
	readonly #onExpire?: () => void;
	#subscription: SubscriptionCloser | undefined;
	#expiryTimer: ReturnType<typeof setTimeout> | undefined;
	#generation = 0;
	#started = false;
	#consumed = false;

	constructor(options: DeviceLinkReceiverOptions) {
		this.#pool = options.pool;
		this.#request = options.request;
		this.#receiverSecretKey = options.receiverSecretKey;
		this.#now = options.now ?? systemNow;
		this.#onTransfer = options.onTransfer;
		this.#onInvalidEvent = options.onInvalidEvent;
		this.#onClose = options.onClose;
		this.#onExpire = options.onExpire;
		if (!(this.#receiverSecretKey instanceof Uint8Array) || this.#receiverSecretKey.length !== 32) {
			this.#receiverSecretKey.fill(0);
			throw new Error('device link receiver secret key must contain exactly 32 bytes');
		}
		let pubkey: string;
		try {
			pubkey = getPublicKey(this.#receiverSecretKey);
		} catch {
			this.#receiverSecretKey.fill(0);
			throw new Error('device link receiver secret key is invalid');
		}
		if (pubkey !== this.#request.event.pubkey) {
			this.#receiverSecretKey.fill(0);
			throw new Error('device link receiver secret key does not match the request');
		}
	}

	start(): SubscriptionCloser {
		if (this.#started) throw new Error('device link receiver is already started');
		if (this.#consumed) throw new Error('device link request is already consumed');
		if (this.#now() >= this.#request.payload.expires_at) {
			this.#receiverSecretKey.fill(0);
			throw new Error('device link request has expired');
		}
		this.#started = true;
		const generation = ++this.#generation;
		const since = Math.max(0, this.#request.payload.issued_at - 5 * 60);
		this.#subscription = this.#pool.subscribeMany(
			[...this.#request.payload.relay_hints],
			{ kinds: [1059], '#p': [this.#request.event.pubkey], since },
			{
				onevent: (event) => this.#receive(event, generation),
				onclose: (reasons) => {
					if (this.#started && generation === this.#generation) this.#onClose?.(reasons);
				},
				maxWait: 8_000
			}
		);
		const expiresInMs = Math.max(1, (this.#request.payload.expires_at - this.#now()) * 1_000);
		this.#expiryTimer = setTimeout(() => {
			if (!this.#started || generation !== this.#generation) return;
			this.stop('device link request expired');
			this.#onExpire?.();
		}, expiresInMs);
		return { close: (reason?: string) => this.stop(reason) };
	}

	stop(reason = 'device link receiver stopped'): void {
		if (!this.#started && this.#receiverSecretKey.every((byte) => byte === 0)) return;
		this.#generation += 1;
		this.#started = false;
		const subscription = this.#subscription;
		this.#subscription = undefined;
		if (this.#expiryTimer) clearTimeout(this.#expiryTimer);
		this.#expiryTimer = undefined;
		this.#receiverSecretKey.fill(0);
		subscription?.close(reason);
	}

	#receive(event: Event, generation: number): void {
		if (!this.#started || this.#consumed || generation !== this.#generation) return;
		let profile: ImportedDeviceLinkProfile;
		try {
			profile = unwrapDeviceLinkTransfer({
				wrap: event,
				receiverSecretKey: this.#receiverSecretKey,
				request: this.#request,
				now: this.#now()
			});
		} catch (error) {
			this.#onInvalidEvent?.(error instanceof Error ? error : new Error('invalid device link event'));
			return;
		}
		this.#consumed = true;
		this.stop('device link transfer consumed');
		try {
			this.#onTransfer(profile);
		} catch (error) {
			profile.accountSecretKey.fill(0);
			throw error;
		}
	}
}

export async function publishDeviceLinkTransfer(
	pool: RelayPool,
	relays: readonly string[],
	event: Event,
	maxWait = 8_000
): Promise<DeviceLinkPublishResult> {
	const normalized = normalizeDmRelayUrls(relays);
	if (!Number.isSafeInteger(maxWait) || maxWait < 1 || maxWait > 60_000) {
		throw new Error('device link relay timeout is invalid');
	}
	const publications = pool.publish(normalized, event, { maxWait });
	if (publications.length !== normalized.length) {
		throw new Error('device link publication did not start on every relay');
	}
	const results = await Promise.allSettled(publications);
	const accepted = results.filter((result) => result.status === 'fulfilled').length;
	if (accepted < 1) throw new Error('no relay acknowledged the device link transfer');
	return { accepted, attempted: results.length };
}
