import { describe, expect, it, vi } from 'vitest';
import {
	finalizeEvent,
	generateSecretKey,
	getPublicKey,
	type Event,
	type Filter
} from 'nostr-tools';
import {
	createPoolPublisher,
	discoverRecipientRelays,
	subscribeGiftWraps,
	type RelayPool
} from './relay-client';

const NOW = 1_750_000_000;

function pool(overrides: Partial<RelayPool> = {}): RelayPool {
	return {
		publish: () => [Promise.resolve('saved')],
		querySync: async () => [],
		subscribeMany: () => ({ close: () => undefined }),
		...overrides
	};
}

describe('Nostr relay adapter', () => {
	it('publishes to exactly one outbox relay and classifies ACK evidence', async () => {
		const publish = vi.fn(() => [Promise.resolve('saved')]);
		const publisher = createPoolPublisher(pool({ publish }));
		const event = finalizeEvent(
			{ kind: 1, tags: [], content: 'test', created_at: NOW },
			generateSecretKey()
		);
		expect(await publisher('wss://relay.one/', event)).toEqual({
			accepted: true,
			message: 'saved'
		});
		expect(publish).toHaveBeenCalledWith(['wss://relay.one/'], event, { maxWait: 8_000 });
	});

	it('queries signed kind-10050 events and fails closed when absent', async () => {
		const recipientSecret = generateSecretKey();
		const pubkey = getPublicKey(recipientSecret);
		const relayList = finalizeEvent(
			{
				kind: 10050,
				tags: [['relay', 'wss://recipient.one/']],
				content: '',
				created_at: NOW - 1
			},
			recipientSecret
		);
		const querySync = vi.fn(async () => [relayList]);
		const found = await discoverRecipientRelays(
			pool({ querySync }),
			['wss://lookup.one/'],
			pubkey,
			NOW
		);
		expect(found.relays).toEqual(['wss://recipient.one/']);
		expect(querySync).toHaveBeenCalledWith(
			['wss://lookup.one/'],
			{ kinds: [10050], authors: [pubkey], limit: 10 },
			{ maxWait: 6_000 }
		);
		await expect(
			discoverRecipientRelays(pool(), ['wss://lookup.one/'], pubkey, NOW)
		).rejects.toThrow(/recipient_not_dm_ready/i);
	});

	it('subscribes only to Gift Wraps addressed to the active account', () => {
		let capturedFilter: Filter | undefined;
		let capturedEose: (() => void) | undefined;
		const close = vi.fn();
		const subscribeMany = vi.fn((_relays: string[], filter: Filter, params) => {
			capturedFilter = filter;
			capturedEose = params.oneose;
			return { close };
		});
		const onEvent = vi.fn<(event: Event) => void>();
		const onEose = vi.fn();
		const pubkey = '11'.repeat(32);
		const subscription = subscribeGiftWraps(
			pool({ subscribeMany }),
			['wss://recipient.one/'],
			pubkey,
			NOW - 60,
			onEvent,
			undefined,
			onEose
		);
		expect(capturedFilter).toEqual({ kinds: [1059], '#p': [pubkey], since: NOW - 60 });
		capturedEose?.();
		expect(onEose).toHaveBeenCalledOnce();
		subscription.close();
		expect(close).toHaveBeenCalledOnce();
	});
});
