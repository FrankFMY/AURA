import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	finalizeEvent,
	generateSecretKey,
	getPublicKey,
	type Event,
	type Filter
} from 'nostr-tools';
import { UnlockedSession } from '../custody/session';
import { AccountDatabase, commitOutgoingMessage } from '../storage/account-database';
import { RECEIVE_CURSOR_OVERLAP_SECONDS } from '../storage/inbox';
import { createWrappedDirectMessage } from './gift-wrap';
import { OUTBOX_RECONCILIATION_INTERVAL_MS, MessengerRuntime } from './messenger-runtime';
import type { RelayPool } from './relay-client';

const NOW_SECONDS = 1_750_000_000;
const NOW_MS = NOW_SECONDS * 1000;
const databases: AccountDatabase[] = [];

function relayList(secretKey: Uint8Array, relays: string[]) {
	return finalizeEvent(
		{
			kind: 10050,
			tags: relays.map((relay) => ['relay', relay]),
			content: '',
			created_at: NOW_SECONDS - 1
		},
		secretKey
	);
}

function fakePool(events: Event[] = []) {
	const subscriptions: Array<{
		filter: Filter;
		onevent: (event: Event) => void;
		oneose: () => void;
		onclose: (reasons: string[]) => void;
		relays: string[];
		closeReasons: string[];
	}> = [];
	let subscription: (typeof subscriptions)[number] | undefined;
	const published: { relay: string; event: Event }[] = [];
	const pool: RelayPool = {
		querySync: async () => events,
		publish: (relays, event) => {
			published.push({ relay: relays[0], event });
			return [Promise.resolve('saved')];
		},
		subscribeMany: (relays, filter, params) => {
			const current = {
				relays,
				filter,
				onevent: params.onevent ?? (() => undefined),
				oneose: params.oneose ?? (() => undefined),
				onclose: params.onclose ?? (() => undefined),
				closeReasons: [] as string[]
			};
			subscription = current;
			subscriptions.push(current);
			return { close: (reason?: string) => current.closeReasons.push(reason ?? '') };
		}
	};
	return {
		pool,
		published,
		subscriptions,
		get subscription() {
			return subscription;
		}
	};
}

function runtime(
	pool: RelayPool,
	secretKey = generateSecretKey(),
	now = () => ({ seconds: NOW_SECONDS, milliseconds: NOW_MS }),
	reconciliationIntervalMs = OUTBOX_RECONCILIATION_INTERVAL_MS
) {
	const pubkey = getPublicKey(secretKey);
	const database = new AccountDatabase(pubkey, `runtime-${crypto.randomUUID()}`);
	databases.push(database);
	return {
		secretKey,
		pubkey,
		database,
		runtime: new MessengerRuntime({
			session: new UnlockedSession(secretKey),
			database,
			pool,
			lookupRelays: ['wss://lookup.one/'],
			accountDmRelays: ['wss://sender.one/'],
			recoveryConfirmed: true,
			now,
			reconciliationIntervalMs
		})
	};
}

afterEach(async () => {
	await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('messenger runtime', () => {
	it('does zero publication and zero persistence when recipient has no kind-10050 list', async () => {
		const network = fakePool();
		const app = runtime(network.pool);
		await app.runtime.start();
		await expect(app.runtime.send(getPublicKey(generateSecretKey()), 'Hello')).rejects.toThrow(
			/recipient_not_dm_ready/i
		);
		expect(network.published).toHaveLength(0);
		expect(await app.database.messages.count()).toBe(0);
	});

	it('publishes its signed DM relay preference before becoming discoverable', async () => {
		const network = fakePool();
		const app = runtime(network.pool);
		await app.runtime.start();
		const event = await app.runtime.publishOwnRelayList();
		expect(event.kind).toBe(10050);
		expect(event.pubkey).toBe(app.pubkey);
		expect(event.tags).toEqual([['relay', 'wss://sender.one/']]);
		expect(network.published).toEqual([
			expect.objectContaining({ relay: 'wss://lookup.one/', event })
		]);
	});

	it('durably sends two copies, records ACK and decrypts its local history', async () => {
		const recipientSecret = generateSecretKey();
		const recipientPubkey = getPublicKey(recipientSecret);
		const network = fakePool([relayList(recipientSecret, ['wss://recipient.one/'])]);
		const app = runtime(network.pool);
		await app.runtime.start();
		const rumorId = await app.runtime.send(recipientPubkey, 'A quiet, private hello.');
		expect(network.published.map((item) => item.relay).sort()).toEqual([
			'wss://recipient.one/',
			'wss://sender.one/'
		]);
		expect((await app.database.messages.get(rumorId))?.state).toBe('network_accepted');
		expect(await app.runtime.readConversation(recipientPubkey)).toEqual([
			expect.objectContaining({
				rumorId,
				content: 'A quiet, private hello.',
				direction: 'outgoing'
			})
		]);
	});

	it('refuses sending before recovery confirmation', async () => {
		const network = fakePool();
		const secretKey = generateSecretKey();
		const pubkey = getPublicKey(secretKey);
		const database = new AccountDatabase(pubkey, `gate-${crypto.randomUUID()}`);
		databases.push(database);
		const app = new MessengerRuntime({
			session: new UnlockedSession(secretKey),
			database,
			pool: network.pool,
			lookupRelays: ['wss://lookup.one/'],
			accountDmRelays: ['wss://sender.one/'],
			recoveryConfirmed: false,
			now: () => ({ seconds: NOW_SECONDS, milliseconds: NOW_MS })
		});
		await app.start();
		await expect(app.send(getPublicKey(generateSecretKey()), 'Hello')).rejects.toThrow(/recovery/i);
		expect(network.published).toHaveLength(0);
	});

	it('reconciles a persisted due outbox without requiring a new message', async () => {
		const recipientSecret = generateSecretKey();
		const recipientPubkey = getPublicKey(recipientSecret);
		const network = fakePool();
		const app = runtime(network.pool);
		await app.runtime.start();
		const wrapped = createWrappedDirectMessage({
			senderSecretKey: app.secretKey,
			recipientPubkey,
			content: 'Persist before crash.',
			createdAt: NOW_SECONDS
		});
		await commitOutgoingMessage(app.database, {
			wrapped,
			recipientRelays: ['wss://recipient.one/'],
			senderRelays: ['wss://sender.one/'],
			committedAt: NOW_MS
		});
		expect(network.published).toHaveLength(0);
		await app.runtime.reconcileOutbox();
		expect(network.published.map(({ event }) => event.id).sort()).toEqual(
			[wrapped.recipient.wrap.id, wrapped.sender.wrap.id].sort()
		);
		expect((await app.database.messages.get(wrapped.rumor.id))?.state).toBe('network_accepted');
	});

	it('starts a fresh outbox drain after the previous run has settled', async () => {
		const recipientSecret = generateSecretKey();
		const recipientPubkey = getPublicKey(recipientSecret);
		const network = fakePool();
		const app = runtime(network.pool);
		await app.runtime.start();
		await expect(app.runtime.reconcileOutbox()).resolves.toBe(0);
		const wrapped = createWrappedDirectMessage({
			senderSecretKey: app.secretKey,
			recipientPubkey,
			content: 'Committed after a settled drain.',
			createdAt: NOW_SECONDS
		});
		await commitOutgoingMessage(app.database, {
			wrapped,
			recipientRelays: ['wss://recipient.one/'],
			senderRelays: ['wss://sender.one/'],
			committedAt: NOW_MS
		});

		await expect(app.runtime.reconcileOutbox()).resolves.toBe(2);
		expect(network.published.map(({ event }) => event.id).sort()).toEqual(
			[wrapped.recipient.wrap.id, wrapped.sender.wrap.id].sort()
		);
		expect((await app.database.messages.get(wrapped.rumor.id))?.state).toBe('network_accepted');
	});

	it('periodically retries transient outbox failures while the runtime is started', async () => {
		let milliseconds = NOW_MS;
		const recipientSecret = generateSecretKey();
		const recipientPubkey = getPublicKey(recipientSecret);
		const network = fakePool([relayList(recipientSecret, ['wss://recipient.one/'])]);
		let attempts = 0;
		network.pool.publish = () => {
			attempts += 1;
			return [attempts <= 2 ? Promise.reject(new Error('offline')) : Promise.resolve('saved')];
		};
		const app = runtime(
			network.pool,
			generateSecretKey(),
			() => ({ seconds: Math.floor(milliseconds / 1000), milliseconds }),
			10
		);
		const subscription = await app.runtime.start();
		const rumorId = await app.runtime.send(recipientPubkey, 'Retry without another send.');
		expect((await app.database.messages.get(rumorId))?.state).toBe('retry_wait');

		milliseconds += 2_000;
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(attempts).toBe(4);
		expect((await app.database.messages.get(rumorId))?.state).toBe('network_accepted');
		subscription.close();
	});

	it('cancels send before persistence when stopped during recipient discovery', async () => {
		const recipientSecret = generateSecretKey();
		const recipientPubkey = getPublicKey(recipientSecret);
		const network = fakePool();
		let releaseDiscovery!: (events: Event[]) => void;
		const discovery = new Promise<Event[]>((resolve) => {
			releaseDiscovery = resolve;
		});
		const query = vi.fn(() => discovery);
		network.pool.querySync = query;
		const app = runtime(network.pool);
		await app.runtime.start();

		const sending = app.runtime.send(recipientPubkey, 'Do not commit after stop.');
		await vi.waitFor(() => expect(query).toHaveBeenCalledOnce());
		app.runtime.stop();
		releaseDiscovery([relayList(recipientSecret, ['wss://recipient.one/'])]);

		await expect(sending).rejects.toThrow(/operation cancelled/i);
		expect(await app.database.messages.count()).toBe(0);
		expect(network.published).toHaveLength(0);
	});

	it('does not persist outbox outcomes after stop during publication', async () => {
		const recipientSecret = generateSecretKey();
		const recipientPubkey = getPublicKey(recipientSecret);
		const network = fakePool();
		let releasePublish!: (message: string) => void;
		const publication = new Promise<string>((resolve) => {
			releasePublish = resolve;
		});
		const publish = vi.fn(() => [publication]);
		network.pool.publish = publish;
		const app = runtime(network.pool);
		await app.runtime.start();
		const wrapped = createWrappedDirectMessage({
			senderSecretKey: app.secretKey,
			recipientPubkey,
			content: 'Persisted before reconciliation.',
			createdAt: NOW_SECONDS
		});
		await commitOutgoingMessage(app.database, {
			wrapped,
			recipientRelays: ['wss://recipient.one/'],
			senderRelays: ['wss://sender.one/'],
			committedAt: NOW_MS
		});

		const reconciling = app.runtime.reconcileOutbox();
		await vi.waitFor(() => expect(publish).toHaveBeenCalled());
		app.runtime.stop();
		releasePublish('saved');

		await expect(reconciling).rejects.toThrow(/operation cancelled/i);
		expect((await app.database.messages.get(wrapped.rumor.id))?.state).toBe('publishing');
		expect(
			(await app.database.outbox.where('rumorId').equals(wrapped.rumor.id).toArray()).every(
				(row) => row.status === 'publishing'
			)
		).toBe(true);
	});

	it('reports malformed incoming events without declaring a transport failure', async () => {
		const secretKey = generateSecretKey();
		const pubkey = getPublicKey(secretKey);
		const database = new AccountDatabase(pubkey, `invalid-${crypto.randomUUID()}`);
		databases.push(database);
		const network = fakePool();
		const onReceiveError = vi.fn();
		const onTransportError = vi.fn();
		const messenger = new MessengerRuntime({
			session: new UnlockedSession(secretKey),
			database,
			pool: network.pool,
			lookupRelays: ['wss://lookup.one/'],
			accountDmRelays: ['wss://sender.one/'],
			recoveryConfirmed: true,
			maxPendingIncoming: 1,
			onReceiveError,
			onTransportError
		});
		await messenger.start();
		const malformed = finalizeEvent(
			{
				kind: 1059,
				tags: [['p', pubkey]],
				content: 'not encrypted',
				created_at: NOW_SECONDS
			},
			generateSecretKey()
		);
		const firstSubscription = network.subscription!;
		firstSubscription.onevent(malformed);
		firstSubscription.onevent(malformed);
		await vi.waitFor(() => expect(network.subscriptions).toHaveLength(2));
		expect(firstSubscription.closeReasons).toContain('incoming receive queue saturated; replaying');
		await vi.waitFor(() => expect(onReceiveError).toHaveBeenCalledOnce());
		expect(onTransportError).not.toHaveBeenCalled();
		network.subscription?.onclose(['offline']);
		expect(onTransportError).toHaveBeenCalledOnce();
		messenger.stop();
	});

	it('invalidates a pending saturation replay across stop and restart', async () => {
		const secretKey = generateSecretKey();
		const pubkey = getPublicKey(secretKey);
		const database = new AccountDatabase(pubkey, `restart-${crypto.randomUUID()}`);
		databases.push(database);
		const network = fakePool();
		const onTransportError = vi.fn();
		const messenger = new MessengerRuntime({
			session: new UnlockedSession(secretKey),
			database,
			pool: network.pool,
			lookupRelays: ['wss://lookup.one/'],
			accountDmRelays: ['wss://sender.one/'],
			recoveryConfirmed: true,
			maxPendingIncoming: 1,
			onTransportError
		});
		await messenger.start();
		const malformed = finalizeEvent(
			{
				kind: 1059,
				tags: [['p', pubkey]],
				content: 'not encrypted',
				created_at: NOW_SECONDS
			},
			generateSecretKey()
		);
		const firstSubscription = network.subscription!;
		firstSubscription.onevent(malformed);
		firstSubscription.onevent(malformed);
		messenger.stop();
		await messenger.start();
		const restartedSubscription = network.subscription!;
		restartedSubscription.onclose(['new-generation close']);
		expect(onTransportError).toHaveBeenCalledOnce();
		restartedSubscription.onevent(malformed);
		restartedSubscription.onevent(malformed);
		await vi.waitFor(() => expect(network.subscriptions).toHaveLength(3));

		expect(restartedSubscription.closeReasons).toContain(
			'incoming receive queue saturated; replaying'
		);
		messenger.stop();
	});

	it('does not let a stale start closer stop a newer runtime generation', async () => {
		const network = fakePool();
		const app = runtime(network.pool);
		const firstCloser = await app.runtime.start();
		app.runtime.stop();
		await app.runtime.start();
		const currentSubscription = network.subscriptions.at(-1)!;

		firstCloser.close('stale closer');
		expect(currentSubscription.closeReasons).toEqual([]);
		await expect(app.runtime.reconcileOutbox()).resolves.toBe(0);
	});

	it('rejects fresh public operations after stop without new side effects', async () => {
		const network = fakePool();
		const app = runtime(network.pool);
		await app.runtime.start();
		app.runtime.stop();

		await expect(
			app.runtime.send(getPublicKey(generateSecretKey()), 'Must not start after stop.')
		).rejects.toThrow(/not started/i);
		await expect(app.runtime.reconcileOutbox()).rejects.toThrow(/not started/i);
		await expect(app.runtime.publishOwnRelayList()).rejects.toThrow(/not started/i);
		await expect(app.runtime.readConversation(getPublicKey(generateSecretKey()))).rejects.toThrow(
			/not started/i
		);
		expect(network.published).toHaveLength(0);
		expect(await app.database.messages.count()).toBe(0);
	});

	it('does not finish startup after stop invalidates the runtime generation', async () => {
		const network = fakePool();
		const app = runtime(network.pool, generateSecretKey(), undefined, 10);
		let releaseCursor!: () => void;
		const cursorGate = new Promise<void>((resolve) => {
			releaseCursor = resolve;
		});
		const originalGet = app.database.relayCursors.get.bind(app.database.relayCursors);
		const cursorSpy = vi
			.spyOn(app.database.relayCursors, 'get')
			.mockImplementation(((key: { [key: string]: unknown }) =>
				cursorGate.then(() => originalGet(key))) as never);

		const starting = app.runtime.start();
		await vi.waitFor(() => expect(cursorSpy).toHaveBeenCalledOnce());
		app.runtime.stop();
		releaseCursor();
		await expect(starting).rejects.toThrow(/stopped during startup/i);
		expect(network.subscriptions).toHaveLength(0);
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(network.published).toHaveLength(0);
	});

	it('ignores event, EOSE, and close callbacks from a stopped generation', async () => {
		const recipientSecret = generateSecretKey();
		const recipientPubkey = getPublicKey(recipientSecret);
		const senderSecret = generateSecretKey();
		const network = fakePool();
		const onReceiveError = vi.fn();
		const onTransportError = vi.fn();
		const database = new AccountDatabase(recipientPubkey, `late-${crypto.randomUUID()}`);
		databases.push(database);
		const messenger = new MessengerRuntime({
			session: new UnlockedSession(recipientSecret),
			database,
			pool: network.pool,
			lookupRelays: ['wss://lookup.one/'],
			accountDmRelays: ['wss://sender.one/'],
			recoveryConfirmed: true,
			now: () => ({ seconds: NOW_SECONDS, milliseconds: NOW_MS }),
			onReceiveError,
			onTransportError
		});
		await messenger.start();
		const stoppedSubscription = network.subscription!;
		messenger.stop();
		const wrapped = createWrappedDirectMessage({
			content: 'Must stay outside a stopped runtime.',
			senderSecretKey: senderSecret,
			recipientPubkey,
			createdAt: NOW_SECONDS,
			randomPastTimestamp: () => NOW_SECONDS - 1
		});

		stoppedSubscription.onevent(wrapped.recipient.wrap);
		stoppedSubscription.oneose();
		stoppedSubscription.onclose(['late close']);
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(await database.messages.get(wrapped.rumor.id)).toBeUndefined();
		expect(await database.relayCursors.get('wss://sender.one/')).toBeUndefined();
		expect(onReceiveError).not.toHaveBeenCalled();
		expect(onTransportError).not.toHaveBeenCalled();
	});

	it('rolls back an incoming callback already inside persistence when stopped', async () => {
		const recipientSecret = generateSecretKey();
		const recipientPubkey = getPublicKey(recipientSecret);
		const senderSecret = generateSecretKey();
		const network = fakePool();
		const onReceiveError = vi.fn();
		const database = new AccountDatabase(recipientPubkey, `inflight-${crypto.randomUUID()}`);
		databases.push(database);
		const messenger = new MessengerRuntime({
			session: new UnlockedSession(recipientSecret),
			database,
			pool: network.pool,
			lookupRelays: ['wss://lookup.one/'],
			accountDmRelays: ['wss://sender.one/'],
			recoveryConfirmed: true,
			now: () => ({ seconds: NOW_SECONDS, milliseconds: NOW_MS }),
			onReceiveError
		});
		await messenger.start();
		let releaseLookup!: () => void;
		const lookupGate = new Promise<void>((resolve) => {
			releaseLookup = resolve;
		});
		const originalGet = database.messages.get.bind(database.messages);
		const lookup = vi
			.spyOn(database.messages, 'get')
			.mockImplementation(((key: string) => lookupGate.then(() => originalGet(key))) as never);
		const wrapped = createWrappedDirectMessage({
			content: 'Must roll back after stop.',
			senderSecretKey: senderSecret,
			recipientPubkey,
			createdAt: NOW_SECONDS,
			randomPastTimestamp: () => NOW_SECONDS - 1
		});

		network.subscription!.onevent(wrapped.recipient.wrap);
		await vi.waitFor(() => expect(lookup).toHaveBeenCalledOnce());
		messenger.stop();
		releaseLookup();
		await vi.waitFor(async () => expect(await database.messages.count()).toBe(0));
		expect(await database.wireCopies.count()).toBe(0);
		expect(await database.inboxReceipts.count()).toBe(0);
		expect(onReceiveError).not.toHaveBeenCalled();
	});

	it('invalidates relay-list publication completion after stop', async () => {
		const network = fakePool();
		let releasePublish!: (message: string) => void;
		const publication = new Promise<string>((resolve) => {
			releasePublish = resolve;
		});
		const publish = vi.fn(() => [publication]);
		network.pool.publish = publish;
		const app = runtime(network.pool);
		await app.runtime.start();

		const publishing = app.runtime.publishOwnRelayList();
		await vi.waitFor(() => expect(publish).toHaveBeenCalledOnce());
		app.runtime.stop();
		releasePublish('saved');
		await expect(publishing).rejects.toThrow(/operation cancelled/i);
	});

	it('closes already opened relay subscriptions when startup partially fails', async () => {
		const secretKey = generateSecretKey();
		const pubkey = getPublicKey(secretKey);
		const database = new AccountDatabase(pubkey, `partial-${crypto.randomUUID()}`);
		databases.push(database);
		const closeFirst = vi.fn();
		let calls = 0;
		const network = fakePool();
		network.pool.subscribeMany = () => {
			calls += 1;
			if (calls === 1) return { close: closeFirst };
			throw new Error('second relay unavailable');
		};
		const messenger = new MessengerRuntime({
			session: new UnlockedSession(secretKey),
			database,
			pool: network.pool,
			lookupRelays: ['wss://lookup.one/'],
			accountDmRelays: ['wss://sender.one/', 'wss://sender.two/'],
			recoveryConfirmed: true
		});

		await expect(messenger.start()).rejects.toThrow(/second relay unavailable/i);
		expect(closeFirst).toHaveBeenCalledOnce();
	});

	it('subscribes to own relays and commits validated incoming wraps', async () => {
		const recipientSecret = generateSecretKey();
		const recipientPubkey = getPublicKey(recipientSecret);
		const senderSecret = generateSecretKey();
		const network = fakePool();
		const app = runtime(network.pool, recipientSecret);
		await app.runtime.start();
		expect(network.subscription?.filter).toEqual({
			kinds: [1059],
			'#p': [recipientPubkey],
			since: 0
		});
		const { createWrappedDirectMessage } = await import('./gift-wrap');
		const wrapped = createWrappedDirectMessage({
			content: 'Received from relay.',
			senderSecretKey: senderSecret,
			recipientPubkey,
			createdAt: NOW_SECONDS,
			randomPastTimestamp: () => NOW_SECONDS - 1
		});
		network.subscription?.onevent(wrapped.recipient.wrap);
		await vi.waitFor(async () => {
			expect(await app.database.messages.get(wrapped.rumor.id)).toBeDefined();
		});
		network.subscription?.oneose();
		await vi.waitFor(async () => {
			expect((await app.database.relayCursors.get('wss://sender.one/'))?.initialSyncComplete).toBe(
				true
			);
		});
		app.runtime.stop();

		const resumedNetwork = fakePool();
		const resumed = new MessengerRuntime({
			session: new UnlockedSession(recipientSecret),
			database: app.database,
			pool: resumedNetwork.pool,
			lookupRelays: ['wss://lookup.one/'],
			accountDmRelays: ['wss://sender.one/'],
			recoveryConfirmed: true,
			now: () => ({ seconds: NOW_SECONDS, milliseconds: NOW_MS })
		});
		await resumed.start();
		expect(resumedNetwork.subscription?.filter.since).toBe(
			Math.max(0, wrapped.recipient.wrap.created_at - RECEIVE_CURSOR_OVERLAP_SECONDS)
		);
		resumed.stop();
	});
});
