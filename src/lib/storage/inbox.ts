import { getPublicKey, type Event } from 'nostr-tools';
import {
	assertOperationCurrent,
	operationAlwaysCurrent,
	type OperationGuard
} from '../core/operation-guard';
import { normalizeDmRelayUrls } from '../nostr/dm-relays';
import { unwrapDirectMessage, type Rumor } from '../nostr/gift-wrap';
import {
	type AccountDatabase,
	type InboxReceiptRecord,
	type MessageRecord,
	type RelayCursorRecord,
	type WireCopyRecord
} from './account-database';

export const RECEIVE_CURSOR_OVERLAP_SECONDS = 2 * 24 * 60 * 60 + 5 * 60;

export interface CommitIncomingWrapInput {
	wrap: Event;
	accountSecretKey: Uint8Array;
	relayUrl: string;
	receivedAt: number;
	now: number;
}

function assertTimestamp(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`);
}

export async function getRelaySubscriptionSince(
	database: AccountDatabase,
	relay: string
): Promise<number> {
	const [relayUrl] = normalizeDmRelayUrls([relay]);
	const cursor = await database.relayCursors.get(relayUrl);
	if (!cursor?.initialSyncComplete) return 0;
	return Math.max(0, cursor.maxEventCreatedAt - RECEIVE_CURSOR_OVERLAP_SECONDS);
}

export async function markRelayInitialSyncComplete(
	database: AccountDatabase,
	relay: string,
	completedAt: number,
	isCurrent: OperationGuard = operationAlwaysCurrent
): Promise<void> {
	assertOperationCurrent(isCurrent);
	assertTimestamp(completedAt, 'completedAt');
	const [relayUrl] = normalizeDmRelayUrls([relay]);
	await database.transaction('rw', database.relayCursors, async () => {
		assertOperationCurrent(isCurrent);
		const existing = await database.relayCursors.get(relayUrl);
		assertOperationCurrent(isCurrent);
		await database.relayCursors.put({
			relayUrl,
			maxEventCreatedAt: existing?.maxEventCreatedAt ?? 0,
			initialSyncComplete: true,
			updatedAt: Math.max(existing?.updatedAt ?? 0, completedAt)
		});
		assertOperationCurrent(isCurrent);
	});
	assertOperationCurrent(isCurrent);
}

export function conversationPubkeyForRumor(rumor: Rumor, accountPubkey: string): string {
	const recipientTag = rumor.tags.find(
		(tag) => Array.isArray(tag) && tag[0] === 'p' && typeof tag[1] === 'string'
	);
	if (!recipientTag) throw new Error('rumor recipient tag is missing');
	const recipientPubkey = recipientTag[1];
	if (accountPubkey === rumor.pubkey) return recipientPubkey;
	if (accountPubkey === recipientPubkey) return rumor.pubkey;
	throw new Error('active account is not a rumor participant');
}

export async function commitIncomingWrap(
	database: AccountDatabase,
	input: CommitIncomingWrapInput,
	isCurrent: OperationGuard = operationAlwaysCurrent
): Promise<string> {
	assertOperationCurrent(isCurrent);
	assertTimestamp(input.receivedAt, 'receivedAt');
	assertTimestamp(input.now, 'now');
	const [relayUrl] = normalizeDmRelayUrls([input.relayUrl]);
	let accountPubkey: string;
	try {
		accountPubkey = getPublicKey(input.accountSecretKey);
	} catch {
		throw new Error('account secret key is invalid');
	}
	if (accountPubkey !== database.accountPubkey) {
		throw new Error('account key does not belong to this database');
	}

	// This performs all hash/signature, author-binding, participant and size checks
	// before any storage transaction starts.
	const rumor = unwrapDirectMessage({
		wrap: input.wrap,
		accountSecretKey: input.accountSecretKey,
		now: input.now
	});
	const incoming = rumor.pubkey !== accountPubkey;
	const conversationPubkey = conversationPubkeyForRumor(rumor, accountPubkey);
	const state = incoming ? 'received' : 'restored';
	const audience = incoming ? 'recipient' : 'sender';
	const message: MessageRecord = {
		rumorId: rumor.id,
		accountPubkey,
		conversationPubkey,
		direction: incoming ? 'incoming' : 'outgoing',
		state,
		stateHistory: [
			{
				from: null,
				to: state,
				at: input.receivedAt,
				reason: incoming
					? 'validated recipient Gift Wrap received'
					: 'validated sender-copy Gift Wrap restored'
			}
		],
		attempts: 0,
		createdAt: rumor.created_at,
		updatedAt: input.receivedAt,
		...(incoming ? { recipientWrapId: input.wrap.id } : { senderWrapId: input.wrap.id })
	};
	const wire: WireCopyRecord = {
		wrapId: input.wrap.id,
		rumorId: rumor.id,
		audience,
		audiencePubkey: accountPubkey,
		eventJson: JSON.stringify(input.wrap),
		createdAt: input.wrap.created_at
	};
	const receipt: InboxReceiptRecord = {
		id: `${input.wrap.id}:${relayUrl}`,
		accountPubkey,
		wrapId: input.wrap.id,
		rumorId: rumor.id,
		relayUrl,
		receivedAt: input.receivedAt
	};
	const cursor: RelayCursorRecord = {
		relayUrl,
		maxEventCreatedAt: input.wrap.created_at,
		initialSyncComplete: false,
		updatedAt: input.receivedAt
	};

	assertOperationCurrent(isCurrent);
	await database.transaction(
		'rw',
		database.messages,
		database.wireCopies,
		database.inboxReceipts,
		database.relayCursors,
		async () => {
			assertOperationCurrent(isCurrent);
			const existing = await database.messages.get(rumor.id);
			assertOperationCurrent(isCurrent);
			if (
				existing &&
				(existing.conversationPubkey !== conversationPubkey ||
					existing.direction !== message.direction)
			) {
				throw new Error('conflicting logical rumor identity');
			}
			assertOperationCurrent(isCurrent);
			if (!existing) await database.messages.add(message);
			assertOperationCurrent(isCurrent);
			await database.wireCopies.put(wire);
			assertOperationCurrent(isCurrent);
			await database.inboxReceipts.put(receipt);
			assertOperationCurrent(isCurrent);
			const existingCursor = await database.relayCursors.get(relayUrl);
			assertOperationCurrent(isCurrent);
			await database.relayCursors.put({
				...cursor,
				maxEventCreatedAt: Math.max(
					existingCursor?.maxEventCreatedAt ?? 0,
					cursor.maxEventCreatedAt
				),
				initialSyncComplete: existingCursor?.initialSyncComplete ?? false,
				updatedAt: Math.max(existingCursor?.updatedAt ?? 0, cursor.updatedAt)
			});
			assertOperationCurrent(isCurrent);
		}
	);
	assertOperationCurrent(isCurrent);
	return rumor.id;
}
