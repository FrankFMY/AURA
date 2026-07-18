import { SimplePool, type Event } from 'nostr-tools';
import { normalizeDmRelayUrls, requireDmRelayList } from './dm-relays';
import type { RelayPublisher } from '../storage/outbox-worker';

export interface SubscriptionCloser {
	close(reason?: string): void;
}

export type RelayPool = Pick<SimplePool, 'publish' | 'querySync' | 'subscribeMany'>;

function rejectionIsRetryable(message: string): boolean {
	return /timeout|timed out|connect|network|socket|closed|offline|unavailable|abort/iu.test(
		message
	);
}

export function createPoolPublisher(pool: RelayPool, maxWait = 8_000): RelayPublisher {
	return async (relayUrl, event) => {
		const [relay] = normalizeDmRelayUrls([relayUrl]);
		const promises = pool.publish([relay], event, { maxWait });
		if (promises.length !== 1) {
			return { accepted: false, retryable: true, message: 'relay publication did not start' };
		}
		try {
			const message = await promises[0];
			return { accepted: true, message };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return { accepted: false, retryable: rejectionIsRetryable(message), message };
		}
	};
}

export async function discoverRecipientRelays(
	pool: RelayPool,
	lookupRelays: readonly string[],
	recipientPubkey: string,
	now: number
) {
	const relays = normalizeDmRelayUrls(lookupRelays);
	const events = await pool.querySync(
		relays,
		{ kinds: [10050], authors: [recipientPubkey], limit: 10 },
		{ maxWait: 6_000 }
	);
	return requireDmRelayList(events, recipientPubkey, now);
}

export function subscribeGiftWraps(
	pool: RelayPool,
	relays: readonly string[],
	accountPubkey: string,
	since: number,
	onEvent: (event: Event) => void,
	onClose?: (reasons: string[]) => void,
	onEose?: () => void
): SubscriptionCloser {
	if (!/^[0-9a-f]{64}$/u.test(accountPubkey)) throw new Error('account pubkey is invalid');
	if (!Number.isSafeInteger(since) || since < 0) throw new Error('subscription cursor is invalid');
	return pool.subscribeMany(
		normalizeDmRelayUrls(relays),
		{ kinds: [1059], '#p': [accountPubkey], since },
		{
			onevent: onEvent,
			oneose: onEose,
			onclose: onClose,
			maxWait: 8_000
		}
	);
}

export function createNostrPool(): SimplePool {
	return new SimplePool({ enablePing: true, enableReconnect: true });
}
