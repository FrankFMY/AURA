import { verifyEvent, type Event } from 'nostr-tools';
import {
	classifyPublishAttempt,
	transitionMessageState,
	type MessageDeliveryState,
	type MessageStateRecord,
	type MessageStateTransition
} from '../core/message-state';
import {
	getDueOutbox,
	type AccountDatabase,
	type MessageRecord,
	type OutboxRecord
} from './account-database';

export interface RelayPublishResponse {
	accepted: boolean;
	retryable?: boolean;
	message: string;
}

export type RelayPublisher = (relayUrl: string, event: Event) => Promise<RelayPublishResponse>;

export const OUTBOX_PUBLISH_LEASE_MS = 30_000;

const DELIVERY_STATES = new Set<MessageDeliveryState>([
	'locally_created',
	'encrypted_and_signed',
	'queued',
	'publishing',
	'network_accepted',
	'recipient_confirmed',
	'retry_wait',
	'network_rejected',
	'permanent_failure'
]);

function isDeliveryState(value: string | null): value is MessageDeliveryState {
	return value !== null && DELIVERY_STATES.has(value as MessageDeliveryState);
}

function persistedState(message: MessageRecord): MessageStateRecord {
	const state = message.state;
	if (message.direction !== 'outgoing') {
		throw new Error('outbox message has a non-delivery state');
	}
	if (!isDeliveryState(state)) {
		throw new Error('outbox message has a non-delivery state');
	}
	if (
		message.stateHistory.some(
			(entry) => !isDeliveryState(entry.to) || (entry.from !== null && !isDeliveryState(entry.from))
		)
	) {
		throw new Error('outbox message has a non-delivery state');
	}
	return {
		messageId: message.rumorId,
		state,
		updatedAt: message.updatedAt,
		attempts: message.attempts,
		history: message.stateHistory as readonly MessageStateTransition[]
	};
}

function applyTransition(
	message: MessageRecord,
	next: MessageDeliveryState,
	at: number,
	reason?: string
): MessageRecord {
	const state = transitionMessageState(persistedState(message), next, at, reason);
	return {
		...message,
		state: state.state,
		stateHistory: state.history,
		attempts: state.attempts,
		updatedAt: state.updatedAt
	};
}

function verifyWireEvent(event: Event): boolean {
	const uncached: Event = {
		id: event.id,
		pubkey: event.pubkey,
		created_at: event.created_at,
		kind: event.kind,
		tags: event.tags.map((tag) => [...tag]),
		content: event.content,
		sig: event.sig
	};
	return verifyEvent(uncached);
}

function parsePersistedEvent(row: OutboxRecord): Event {
	let value: unknown;
	try {
		value = JSON.parse(row.eventJson);
	} catch {
		throw new Error('corrupted persisted event JSON');
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('corrupted persisted event object');
	}
	const event = value as Event;
	if (
		event.id !== row.wrapId ||
		event.kind !== 1059 ||
		!Array.isArray(event.tags) ||
		typeof event.content !== 'string' ||
		typeof event.sig !== 'string' ||
		!verifyWireEvent(event)
	) {
		throw new Error('invalid or corrupted persisted event');
	}
	return event;
}

function retryDelay(attempt: number): number {
	return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1));
}

export async function claimDueOutboxRows(
	database: AccountDatabase,
	rumorId: string,
	rows: OutboxRecord[],
	now: number
): Promise<OutboxRecord[]> {
	return database.transaction('rw', database.messages, database.outbox, async () => {
		const currentRows = (await database.outbox.bulkGet(rows.map((row) => row.id))).filter(
			(row): row is OutboxRecord =>
				row !== undefined &&
				row.accountPubkey === database.accountPubkey &&
				row.rumorId === rumorId &&
				(row.status === 'queued' || row.status === 'retry_wait') &&
				row.nextAttemptAt <= now
		);
		if (currentRows.length === 0) return [];
		let message = await database.messages.get(rumorId);
		if (!message) throw new Error(`outbox message ${rumorId} is missing`);
		if (message.state === 'encrypted_and_signed') {
			message = applyTransition(message, 'queued', now, 'durable outbox ready');
			message = applyTransition(message, 'publishing', now, 'relay publication started');
		} else if (message.state === 'queued' || message.state === 'retry_wait') {
			message = applyTransition(message, 'publishing', now, 'relay publication started');
		} else if (message.state === 'network_rejected' || message.state === 'permanent_failure') {
			throw new Error(`outbox cannot run while message is ${message.state}`);
		}
		await database.messages.put(message);
		const prepared = currentRows.map((row) => ({
			...row,
			status: 'publishing' as const,
			attempt: row.attempt + 1,
			updatedAt: now,
			lastError: undefined
		}));
		await database.outbox.bulkPut(prepared);
		return prepared;
	});
}

async function publishRow(
	row: OutboxRecord,
	publisher: RelayPublisher,
	now: number
): Promise<OutboxRecord> {
	let event: Event;
	try {
		event = parsePersistedEvent(row);
	} catch (error) {
		return {
			...row,
			status: 'rejected',
			updatedAt: now,
			lastError: error instanceof Error ? error.message : 'invalid persisted event'
		};
	}
	try {
		const response = await publisher(row.relayUrl, event);
		if (response.accepted) {
			return { ...row, status: 'accepted', updatedAt: now, lastError: undefined };
		}
		if (response.retryable) {
			return {
				...row,
				status: 'retry_wait',
				nextAttemptAt: now + retryDelay(row.attempt),
				updatedAt: now,
				lastError: response.message
			};
		}
		return { ...row, status: 'rejected', updatedAt: now, lastError: response.message };
	} catch (error) {
		return {
			...row,
			status: 'retry_wait',
			nextAttemptAt: now + retryDelay(row.attempt),
			updatedAt: now,
			lastError: error instanceof Error ? error.message : 'relay publication failed'
		};
	}
}

async function updateLogicalState(
	database: AccountDatabase,
	rumorId: string,
	now: number
): Promise<void> {
	await database.transaction('rw', database.messages, database.outbox, async () => {
		const message = await database.messages.get(rumorId);
		if (!message || message.state !== 'publishing') return;
		const recipientRows = await database.outbox
			.where('rumorId')
			.equals(rumorId)
			.and((row) => row.audience === 'recipient')
			.toArray();
		const accepted = recipientRows.filter((row) => row.status === 'accepted').length;
		const rejected = recipientRows.filter((row) => row.status === 'rejected').length;
		const pending = recipientRows.length - accepted - rejected;
		const next = classifyPublishAttempt({ accepted, rejected, pending });
		await database.messages.put(
			applyTransition(
				message,
				next,
				now,
				next === 'network_accepted'
					? 'at least one intended recipient relay acknowledged'
					: next === 'network_rejected'
						? 'all intended recipient relays rejected'
						: 'no conclusive recipient relay acknowledgement'
			)
		);
	});
}

async function recoverInterruptedPublications(
	database: AccountDatabase,
	now: number
): Promise<number> {
	const cutoff = now - OUTBOX_PUBLISH_LEASE_MS;
	if (cutoff < 0) return 0;
	return database.transaction('rw', database.outbox, async () => {
		const stale = await database.outbox
			.where('status')
			.equals('publishing')
			.and((row) => row.updatedAt <= cutoff)
			.toArray();
		if (stale.length === 0) return 0;
		await database.outbox.bulkPut(
			stale.map((row) => ({
				...row,
				status: 'retry_wait' as const,
				nextAttemptAt: now,
				updatedAt: now,
				lastError: 'publication interrupted before relay outcome'
			}))
		);
		return stale.length;
	});
}

export async function runOutboxBatch(
	database: AccountDatabase,
	publisher: RelayPublisher,
	now: number
): Promise<number> {
	if (!Number.isSafeInteger(now) || now < 0) throw new Error('outbox time is invalid');
	await recoverInterruptedPublications(database, now);
	const due = await getDueOutbox(database, now);
	const groups = new Map<string, OutboxRecord[]>();
	for (const row of due) {
		const group = groups.get(row.rumorId) ?? [];
		group.push(row);
		groups.set(row.rumorId, group);
	}

	let processed = 0;
	for (const [rumorId, rows] of groups) {
		const prepared = await claimDueOutboxRows(database, rumorId, rows, now);
		if (prepared.length === 0) continue;
		const outcomes = await Promise.all(prepared.map((row) => publishRow(row, publisher, now)));
		await database.outbox.bulkPut(outcomes);
		await updateLogicalState(database, rumorId, now);
		processed += outcomes.length;
	}
	return processed;
}
