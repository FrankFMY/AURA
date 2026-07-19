export const MESSAGE_DELIVERY_STATES = [
	'locally_created',
	'encrypted_and_signed',
	'queued',
	'publishing',
	'network_accepted',
	'recipient_confirmed',
	'retry_wait',
	'network_rejected',
	'permanent_failure'
] as const;

export type MessageDeliveryState = (typeof MESSAGE_DELIVERY_STATES)[number];

export interface MessageStateTransition {
	from: MessageDeliveryState | null;
	to: MessageDeliveryState;
	at: number;
	reason?: string;
}

export interface MessageStateRecord {
	messageId: string;
	state: MessageDeliveryState;
	updatedAt: number;
	attempts: number;
	history: readonly MessageStateTransition[];
}

export interface PublishAttemptEvidence {
	accepted: number;
	rejected: number;
	pending: number;
}

const TERMINAL_STATES = new Set<MessageDeliveryState>(['recipient_confirmed', 'permanent_failure']);

const ALLOWED_TRANSITIONS: Readonly<Record<MessageDeliveryState, readonly MessageDeliveryState[]>> =
	{
		locally_created: ['encrypted_and_signed'],
		encrypted_and_signed: ['queued'],
		queued: ['publishing'],
		publishing: ['network_accepted', 'retry_wait', 'network_rejected'],
		network_accepted: ['recipient_confirmed'],
		recipient_confirmed: [],
		retry_wait: ['publishing', 'network_accepted', 'network_rejected', 'permanent_failure'],
		network_rejected: ['queued', 'permanent_failure'],
		permanent_failure: []
	};

function assertTimestamp(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value < 0) {
		throw new Error(`${label} timestamp must be a non-negative safe integer`);
	}
}

function freezeRecord(record: MessageStateRecord): MessageStateRecord {
	for (const entry of record.history) Object.freeze(entry);
	Object.freeze(record.history);
	return Object.freeze(record);
}

export function createMessageState(messageId: string, createdAt: number): MessageStateRecord {
	if (typeof messageId !== 'string' || messageId.trim().length === 0) {
		throw new Error('messageId must be a non-empty string');
	}
	assertTimestamp(createdAt, 'createdAt');

	return freezeRecord({
		messageId,
		state: 'locally_created',
		updatedAt: createdAt,
		attempts: 0,
		history: [{ from: null, to: 'locally_created', at: createdAt }]
	});
}

export function transitionMessageState(
	current: MessageStateRecord,
	next: MessageDeliveryState,
	at: number,
	reason?: string
): MessageStateRecord {
	assertTimestamp(at, 'transition');
	if (at < current.updatedAt) {
		throw new Error('transition timestamp cannot be earlier than the current state timestamp');
	}
	if (TERMINAL_STATES.has(current.state)) {
		throw new Error(`cannot leave terminal state ${current.state}`);
	}
	if (!ALLOWED_TRANSITIONS[current.state].includes(next)) {
		throw new Error(`invalid transition from ${current.state} to ${next}`);
	}
	if (reason !== undefined && (typeof reason !== 'string' || reason.trim().length === 0)) {
		throw new Error('transition reason must be a non-empty string when provided');
	}

	const entry: MessageStateTransition = {
		from: current.state,
		to: next,
		at,
		...(reason === undefined ? {} : { reason: reason.trim() })
	};

	return freezeRecord({
		messageId: current.messageId,
		state: next,
		updatedAt: at,
		attempts: current.attempts + (next === 'publishing' ? 1 : 0),
		history: [...current.history, entry]
	});
}

export function classifyPublishAttempt(
	evidence: PublishAttemptEvidence
): 'network_accepted' | 'network_rejected' | 'retry_wait' {
	const values = [evidence.accepted, evidence.rejected, evidence.pending];
	if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
		throw new Error('relay ACK counters must be non-negative integers');
	}

	if (evidence.accepted > 0) return 'network_accepted';
	if (evidence.rejected > 0 && evidence.pending === 0) return 'network_rejected';
	return 'retry_wait';
}
