import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountDatabase, type OutboxRecord } from '../storage/account-database';
import { collectLocalDiagnostics } from './diagnostics';

const databases: AccountDatabase[] = [];

function database(): AccountDatabase {
	const value = new AccountDatabase('a'.repeat(64), `diagnostics-${databases.length}`);
	databases.push(value);
	return value;
}

afterEach(async () => {
	for (const value of databases.splice(0)) {
		value.close();
		await value.delete();
	}
});

describe('local diagnostics', () => {
	it('reports only aggregate runtime and storage state', async () => {
		const db = database();
		await db.messages.add({
			rumorId: 'b'.repeat(64),
			accountPubkey: 'a'.repeat(64),
			conversationPubkey: 'c'.repeat(64),
			direction: 'incoming',
			state: 'received',
			stateHistory: [{ from: null, to: 'received', at: 1 }],
			attempts: 0,
			createdAt: 1,
			updatedAt: 2
		});
		await db.wireCopies.add({
			wrapId: 'd'.repeat(64),
			rumorId: 'b'.repeat(64),
			audience: 'recipient',
			audiencePubkey: 'a'.repeat(64),
			eventJson: '{"content":"sensitive encrypted wire payload"}',
			createdAt: 1
		});
		const persistedStatuses = [
			'queued',
			'publishing',
			'accepted',
			'rejected',
			'retry_wait',
			'future_status'
		] as const;
		await db.outbox.bulkAdd(
			persistedStatuses.map(
				(status, index) =>
					({
						id: `row-${index}`,
						accountPubkey: 'a'.repeat(64),
						wrapId: `${index}`.repeat(64),
						rumorId: 'b'.repeat(64),
						audience: 'recipient',
						relayUrl: 'wss://private.example/',
						eventJson: '{"content":"another sensitive payload"}',
						status,
						attempt: 2,
						nextAttemptAt: 3,
						updatedAt: 2,
						lastError: 'private relay diagnostic reason'
					}) as OutboxRecord
			)
		);

		const report = await collectLocalDiagnostics(db, {
			connection: 'offline',
			recoveryConfirmed: true,
			now: () => new Date('2026-07-19T10:00:00.000Z')
		});
		const serialized = JSON.stringify(report);

		expect(report).toEqual({
			format: 'aura-local-diagnostics-v1',
			generatedAt: '2026-07-19T10:00:00.000Z',
			connection: 'offline',
			recoveryConfirmed: true,
			storage: {
				schemaVersion: 1,
				messages: 1,
				wireCopies: 1,
				inboxReceipts: 0,
				relayCursors: 0,
				outbox: {
					total: 6,
					queued: 1,
					publishing: 1,
					accepted: 1,
					rejected: 1,
					retryWait: 1,
					unknown: 1
				}
			}
		});
		expect(serialized).not.toContain('a'.repeat(64));
		expect(serialized).not.toContain('c'.repeat(64));
		expect(serialized).not.toContain('private.example');
		expect(serialized).not.toContain('sensitive');
		expect(serialized).not.toContain('diagnostic reason');
	});
});
