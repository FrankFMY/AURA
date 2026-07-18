import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { createWrappedDirectMessage } from '../nostr/gift-wrap';
import { AccountDatabase, commitOutgoingMessage, getDueOutbox } from './account-database';

const NOW_SECONDS = 1_750_000_000;
const NOW_MS = NOW_SECONDS * 1000;
const databases: AccountDatabase[] = [];

function db(pubkey: string) {
	const value = new AccountDatabase(pubkey, `test-${crypto.randomUUID()}`);
	databases.push(value);
	return value;
}

function wrapped() {
	const senderSecretKey = generateSecretKey();
	const recipientPubkey = getPublicKey(generateSecretKey());
	return {
		senderPubkey: getPublicKey(senderSecretKey),
		recipientPubkey,
		message: createWrappedDirectMessage({
			content: 'Persist ciphertext, not this plaintext.',
			senderSecretKey,
			recipientPubkey,
			createdAt: NOW_SECONDS,
			randomPastTimestamp: () => NOW_SECONDS - 1
		})
	};
}

afterEach(async () => {
	await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('account-scoped message persistence', () => {
	it('atomically stores one logical message, two wire copies and relay outbox rows', async () => {
		const fixture = wrapped();
		const database = db(fixture.senderPubkey);
		await commitOutgoingMessage(database, {
			wrapped: fixture.message,
			recipientRelays: ['wss://recipient.one/', 'wss://recipient.two/'],
			senderRelays: ['wss://sender.one/'],
			committedAt: NOW_MS
		});

		expect(await database.messages.count()).toBe(1);
		expect(await database.wireCopies.count()).toBe(2);
		expect(await database.outbox.count()).toBe(3);
		const records = JSON.stringify({
			messages: await database.messages.toArray(),
			wires: await database.wireCopies.toArray(),
			outbox: await database.outbox.toArray()
		});
		expect(records).not.toContain('Persist ciphertext, not this plaintext.');
		const stored = await database.messages.get(fixture.message.rumor.id);
		expect(stored?.state).toBe('encrypted_and_signed');
		expect(stored?.stateHistory.map((entry) => entry.to)).toEqual([
			'locally_created',
			'encrypted_and_signed'
		]);
		expect(stored?.attempts).toBe(0);
	});

	it('is idempotent for an exact persisted rumor and rejects conflicting reuse', async () => {
		const fixture = wrapped();
		const database = db(fixture.senderPubkey);
		const input = {
			wrapped: fixture.message,
			recipientRelays: ['wss://recipient.one/'],
			senderRelays: ['wss://sender.one/'],
			committedAt: NOW_MS
		};
		await commitOutgoingMessage(database, input);
		await commitOutgoingMessage(database, input);
		expect(await database.messages.count()).toBe(1);
		expect(await database.wireCopies.count()).toBe(2);
		expect(await database.outbox.count()).toBe(2);
	});

	it('rolls the whole transaction back when outbox persistence fails', async () => {
		const fixture = wrapped();
		const database = db(fixture.senderPubkey);
		const bulkPut = vi.spyOn(database.outbox, 'bulkPut').mockImplementation(() => {
			throw new Error('simulated quota failure');
		});
		await expect(
			commitOutgoingMessage(database, {
				wrapped: fixture.message,
				recipientRelays: ['wss://recipient.one/'],
				senderRelays: ['wss://sender.one/'],
				committedAt: NOW_MS
			})
		).rejects.toThrow(/quota/i);
		bulkPut.mockRestore();
		expect(await database.messages.count()).toBe(0);
		expect(await database.wireCopies.count()).toBe(0);
	});

	it('physically isolates different account databases', async () => {
		const fixture = wrapped();
		const accountA = db(fixture.senderPubkey);
		const accountB = db(getPublicKey(generateSecretKey()));
		await commitOutgoingMessage(accountA, {
			wrapped: fixture.message,
			recipientRelays: ['wss://recipient.one/'],
			senderRelays: ['wss://sender.one/'],
			committedAt: NOW_MS
		});
		expect(await accountA.messages.count()).toBe(1);
		expect(await accountB.messages.count()).toBe(0);
		expect(accountA.name).not.toBe(accountB.name);
	});

	it('returns only due exact-event outbox work', async () => {
		const fixture = wrapped();
		const database = db(fixture.senderPubkey);
		await commitOutgoingMessage(database, {
			wrapped: fixture.message,
			recipientRelays: ['wss://recipient.one/'],
			senderRelays: ['wss://sender.one/'],
			committedAt: NOW_MS
		});
		const due = await getDueOutbox(database, NOW_MS);
		expect(due).toHaveLength(2);
		expect(due.every((item) => item.eventJson.includes(item.wrapId))).toBe(true);
	});
});
