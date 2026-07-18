import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { createMessageState, transitionMessageState } from '../core/message-state';
import { createWrappedDirectMessage } from '../nostr/gift-wrap';
import { AccountDatabase, commitOutgoingMessage, getDueOutbox } from './account-database';
import {
	OUTBOX_PUBLISH_LEASE_MS,
	claimDueOutboxRows,
	runOutboxBatch,
	type RelayPublisher
} from './outbox-worker';

const NOW_SECONDS = 1_750_000_000;
const NOW_MS = NOW_SECONDS * 1000;
const databases: AccountDatabase[] = [];

async function fixture(recipientRelays = ['wss://recipient.one/']) {
	const senderSecretKey = generateSecretKey();
	const recipientPubkey = getPublicKey(generateSecretKey());
	const senderPubkey = getPublicKey(senderSecretKey);
	const database = new AccountDatabase(senderPubkey, `worker-${crypto.randomUUID()}`);
	databases.push(database);
	const wrapped = createWrappedDirectMessage({
		content: 'Exact persisted event.',
		senderSecretKey,
		recipientPubkey,
		createdAt: NOW_SECONDS,
		randomPastTimestamp: () => NOW_SECONDS - 1
	});
	await commitOutgoingMessage(database, {
		wrapped,
		recipientRelays,
		senderRelays: ['wss://sender.one/'],
		committedAt: NOW_MS
	});
	return { database, wrapped };
}

afterEach(async () => {
	await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('durable relay outbox worker', () => {
	it('publishes exact persisted events and records network acceptance', async () => {
		const { database } = await fixture();
		const publisher = vi.fn<RelayPublisher>(async () => ({ accepted: true, message: 'saved' }));
		await runOutboxBatch(database, publisher, NOW_MS);

		expect(publisher).toHaveBeenCalledTimes(2);
		const rows = await database.outbox.toArray();
		expect(rows.every((row) => row.status === 'accepted' && row.attempt === 1)).toBe(true);
		for (const [relay, event] of publisher.mock.calls) {
			const persisted = rows.find((row) => row.relayUrl === relay);
			expect(JSON.stringify(event)).toBe(persisted?.eventJson);
		}
		const message = await database.messages.toCollection().first();
		expect(message?.state).toBe('network_accepted');
		expect(message?.attempts).toBe(1);
	});

	it('treats one recipient ACK as network acceptance while retrying another relay', async () => {
		const { database } = await fixture(['wss://recipient.one/', 'wss://recipient.two/']);
		const publisher: RelayPublisher = async (relay) => {
			if (relay === 'wss://recipient.two/') throw new Error('timeout');
			return { accepted: true, message: 'saved' };
		};
		await runOutboxBatch(database, publisher, NOW_MS);
		const message = await database.messages.toCollection().first();
		expect(message?.state).toBe('network_accepted');
		const retry = await database.outbox.where('relayUrl').equals('wss://recipient.two/').first();
		expect(retry?.status).toBe('retry_wait');
		expect(retry?.nextAttemptAt).toBeGreaterThan(NOW_MS);
	});

	it('records explicit all-relay rejection without calling it delivered', async () => {
		const { database } = await fixture();
		const publisher: RelayPublisher = async () => ({
			accepted: false,
			retryable: false,
			message: 'blocked'
		});
		await runOutboxBatch(database, publisher, NOW_MS);
		const message = await database.messages.toCollection().first();
		expect(message?.state).toBe('network_rejected');
	});

	it('retries the same event ID after a transient failure', async () => {
		const { database, wrapped } = await fixture();
		const failed: RelayPublisher = async () => {
			throw new Error('offline');
		};
		await runOutboxBatch(database, failed, NOW_MS);
		expect((await database.messages.toCollection().first())?.state).toBe('retry_wait');

		const publishedIds: string[] = [];
		const recovered: RelayPublisher = async (_relay, event) => {
			publishedIds.push(event.id);
			return { accepted: true, message: 'saved' };
		};
		await runOutboxBatch(database, recovered, NOW_MS + 2_000);
		expect(publishedIds).toContain(wrapped.recipient.wrap.id);
		expect((await database.messages.toCollection().first())?.state).toBe('network_accepted');
	});

	it('atomically claims due rows so overlapping workers cannot publish them twice', async () => {
		const { database } = await fixture();
		let releaseFirst!: () => void;
		const release = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		let startedFirst!: () => void;
		const started = new Promise<void>((resolve) => {
			startedFirst = resolve;
		});
		let firstCalls = 0;
		const firstPublisher: RelayPublisher = async () => {
			firstCalls += 1;
			if (firstCalls === 2) startedFirst();
			await release;
			return { accepted: true, message: 'saved' };
		};
		const first = runOutboxBatch(database, firstPublisher, NOW_MS);
		await started;

		const secondPublisher = vi.fn<RelayPublisher>(async () => ({
			accepted: true,
			message: 'saved'
		}));
		const secondProcessed = await runOutboxBatch(database, secondPublisher, NOW_MS);
		releaseFirst();
		await first;

		expect(secondProcessed).toBe(0);
		expect(secondPublisher).not.toHaveBeenCalled();
		expect(firstCalls).toBe(2);
		expect((await database.messages.toCollection().first())?.state).toBe('network_accepted');
	});

	it('rejects a stale due snapshot after another worker has claimed its rows', async () => {
		const { database, wrapped } = await fixture();
		const staleSnapshot = await getDueOutbox(database, NOW_MS);
		await database.outbox.toCollection().modify((row) => {
			row.status = 'publishing';
			row.updatedAt = NOW_MS;
		});

		const claimed = await claimDueOutboxRows(database, wrapped.rumor.id, staleSnapshot, NOW_MS);
		expect(claimed).toEqual([]);
	});

	it('recovers exact events left publishing by an interrupted worker after the lease', async () => {
		const { database, wrapped } = await fixture();
		const message = await database.messages.toCollection().first();
		if (!message) throw new Error('fixture message is missing');
		let state = createMessageState(message.rumorId, NOW_MS);
		state = transitionMessageState(state, 'encrypted_and_signed', NOW_MS);
		state = transitionMessageState(state, 'queued', NOW_MS, 'durable outbox ready');
		state = transitionMessageState(state, 'publishing', NOW_MS, 'relay publication started');
		await database.messages.put({
			...message,
			state: state.state,
			stateHistory: state.history,
			attempts: state.attempts,
			updatedAt: state.updatedAt
		});
		await database.outbox.toCollection().modify((row) => {
			row.status = 'publishing';
			row.attempt = 1;
			row.updatedAt = NOW_MS;
		});

		const publishedIds: string[] = [];
		await runOutboxBatch(
			database,
			async (_relay, event) => {
				publishedIds.push(event.id);
				return { accepted: true, message: 'saved' };
			},
			NOW_MS + OUTBOX_PUBLISH_LEASE_MS + 1
		);

		expect(publishedIds.sort()).toEqual([wrapped.recipient.wrap.id, wrapped.sender.wrap.id].sort());
		expect((await database.messages.get(wrapped.rumor.id))?.state).toBe('network_accepted');
	});

	it('rejects corrupted persisted events before network publication', async () => {
		const { database, wrapped } = await fixture();
		const id = `${wrapped.recipient.wrap.id}:wss://recipient.one/`;
		await database.outbox.update(id, { eventJson: '{"kind":1059}' });
		const publisher = vi.fn<RelayPublisher>();
		await runOutboxBatch(database, publisher, NOW_MS);
		expect(publisher).toHaveBeenCalledTimes(1);
		const corrupted = await database.outbox.get(id);
		expect(corrupted?.status).toBe('rejected');
		expect(corrupted?.lastError).toMatch(/corrupt|invalid/i);
	});
});
