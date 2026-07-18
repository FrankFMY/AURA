import Dexie, { type EntityTable } from 'dexie';
import {
	createMessageState,
	transitionMessageState,
	type MessageDeliveryState,
	type MessageStateTransition
} from '../core/message-state';
import type { WrappedDirectMessage } from '../nostr/gift-wrap';

const HEX_32 = /^[0-9a-f]{64}$/u;

export type StoredMessageState = MessageDeliveryState | 'received' | 'restored';

export interface StoredStateTransition extends Omit<MessageStateTransition, 'from' | 'to'> {
	from: StoredMessageState | null;
	to: StoredMessageState;
}

export interface MessageRecord {
	rumorId: string;
	accountPubkey: string;
	conversationPubkey: string;
	direction: 'outgoing' | 'incoming';
	state: StoredMessageState;
	stateHistory: readonly StoredStateTransition[];
	attempts: number;
	createdAt: number;
	updatedAt: number;
	recipientWrapId?: string;
	senderWrapId?: string;
}

export interface WireCopyRecord {
	wrapId: string;
	rumorId: string;
	audience: 'recipient' | 'sender';
	audiencePubkey: string;
	eventJson: string;
	createdAt: number;
}

export type OutboxStatus = 'queued' | 'publishing' | 'accepted' | 'rejected' | 'retry_wait';

export interface OutboxRecord {
	id: string;
	accountPubkey: string;
	wrapId: string;
	rumorId: string;
	audience: 'recipient' | 'sender';
	relayUrl: string;
	eventJson: string;
	status: OutboxStatus;
	attempt: number;
	nextAttemptAt: number;
	updatedAt: number;
	lastError?: string;
}

export interface InboxReceiptRecord {
	id: string;
	accountPubkey: string;
	wrapId: string;
	rumorId: string;
	relayUrl: string;
	receivedAt: number;
}

export interface RelayCursorRecord {
	relayUrl: string;
	maxEventCreatedAt: number;
	initialSyncComplete: boolean;
	updatedAt: number;
}

export class AccountDatabase extends Dexie {
	readonly accountPubkey: string;
	messages!: EntityTable<MessageRecord, 'rumorId'>;
	wireCopies!: EntityTable<WireCopyRecord, 'wrapId'>;
	outbox!: EntityTable<OutboxRecord, 'id'>;
	inboxReceipts!: EntityTable<InboxReceiptRecord, 'id'>;
	relayCursors!: EntityTable<RelayCursorRecord, 'relayUrl'>;

	constructor(accountPubkey: string, instanceSuffix = '') {
		if (!HEX_32.test(accountPubkey)) throw new Error('account pubkey is invalid');
		if (typeof instanceSuffix !== 'string' || /[^A-Za-z0-9_-]/u.test(instanceSuffix)) {
			throw new Error('database instance suffix is invalid');
		}
		super(`aura-r1:${accountPubkey}${instanceSuffix ? `:${instanceSuffix}` : ''}`);
		this.accountPubkey = accountPubkey;
		this.version(1).stores({
			messages: '&rumorId, conversationPubkey, createdAt, state',
			wireCopies: '&wrapId, rumorId, audience, createdAt',
			outbox: '&id, wrapId, rumorId, relayUrl, status, nextAttemptAt, [status+nextAttemptAt]',
			inboxReceipts: '&id, wrapId, rumorId, relayUrl, receivedAt',
			relayCursors: '&relayUrl, initialSyncComplete, maxEventCreatedAt'
		});
	}
}

export interface CommitOutgoingMessageInput {
	wrapped: WrappedDirectMessage;
	recipientRelays: readonly string[];
	senderRelays: readonly string[];
	committedAt: number;
}

function assertTimestamp(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error('commit timestamp is invalid');
}

function normalizeRelayUrls(relays: readonly string[]): string[] {
	if (!Array.isArray(relays) || relays.length < 1 || relays.length > 3) {
		throw new Error('outbox relay set must contain between 1 and 3 relays');
	}
	const normalized = new Set<string>();
	for (const relay of relays) {
		let url: URL;
		try {
			url = new URL(relay);
		} catch {
			throw new Error('outbox relay URL is invalid');
		}
		if (url.protocol !== 'wss:' || url.username || url.password || url.hash) {
			throw new Error('outbox relay URL is unsafe');
		}
		normalized.add(url.href);
	}
	if (normalized.size !== relays.length) throw new Error('outbox relay set contains duplicates');
	return [...normalized];
}

function wireRecord(
	wrapped: WrappedDirectMessage,
	audience: 'recipient' | 'sender'
): WireCopyRecord {
	const copy = wrapped[audience];
	return {
		wrapId: copy.wrap.id,
		rumorId: wrapped.rumor.id,
		audience,
		audiencePubkey: copy.audiencePubkey,
		eventJson: JSON.stringify(copy.wrap),
		createdAt: copy.wrap.created_at
	};
}

function outboxRecords(
	database: AccountDatabase,
	wire: WireCopyRecord,
	relays: readonly string[],
	committedAt: number
): OutboxRecord[] {
	return relays.map((relayUrl) => ({
		id: `${wire.wrapId}:${relayUrl}`,
		accountPubkey: database.accountPubkey,
		wrapId: wire.wrapId,
		rumorId: wire.rumorId,
		audience: wire.audience,
		relayUrl,
		eventJson: wire.eventJson,
		status: 'queued',
		attempt: 0,
		nextAttemptAt: committedAt,
		updatedAt: committedAt
	}));
}

export async function commitOutgoingMessage(
	database: AccountDatabase,
	input: CommitOutgoingMessageInput
): Promise<void> {
	assertTimestamp(input.committedAt);
	if (input.wrapped.rumor.pubkey !== database.accountPubkey) {
		throw new Error('outgoing rumor does not belong to this account database');
	}
	const recipientRelays = normalizeRelayUrls(input.recipientRelays);
	const senderRelays = normalizeRelayUrls(input.senderRelays);
	const recipient = wireRecord(input.wrapped, 'recipient');
	const sender = wireRecord(input.wrapped, 'sender');
	const conversationPubkey = input.wrapped.recipient.audiencePubkey;
	const initialState = transitionMessageState(
		createMessageState(input.wrapped.rumor.id, input.committedAt),
		'encrypted_and_signed',
		input.committedAt
	);
	const message: MessageRecord = {
		rumorId: input.wrapped.rumor.id,
		accountPubkey: database.accountPubkey,
		conversationPubkey,
		direction: 'outgoing',
		state: initialState.state,
		stateHistory: initialState.history,
		attempts: initialState.attempts,
		createdAt: input.wrapped.rumor.created_at,
		updatedAt: input.committedAt,
		recipientWrapId: recipient.wrapId,
		senderWrapId: sender.wrapId
	};
	const outbox = [
		...outboxRecords(database, recipient, recipientRelays, input.committedAt),
		...outboxRecords(database, sender, senderRelays, input.committedAt)
	];

	await database.transaction(
		'rw',
		database.messages,
		database.wireCopies,
		database.outbox,
		async () => {
			const existing = await database.messages.get(message.rumorId);
			if (
				existing &&
				(existing.recipientWrapId !== message.recipientWrapId ||
					existing.senderWrapId !== message.senderWrapId ||
					existing.conversationPubkey !== message.conversationPubkey)
			) {
				throw new Error('conflicting logical message reuse');
			}
			await database.messages.put(existing ?? message);
			await database.wireCopies.bulkPut([recipient, sender]);
			await database.outbox.bulkPut(outbox);
		}
	);
}

export async function getDueOutbox(
	database: AccountDatabase,
	now: number
): Promise<OutboxRecord[]> {
	assertTimestamp(now);
	return database.outbox
		.where('nextAttemptAt')
		.belowOrEqual(now)
		.and((record) => record.status === 'queued' || record.status === 'retry_wait')
		.sortBy('nextAttemptAt');
}
