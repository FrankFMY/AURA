import { describe, expect, it } from 'vitest';
import {
	classifyPublishAttempt,
	createMessageState,
	transitionMessageState,
	type MessageDeliveryState
} from './message-state';

const T0 = 1_750_000_000_000;

function advance(
	state: ReturnType<typeof createMessageState>,
	to: MessageDeliveryState,
	offset: number,
	reason?: string
) {
	return transitionMessageState(state, to, T0 + offset, reason);
}

describe('message state machine', () => {
	it('supports the success lifecycle without skipping evidence states', () => {
		let state = createMessageState('msg-1', T0);
		state = advance(state, 'encrypted_and_signed', 1);
		state = advance(state, 'queued', 2);
		state = advance(state, 'publishing', 3);
		state = advance(state, 'network_accepted', 4, 'relay acknowledged');
		state = advance(state, 'recipient_confirmed', 5, 'authenticated recipient receipt');
		expect(state.history.map((entry) => entry.to)).toEqual([
			'locally_created',
			'encrypted_and_signed',
			'queued',
			'publishing',
			'network_accepted',
			'recipient_confirmed'
		]);
	});

	it('rejects skipped, backward and terminal transitions', () => {
		const created = createMessageState('msg-2', T0);
		expect(() => advance(created, 'queued', 1)).toThrow(/invalid transition/i);
		const encrypted = advance(created, 'encrypted_and_signed', 1);
		expect(() => advance(encrypted, 'locally_created', 2)).toThrow(/invalid transition/i);
		let confirmed = advance(encrypted, 'queued', 2);
		confirmed = advance(confirmed, 'publishing', 3);
		confirmed = advance(confirmed, 'network_accepted', 4);
		confirmed = advance(confirmed, 'recipient_confirmed', 5);
		expect(() => advance(confirmed, 'publishing', 6)).toThrow(/terminal state/i);
	});

	it('requires monotonic timestamps', () => {
		const created = createMessageState('msg-3', T0);
		expect(() => transitionMessageState(created, 'encrypted_and_signed', T0 - 1)).toThrow(
			/timestamp/i
		);
	});

	it('supports exact-event retry after timeout and rejection', () => {
		let timedOut = createMessageState('msg-timeout', T0);
		timedOut = advance(timedOut, 'encrypted_and_signed', 1);
		timedOut = advance(timedOut, 'queued', 2);
		timedOut = advance(timedOut, 'publishing', 3);
		timedOut = advance(timedOut, 'retry_wait', 4, 'ACK deadline');
		timedOut = advance(timedOut, 'publishing', 5, 'retry exact event');
		expect(timedOut.attempts).toBe(2);

		let rejected = createMessageState('msg-rejected', T0);
		rejected = advance(rejected, 'encrypted_and_signed', 1);
		rejected = advance(rejected, 'queued', 2);
		rejected = advance(rejected, 'publishing', 3);
		rejected = advance(rejected, 'network_rejected', 4);
		rejected = advance(rejected, 'queued', 5, 'explicit retry');
		expect(rejected.state).toBe('queued');
	});

	it('accepts conclusive late relay evidence while waiting to retry', () => {
		let waiting = createMessageState('msg-late-evidence', T0);
		waiting = advance(waiting, 'encrypted_and_signed', 1);
		waiting = advance(waiting, 'queued', 2);
		waiting = advance(waiting, 'publishing', 3);
		waiting = advance(waiting, 'retry_wait', 4, 'another relay is pending');

		expect(advance(waiting, 'network_accepted', 5, 'late ACK').state).toBe('network_accepted');
		expect(advance(waiting, 'network_rejected', 5, 'late conclusive rejection').state).toBe(
			'network_rejected'
		);
	});

	it('classifies relay evidence without calling it delivery', () => {
		expect(classifyPublishAttempt({ accepted: 1, rejected: 0, pending: 2 })).toBe(
			'network_accepted'
		);
		expect(classifyPublishAttempt({ accepted: 0, rejected: 3, pending: 0 })).toBe(
			'network_rejected'
		);
		expect(classifyPublishAttempt({ accepted: 0, rejected: 1, pending: 2 })).toBe('retry_wait');
		expect(classifyPublishAttempt({ accepted: 0, rejected: 0, pending: 0 })).toBe('retry_wait');
	});

	it('rejects impossible ACK counters', () => {
		expect(() => classifyPublishAttempt({ accepted: -1, rejected: 0, pending: 0 })).toThrow(
			/non-negative integers/i
		);
		expect(() => classifyPublishAttempt({ accepted: 0.5, rejected: 0, pending: 0 })).toThrow(
			/non-negative integers/i
		);
	});
});
