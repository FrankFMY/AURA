import { describe, expect, it, vi } from 'vitest';
import { getPublicKey, type Event, type Filter } from 'nostr-tools';
import {
	createDeviceLinkRequest,
	createDeviceLinkTransfer,
	parseAndVerifyDeviceLinkUrl
} from '../core/device-link';
import { DeviceLinkReceiver, publishDeviceLinkTransfer } from './device-link-runtime';
import type { RelayPool } from './relay-client';

const NOW = 1_784_400_000;
const ORIGIN = 'https://aura.frankfmy.com';
const RELAYS = ['wss://relay.damus.io/', 'wss://nos.lol/'];

function setup() {
	const receiverSecretKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
	const accountSecretKey = Uint8Array.from({ length: 32 }, (_, index) => 64 - index);
	const created = createDeviceLinkRequest({
		origin: ORIGIN,
		relayHints: RELAYS,
		issuedAt: NOW,
		expiresAt: NOW + 300,
		receiverSecretKey,
		requestIdBytes: new Uint8Array(32).fill(7)
	});
	const request = parseAndVerifyDeviceLinkUrl(`${ORIGIN}/link#${created.token}`, {
		expectedOrigin: ORIGIN,
		now: NOW + 1
	});
	const wrap = createDeviceLinkTransfer({
		request,
		accountSecretKey,
		displayName: 'Artem',
		dmRelays: RELAYS,
		createdAt: NOW + 2,
		wrapperSecretKey: new Uint8Array(32).fill(9),
		sealCreatedAt: NOW - 7,
		wrapCreatedAt: NOW - 3
	});
	return { receiverSecretKey, accountSecretKey, request, wrap };
}

function pool(overrides: Partial<RelayPool> = {}): RelayPool {
	return {
		publish: () => [Promise.resolve('saved'), Promise.resolve('saved')],
		querySync: async () => [],
		subscribeMany: () => ({ close: () => undefined }),
		...overrides
	};
}

describe('device link relay lifecycle', () => {
	it('rejects a mutated verified-request DTO before using relay or lifecycle fields', () => {
		const { receiverSecretKey, request } = setup();
		const subscribeMany = vi.fn();
		const mutatedRequest = {
			...request,
			payload: {
				...request.payload,
				relay_hints: ['wss://attacker.example/'],
				expires_at: request.payload.expires_at + 60
			},
			verificationCode: '000000'
		};

		expect(
			() =>
				new DeviceLinkReceiver({
					pool: pool({ subscribeMany }),
					request: mutatedRequest,
					expectedOrigin: ORIGIN,
					receiverSecretKey,
					now: () => NOW + 3,
					onTransfer: vi.fn()
				})
		).toThrow(/does not match|invalid/i);
		expect(subscribeMany).not.toHaveBeenCalled();
		expect(receiverSecretKey).toEqual(new Uint8Array(32));
	});

	it('subscribes to the ephemeral receiver and consumes only the first valid transfer', () => {
		const { receiverSecretKey, accountSecretKey, request, wrap } = setup();
		let capturedFilter: Filter | undefined;
		let onEvent: ((event: Event) => void) | undefined;
		const close = vi.fn();
		const subscribeMany = vi.fn((_relays: string[], filter: Filter, params) => {
			capturedFilter = filter;
			onEvent = params.onevent;
			return { close };
		});
		const onTransfer = vi.fn();
		const receiver = new DeviceLinkReceiver({
			pool: pool({ subscribeMany }),
			request,
			expectedOrigin: ORIGIN,
			receiverSecretKey,
			now: () => NOW + 3,
			onTransfer
		});

		receiver.start();
		expect(capturedFilter).toEqual({
			kinds: [1059],
			'#p': [request.event.pubkey],
			since: NOW - 300
		});
		onEvent?.(wrap);
		onEvent?.(wrap);

		expect(onTransfer).toHaveBeenCalledOnce();
		expect(onTransfer.mock.calls[0][0].accountPubkey).toBe(getPublicKey(accountSecretKey));
		expect(close).toHaveBeenCalledOnce();
		expect(receiverSecretKey).toEqual(new Uint8Array(32));
	});

	it('ignores invalid relay spam and remains ready for a later valid transfer', () => {
		const { receiverSecretKey, request, wrap } = setup();
		let onEvent: ((event: Event) => void) | undefined;
		const close = vi.fn();
		const onInvalidEvent = vi.fn();
		const onTransfer = vi.fn();
		const receiver = new DeviceLinkReceiver({
			pool: pool({
				subscribeMany: (_relays, _filter, params) => {
					onEvent = params.onevent;
					return { close };
				}
			}),
			request,
			expectedOrigin: ORIGIN,
			receiverSecretKey,
			now: () => NOW + 3,
			onTransfer,
			onInvalidEvent
		});
		receiver.start();
		const invalid = structuredClone(wrap);
		invalid.content = `${invalid.content.slice(0, -1)}A`;
		onEvent?.(invalid);
		expect(onInvalidEvent).toHaveBeenCalledOnce();
		expect(onTransfer).not.toHaveBeenCalled();
		expect(close).not.toHaveBeenCalled();
		expect(receiverSecretKey).not.toEqual(new Uint8Array(32));
		onEvent?.(wrap);
		expect(onTransfer).toHaveBeenCalledOnce();
	});

	it('zeroizes and fences delivery when stopped before a relay event', () => {
		const { receiverSecretKey, request, wrap } = setup();
		let onEvent: ((event: Event) => void) | undefined;
		const close = vi.fn();
		const onTransfer = vi.fn();
		const receiver = new DeviceLinkReceiver({
			pool: pool({
				subscribeMany: (_relays, _filter, params) => {
					onEvent = params.onevent;
					return { close };
				}
			}),
			request,
			expectedOrigin: ORIGIN,
			receiverSecretKey,
			now: () => NOW + 3,
			onTransfer
		});
		receiver.start();
		receiver.stop();
		onEvent?.(wrap);
		expect(onTransfer).not.toHaveBeenCalled();
		expect(close).toHaveBeenCalledOnce();
		expect(receiverSecretKey).toEqual(new Uint8Array(32));
	});

	it('rolls back and zeroizes when relay subscription startup throws', () => {
		const { receiverSecretKey, request } = setup();
		const receiver = new DeviceLinkReceiver({
			pool: pool({
				subscribeMany: () => {
					throw new Error('subscription startup failed');
				}
			}),
			request,
			expectedOrigin: ORIGIN,
			receiverSecretKey,
			now: () => NOW + 3,
			onTransfer: vi.fn()
		});

		expect(() => receiver.start()).toThrow(/subscription startup failed/i);
		expect(receiverSecretKey).toEqual(new Uint8Array(32));
	});

	it('closes a subscription returned after synchronous transfer consumption', () => {
		const { receiverSecretKey, request, wrap } = setup();
		const close = vi.fn();
		const onTransfer = vi.fn();
		const receiver = new DeviceLinkReceiver({
			pool: pool({
				subscribeMany: (_relays, _filter, params) => {
					params.onevent?.(wrap);
					return { close };
				}
			}),
			request,
			expectedOrigin: ORIGIN,
			receiverSecretKey,
			now: () => NOW + 3,
			onTransfer
		});

		receiver.start();
		expect(onTransfer).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
		expect(receiverSecretKey).toEqual(new Uint8Array(32));
	});

	it('hands off a valid transfer even when transport cleanup throws', () => {
		const { receiverSecretKey, request, wrap } = setup();
		let onEvent: ((event: Event) => void) | undefined;
		const close = vi.fn(() => {
			throw new Error('close failed');
		});
		const clearTimer = vi.fn(() => {
			throw new Error('clear failed');
		});
		const onTransfer = vi.fn();
		const receiver = new DeviceLinkReceiver({
			pool: pool({
				subscribeMany: (_relays, _filter, params) => {
					onEvent = params.onevent;
					return { close };
				}
			}),
			request,
			expectedOrigin: ORIGIN,
			receiverSecretKey,
			now: () => NOW + 3,
			clearTimer,
			onTransfer
		});
		receiver.start();

		expect(() => onEvent?.(wrap)).not.toThrow();
		expect(onTransfer).toHaveBeenCalledOnce();
		expect(clearTimer).toHaveBeenCalledOnce();
		expect(receiverSecretKey).toEqual(new Uint8Array(32));
		const profile = onTransfer.mock.calls[0][0];
		expect(profile.accountSecretKey).not.toEqual(new Uint8Array(32));
		profile.accountSecretKey.fill(0);
	});

	it('fails closed and wipes the receiver when the event-time clock throws', () => {
		const { receiverSecretKey, request, wrap } = setup();
		let clockCalls = 0;
		let onEvent: ((event: Event) => void) | undefined;
		const close = vi.fn();
		const onInvalidEvent = vi.fn();
		const receiver = new DeviceLinkReceiver({
			pool: pool({
				subscribeMany: (_relays, _filter, params) => {
					onEvent = params.onevent;
					return { close };
				}
			}),
			request,
			expectedOrigin: ORIGIN,
			receiverSecretKey,
			now: () => {
				clockCalls += 1;
				if (clockCalls < 4) return NOW + 1;
				throw new Error('event clock unavailable');
			},
			onTransfer: vi.fn(),
			onInvalidEvent
		});
		receiver.start();

		expect(() => onEvent?.(wrap)).not.toThrow();
		expect(onInvalidEvent).toHaveBeenCalledOnce();
		expect(close).toHaveBeenCalledOnce();
		expect(receiverSecretKey).toEqual(new Uint8Array(32));
	});

	it('notifies expiry even when subscription cleanup throws', () => {
		vi.useFakeTimers();
		try {
			const { receiverSecretKey, request } = setup();
			const onExpire = vi.fn();
			const receiver = new DeviceLinkReceiver({
				pool: pool({
					subscribeMany: () => ({
						close: () => {
							throw new Error('close failed');
						}
					})
				}),
				request,
				expectedOrigin: ORIGIN,
				receiverSecretKey,
				now: () => NOW + 1,
				onTransfer: vi.fn(),
				onExpire
			});
			receiver.start();

			expect(() => vi.advanceTimersByTime(299_000)).not.toThrow();
			expect(onExpire).toHaveBeenCalledOnce();
			expect(receiverSecretKey).toEqual(new Uint8Array(32));
		} finally {
			vi.useRealTimers();
		}
	});

	it('zeroizes the receiver scalar when its initial clock fails before subscription', () => {
		const { receiverSecretKey, request } = setup();
		const subscribeMany = vi.fn();
		expect(
			() =>
				new DeviceLinkReceiver({
					pool: pool({ subscribeMany }),
					request,
					expectedOrigin: ORIGIN,
					receiverSecretKey,
					now: () => {
						throw new Error('clock unavailable');
					},
					onTransfer: vi.fn()
				})
		).toThrow(/clock unavailable/i);
		expect(receiverSecretKey).toEqual(new Uint8Array(32));
		expect(subscribeMany).not.toHaveBeenCalled();
	});

	it('fails closed and zeroizes if pairing is already expired at start', () => {
		const { receiverSecretKey, request } = setup();
		expect(
			() =>
				new DeviceLinkReceiver({
					pool: pool(),
					request,
					expectedOrigin: ORIGIN,
					receiverSecretKey,
					now: () => NOW + 301,
					onTransfer: vi.fn()
				})
		).toThrow(/expired/i);
		expect(receiverSecretKey).toEqual(new Uint8Array(32));
	});

	it('automatically closes and zeroizes a waiting request at expiry', () => {
		vi.useFakeTimers();
		try {
			const { receiverSecretKey, request } = setup();
			const close = vi.fn();
			const onExpire = vi.fn();
			const receiver = new DeviceLinkReceiver({
				pool: pool({ subscribeMany: () => ({ close }) }),
				request,
				expectedOrigin: ORIGIN,
				receiverSecretKey,
				now: () => NOW + 1,
				onTransfer: vi.fn(),
				onExpire
			});
			receiver.start();
			vi.advanceTimersByTime(299_000);
			expect(close).toHaveBeenCalledOnce();
			expect(onExpire).toHaveBeenCalledOnce();
			expect(receiverSecretKey).toEqual(new Uint8Array(32));
		} finally {
			vi.useRealTimers();
		}
	});

	it('publishes to normalized request relays and accepts one successful ACK', async () => {
		const { wrap } = setup();
		const publish = vi.fn(() => [Promise.resolve('saved'), Promise.reject(new Error('offline'))]);
		await expect(publishDeviceLinkTransfer(pool({ publish }), RELAYS, wrap)).resolves.toEqual({
			accepted: 1,
			attempted: 2
		});
		expect(publish).toHaveBeenCalledWith(RELAYS, wrap, { maxWait: 8_000 });
	});

	it('rejects publication when no relay acknowledges the transfer', async () => {
		const { wrap } = setup();
		const publish = vi.fn(() => [
			Promise.reject(new Error('offline')),
			Promise.reject(new Error('blocked'))
		]);
		await expect(publishDeviceLinkTransfer(pool({ publish }), RELAYS, wrap)).rejects.toThrow(
			/no relay acknowledged/i
		);
	});
});
