import type { AccountDatabase, OutboxStatus } from '../storage/account-database';

export type DiagnosticConnectionState = 'connecting' | 'online' | 'offline';

export interface LocalDiagnosticsOptions {
	connection: DiagnosticConnectionState;
	recoveryConfirmed: boolean;
	now?: () => Date;
}

export interface LocalDiagnosticsReport {
	format: 'aura-local-diagnostics-v1';
	generatedAt: string;
	connection: DiagnosticConnectionState;
	recoveryConfirmed: boolean;
	storage: {
		schemaVersion: number;
		messages: number;
		wireCopies: number;
		inboxReceipts: number;
		relayCursors: number;
		outbox: {
			total: number;
			queued: number;
			publishing: number;
			accepted: number;
			rejected: number;
			retryWait: number;
			unknown: number;
		};
	};
}

const OUTBOX_STATUSES: readonly OutboxStatus[] = [
	'queued',
	'publishing',
	'accepted',
	'rejected',
	'retry_wait'
];

export async function collectLocalDiagnostics(
	database: AccountDatabase,
	options: LocalDiagnosticsOptions
): Promise<LocalDiagnosticsReport> {
	const [messages, wireCopies, inboxReceipts, relayCursors, outboxTotal, ...statusCounts] =
		await database.transaction(
			'r',
			[
				database.messages,
				database.wireCopies,
				database.inboxReceipts,
				database.relayCursors,
				database.outbox
			],
			() =>
				Promise.all([
					database.messages.count(),
					database.wireCopies.count(),
					database.inboxReceipts.count(),
					database.relayCursors.count(),
					database.outbox.count(),
					...OUTBOX_STATUSES.map((status) => database.outbox.where('status').equals(status).count())
				])
		);
	const [queued, publishing, accepted, rejected, retryWait] = statusCounts;
	const recognizedOutboxRows = queued + publishing + accepted + rejected + retryWait;

	return {
		format: 'aura-local-diagnostics-v1',
		generatedAt: (options.now ?? (() => new Date()))().toISOString(),
		connection: options.connection,
		recoveryConfirmed: options.recoveryConfirmed,
		storage: {
			schemaVersion: database.verno,
			messages,
			wireCopies,
			inboxReceipts,
			relayCursors,
			outbox: {
				total: outboxTotal,
				queued,
				publishing,
				accepted,
				rejected,
				retryWait,
				unknown: Math.max(0, outboxTotal - recognizedOutboxRows)
			}
		}
	};
}
