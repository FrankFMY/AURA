import { verifyEvent, type Event } from 'nostr-tools';
import {
	assertOperationCurrent,
	isOperationCancelled,
	operationAlwaysCurrent,
	type OperationGuard
} from '../core/operation-guard';
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
	now: number,
	isCurrent: OperationGuard = operationAlwaysCurrent
): Promise<OutboxRecord[]> {
	assertOperationCurrent(isCurrent);
	return database.transaction('rw', database.messages, database.outbox, async () => {
		assertOperationCurrent(isCurrent);
		const currentRows = (await database.outbox.bulkGet(rows.map((row) => row.id))).filter(
			(row): row is OutboxRecord =>
				row !== undefined &&
				row.accountPubkey === database.accountPubkey &&
				row.rumorId === rumorId &&
				(row.status === 'queued' || row.status === 'retry_wait') &&
				row.nextAttemptAt <= now
		);
		assertOperationCurrent(isCurrent);
		if (currentRows.length === 0) return [];
		let message = await database.messages.get(rumorId);
		assertOperationCurrent(isCurrent);
		if (!message) throw new Error(`outbox message ${rumorId} is missing`);
		if (message.state === 'encrypted_and_signed') {
			message = applyTransition(message, 'queued', now, 'durable outbox ready');
			message = applyTransition(message, 'publishing', now, 'relay publication started');
		} else if (message.state === 'queued' || message.state === 'retry_wait') {
			message = applyTransition(message, 'publishing', now, 'relay publication started');
		} else if (message.state === 'network_rejected' || message.state === 'permanent_failure') {
			throw new Error(`outbox cannot run while message is ${message.state}`);
		}
		assertOperationCurrent(isCurrent);
		await database.messages.put(message);
		const prepared = currentRows.map((row) => ({
			...row,
			status: 'publishing' as const,
			attempt: row.attempt + 1,
			updatedAt: now,
			lastError: undefined
		}));
		assertOperationCurrent(isCurrent);
		await database.outbox.bulkPut(prepared);
		assertOperationCurrent(isCurrent);
		return prepared;
	});
}

async function publishRow(
	row: OutboxRecord,
	publisher: RelayPublisher,
	now: number,
	isCurrent: OperationGuard
): Promise<OutboxRecord> {
	assertOperationCurrent(isCurrent);
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
		assertOperationCurrent(isCurrent);
		const response = await publisher(row.relayUrl, event);
		assertOperationCurrent(isCurrent);
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
		if (isOperationCancelled(error)) throw error;
		return {
			...row,
			status: 'retry_wait',
			nextAttemptAt: now + retryDelay(row.attempt),
			updatedAt: now,
			lastError: error instanceof Error ? error.message : 'relay publication failed'
		};
	}
}

async function commitOwnedOutcomes(
	database: AccountDatabase,
	rumorId: string,
	outcomes: OutboxRecord[],
	now: number,
	isCurrent: OperationGuard
): Promise<number> {
	assertOperationCurrent(isCurrent);
	return database.transaction('rw', database.messages, database.outbox, async () => {
		assertOperationCurrent(isCurrent);
		const currentRows = await database.outbox.bulkGet(outcomes.map((row) => row.id));
		assertOperationCurrent(isCurrent);
		const owned = outcomes.filter((outcome, index) => {
			const current = currentRows[index];
			return (
				current !== undefined &&
				current.accountPubkey === database.accountPubkey &&
				current.rumorId === rumorId &&
				outcome.rumorId === rumorId &&
				current.wrapId === outcome.wrapId &&
				current.relayUrl === outcome.relayUrl &&
				current.audience === outcome.audience &&
				current.status === 'publishing' &&
				current.attempt === outcome.attempt
			);
		});
		if (owned.length === 0) return 0;
		assertOperationCurrent(isCurrent);
		await database.outbox.bulkPut(owned);
		assertOperationCurrent(isCurrent);
		const message = await database.messages.get(rumorId);
		assertOperationCurrent(isCurrent);
		if (!message) throw new Error(`outbox message ${rumorId} is missing`);
		if (message.state !== 'publishing' && message.state !== 'retry_wait') return owned.length;
		const recipientRows = await database.outbox
			.where('rumorId')
			.equals(rumorId)
			.and((row) => row.audience === 'recipient')
			.toArray();
		assertOperationCurrent(isCurrent);
		const accepted = recipientRows.filter((row) => row.status === 'accepted').length;
		const rejected = recipientRows.filter((row) => row.status === 'rejected').length;
		const pending = recipientRows.length - accepted - rejected;
		const next = classifyPublishAttempt({ accepted, rejected, pending });
		if (message.state === next) return owned.length;
		assertOperationCurrent(isCurrent);
		await database.messages.put(
			applyTransition(
				message,
				next,
				Math.max(now, message.updatedAt),
				next === 'network_accepted'
					? 'at least one intended recipient relay acknowledged'
					: next === 'network_rejected'
						? 'all intended recipient relays rejected'
						: 'no conclusive recipient relay acknowledgement'
			)
		);
		assertOperationCurrent(isCurrent);
		return owned.length;
	});
}

async function reconcileConclusiveOutboxStates(
	database: AccountDatabase,
	now: number,
	isCurrent: OperationGuard
): Promise<number> {
	assertOperationCurrent(isCurrent);
	return database.transaction('rw', database.messages, database.outbox, async () => {
		assertOperationCurrent(isCurrent);
		const candidates = await database.messages
			.where('state')
			.anyOf(['publishing', 'retry_wait'])
			.and((message) => message.direction === 'outgoing')
			.toArray();
		assertOperationCurrent(isCurrent);
		let repaired = 0;
		for (const message of candidates) {
			const recipientRows = await database.outbox
				.where('rumorId')
				.equals(message.rumorId)
				.and((row) => row.accountPubkey === database.accountPubkey && row.audience === 'recipient')
				.toArray();
			assertOperationCurrent(isCurrent);
			if (recipientRows.length === 0) continue;
			const accepted = recipientRows.filter((row) => row.status === 'accepted').length;
			const rejected = recipientRows.filter((row) => row.status === 'rejected').length;
			const pending = recipientRows.length - accepted - rejected;
			if (accepted === 0 && !(rejected > 0 && pending === 0)) continue;
			const next = classifyPublishAttempt({ accepted, rejected, pending });
			if (message.state === next) continue;
			assertOperationCurrent(isCurrent);
			await database.messages.put(
				applyTransition(
					message,
					next,
					Math.max(now, message.updatedAt),
					next === 'network_accepted'
						? 'reconciled persisted recipient relay acknowledgement'
						: 'reconciled persisted recipient relay rejections'
				)
			);
			assertOperationCurrent(isCurrent);
			repaired += 1;
		}
		return repaired;
	});
}

async function recoverInterruptedPublications(
	database: AccountDatabase,
	now: number,
	isCurrent: OperationGuard
): Promise<number> {
	assertOperationCurrent(isCurrent);
	const cutoff = now - OUTBOX_PUBLISH_LEASE_MS;
	if (cutoff < 0) return 0;
	return database.transaction('rw', database.outbox, async () => {
		assertOperationCurrent(isCurrent);
		const stale = await database.outbox
			.where('status')
			.equals('publishing')
			.and((row) => row.updatedAt <= cutoff)
			.toArray();
		assertOperationCurrent(isCurrent);
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
		assertOperationCurrent(isCurrent);
		return stale.length;
	});
}

export async function runOutboxBatch(
	database: AccountDatabase,
	publisher: RelayPublisher,
	now: number,
	isCurrent: OperationGuard = operationAlwaysCurrent
): Promise<number> {
	if (!Number.isSafeInteger(now) || now < 0) throw new Error('outbox time is invalid');
	assertOperationCurrent(isCurrent);
	await recoverInterruptedPublications(database, now, isCurrent);
	assertOperationCurrent(isCurrent);
	await reconcileConclusiveOutboxStates(database, now, isCurrent);
	assertOperationCurrent(isCurrent);
	const due = await getDueOutbox(database, now);
	assertOperationCurrent(isCurrent);
	const groups = new Map<string, OutboxRecord[]>();
	for (const row of due) {
		const group = groups.get(row.rumorId) ?? [];
		group.push(row);
		groups.set(row.rumorId, group);
	}

	let processed = 0;
	for (const [rumorId, rows] of groups) {
		assertOperationCurrent(isCurrent);
		const prepared = await claimDueOutboxRows(database, rumorId, rows, now, isCurrent);
		assertOperationCurrent(isCurrent);
		if (prepared.length === 0) continue;
		const outcomes = await Promise.all(
			prepared.map((row) => publishRow(row, publisher, now, isCurrent))
		);
		assertOperationCurrent(isCurrent);
		const committed = await commitOwnedOutcomes(database, rumorId, outcomes, now, isCurrent);
		assertOperationCurrent(isCurrent);
		processed += committed;
	}
	assertOperationCurrent(isCurrent);
	return processed;
}
