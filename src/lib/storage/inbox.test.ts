import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { createWrappedDirectMessage, type Rumor } from '../nostr/gift-wrap';
import { AccountDatabase } from './account-database';
import {
	commitIncomingWrap,
	conversationPubkeyForRumor,
	getRelaySubscriptionSince,
	markRelayInitialSyncComplete,
	RECEIVE_CURSOR_OVERLAP_SECONDS
} from './inbox';

const NOW_SECONDS = 1_750_000_000;
const NOW_MS = NOW_SECONDS * 1000;
const databases: AccountDatabase[] = [];

function fixture() {
	const senderSecretKey = generateSecretKey();
	const recipientSecretKey = generateSecretKey();
	const recipientPubkey = getPublicKey(recipientSecretKey);
	const wrapped = createWrappedDirectMessage({
		content: 'Incoming plaintext must not persist.',
		senderSecretKey,
		recipientPubkey,
		createdAt: NOW_SECONDS,
		randomPastTimestamp: () => NOW_SECONDS - 1
	});
	const database = new AccountDatabase(recipientPubkey, `inbox-${crypto.randomUUID()}`);
	databases.push(database);
	return { database, senderSecretKey, recipientSecretKey, wrapped };
}

afterEach(async () => {
	await Promise.all(databases.splice(0).map((database) => database.delete()));
});

describe('incoming Gift Wrap persistence', () => {
	it('stores a validated recipient copy without plaintext at rest', async () => {
		const { database, recipientSecretKey, wrapped } = fixture();
		await commitIncomingWrap(database, {
			wrap: wrapped.recipient.wrap,
			accountSecretKey: recipientSecretKey,
			relayUrl: 'wss://recipient.one/',
			receivedAt: NOW_MS,
			now: NOW_SECONDS
		});
		const message = await database.messages.get(wrapped.rumor.id);
		expect(message).toMatchObject({ direction: 'incoming', state: 'received' });
		expect(await database.wireCopies.count()).toBe(1);
		expect(await database.inboxReceipts.count()).toBe(1);
		expect(await getRelaySubscriptionSince(database, 'wss://recipient.one/')).toBe(0);
		await markRelayInitialSyncComplete(database, 'wss://recipient.one/', NOW_MS);
		expect(await getRelaySubscriptionSince(database, 'wss://recipient.one/')).toBe(
			Math.max(0, wrapped.recipient.wrap.created_at - RECEIVE_CURSOR_OVERLAP_SECONDS)
		);
		const persisted = await Promise.all(database.tables.map((table) => table.toArray()));
		expect(JSON.stringify(persisted)).not.toContain('Incoming plaintext must not persist.');
	});

	it('deduplicates a wrap seen on multiple relays while preserving receipt evidence', async () => {
		const { database, recipientSecretKey, wrapped } = fixture();
		for (const relayUrl of ['wss://recipient.one/', 'wss://recipient.two/']) {
			await commitIncomingWrap(database, {
				wrap: wrapped.recipient.wrap,
				accountSecretKey: recipientSecretKey,
				relayUrl,
				receivedAt: NOW_MS,
				now: NOW_SECONDS
			});
		}
		expect(await database.messages.count()).toBe(1);
		expect(await database.wireCopies.count()).toBe(1);
		expect(await database.inboxReceipts.count()).toBe(2);
	});

	it('finds the recipient tag without changing canonical rumor tag order', () => {
		const senderPubkey = getPublicKey(generateSecretKey());
		const recipientPubkey = getPublicKey(generateSecretKey());
		const rumor = {
			id: '11'.repeat(32),
			pubkey: senderPubkey,
			created_at: NOW_SECONDS,
			kind: 14,
			tags: [
				['subject', 'A subject'],
				['p', recipientPubkey]
			],
			content: 'Hello'
		} as Rumor;

		expect(conversationPubkeyForRumor(rumor, recipientPubkey)).toBe(senderPubkey);
		expect(conversationPubkeyForRumor(rumor, senderPubkey)).toBe(recipientPubkey);
		expect(rumor.tags[0]).toEqual(['subject', 'A subject']);
	});

	it('does not write anything for an invalid outer signature', async () => {
		const { database, recipientSecretKey, wrapped } = fixture();
		const first = wrapped.recipient.wrap.sig[0] === '0' ? '1' : '0';
		const tampered = {
			...wrapped.recipient.wrap,
			sig: `${first}${wrapped.recipient.wrap.sig.slice(1)}`
		};
		await expect(
			commitIncomingWrap(database, {
				wrap: tampered,
				accountSecretKey: recipientSecretKey,
				relayUrl: 'wss://recipient.one/',
				receivedAt: NOW_MS,
				now: NOW_SECONDS
			})
		).rejects.toThrow(/signature|event ID/i);
		expect(await database.messages.count()).toBe(0);
		expect(await database.wireCopies.count()).toBe(0);
	});

	it('restores an outgoing logical message from its sender copy without claiming delivery', async () => {
		const { senderSecretKey, wrapped } = fixture();
		const senderPubkey = getPublicKey(senderSecretKey);
		const database = new AccountDatabase(senderPubkey, `sender-${crypto.randomUUID()}`);
		databases.push(database);
		await commitIncomingWrap(database, {
			wrap: wrapped.sender.wrap,
			accountSecretKey: senderSecretKey,
			relayUrl: 'wss://sender.one/',
			receivedAt: NOW_MS,
			now: NOW_SECONDS
		});
		const message = await database.messages.get(wrapped.rumor.id);
		expect(message).toMatchObject({ direction: 'outgoing', state: 'restored' });
	});
});
