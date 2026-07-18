import type { Event } from 'nostr-tools';
import type { UnlockedSession } from '../custody/session';
import {
	commitOutgoingMessage,
	type AccountDatabase,
	type MessageRecord
} from '../storage/account-database';
import {
	commitIncomingWrap,
	getRelaySubscriptionSince,
	markRelayInitialSyncComplete
} from '../storage/inbox';
import { runOutboxBatch } from '../storage/outbox-worker';
import { createWrappedDirectMessage, unwrapDirectMessage } from './gift-wrap';
import {
	createPoolPublisher,
	discoverRecipientRelays,
	subscribeGiftWraps,
	type RelayPool,
	type SubscriptionCloser
} from './relay-client';
import { createDmRelayList, normalizeDmRelayUrls } from './dm-relays';

export interface RuntimeClock {
	seconds: number;
	milliseconds: number;
}

export const OUTBOX_RECONCILIATION_INTERVAL_MS = 2_500;

export interface MessengerRuntimeOptions {
	session: UnlockedSession;
	database: AccountDatabase;
	pool: RelayPool;
	lookupRelays: readonly string[];
	accountDmRelays: readonly string[];
	recoveryConfirmed: boolean;
	now?: () => RuntimeClock;
	reconciliationIntervalMs?: number;
	maxPendingIncoming?: number;
	onReceiveError?: (error: Error) => void;
	onTransportError?: (error: Error) => void;
}

export interface HydratedMessage {
	rumorId: string;
	conversationPubkey: string;
	direction: 'incoming' | 'outgoing';
	content: string;
	createdAt: number;
	state: MessageRecord['state'];
}

function systemClock(): RuntimeClock {
	const milliseconds = Date.now();
	return { seconds: Math.floor(milliseconds / 1000), milliseconds };
}

export class MessengerRuntime {
	readonly #session: UnlockedSession;
	readonly #database: AccountDatabase;
	readonly #pool: RelayPool;
	readonly #lookupRelays: string[];
	readonly #accountDmRelays: string[];
	readonly #recoveryConfirmed: boolean;
	readonly #now: () => RuntimeClock;
	readonly #reconciliationIntervalMs: number;
	readonly #maxPendingIncoming: number;
	readonly #onReceiveError?: (error: Error) => void;
	readonly #onTransportError?: (error: Error) => void;
	#subscriptions: SubscriptionCloser[] = [];
	#reconciliationTimer: ReturnType<typeof setInterval> | undefined;
	#receiveQueue: Promise<void> = Promise.resolve();
	#pendingIncoming = 0;
	#restartingRelays = new Map<string, number>();
	#generation = 0;
	#started = false;

	constructor(options: MessengerRuntimeOptions) {
		if (options.session.pubkey !== options.database.accountPubkey) {
			throw new Error('session and account database do not match');
		}
		this.#session = options.session;
		this.#database = options.database;
		this.#pool = options.pool;
		this.#lookupRelays = normalizeDmRelayUrls(options.lookupRelays);
		this.#accountDmRelays = normalizeDmRelayUrls(options.accountDmRelays);
		this.#recoveryConfirmed = options.recoveryConfirmed;
		this.#now = options.now ?? systemClock;
		this.#reconciliationIntervalMs =
			options.reconciliationIntervalMs ?? OUTBOX_RECONCILIATION_INTERVAL_MS;
		if (
			!Number.isSafeInteger(this.#reconciliationIntervalMs) ||
			this.#reconciliationIntervalMs < 1
		) {
			throw new Error('outbox reconciliation interval is invalid');
		}
		this.#maxPendingIncoming = options.maxPendingIncoming ?? 64;
		if (!Number.isSafeInteger(this.#maxPendingIncoming) || this.#maxPendingIncoming < 1) {
			throw new Error('incoming receive queue capacity is invalid');
		}
		this.#onReceiveError = options.onReceiveError;
		this.#onTransportError = options.onTransportError;
	}

	async start(): Promise<SubscriptionCloser> {
		if (this.#started) throw new Error('messenger runtime is already started');
		this.#generation += 1;
		this.#started = true;
		const opened: SubscriptionCloser[] = [];
		try {
			for (const relayUrl of this.#accountDmRelays) {
				opened.push(await this.#openRelay(relayUrl));
			}
			this.#subscriptions = opened;
			this.#runReconciliation();
			this.#reconciliationTimer = setInterval(
				() => this.#runReconciliation(),
				this.#reconciliationIntervalMs
			);
			return { close: (reason?: string) => this.stop(reason) };
		} catch (error) {
			for (const subscription of opened) {
				subscription.close('messenger runtime startup failed');
			}
			this.#subscriptions = [];
			this.#started = false;
			throw error;
		}
	}

	async #openRelay(relayUrl: string): Promise<SubscriptionCloser> {
		const since = await getRelaySubscriptionSince(this.#database, relayUrl);
		let subscription: SubscriptionCloser | undefined;
		subscription = subscribeGiftWraps(
			this.#pool,
			[relayUrl],
			this.#session.pubkey,
			since,
			(event) => {
				this.#enqueueReceive(event, relayUrl, () => {
					if (subscription) this.#requestRelayReplay(relayUrl, subscription);
				});
			},
			(reasons) => {
				if (reasons.length > 0 && !this.#restartingRelays.has(relayUrl)) {
					this.#onTransportError?.(new Error(`relay subscription closed: ${reasons.join('; ')}`));
				}
			},
			() => {
				void markRelayInitialSyncComplete(this.#database, relayUrl, this.#now().milliseconds).catch(
					(error) => {
						this.#onReceiveError?.(error instanceof Error ? error : new Error(String(error)));
					}
				);
			}
		);
		return subscription;
	}

	stop(reason = 'messenger runtime stopped'): void {
		this.#generation += 1;
		for (const subscription of this.#subscriptions) subscription.close(reason);
		this.#subscriptions = [];
		if (this.#reconciliationTimer) clearInterval(this.#reconciliationTimer);
		this.#reconciliationTimer = undefined;
		this.#started = false;
	}

	#runReconciliation(): void {
		void this.reconcileOutbox().catch((error) => {
			this.#onTransportError?.(error instanceof Error ? error : new Error(String(error)));
		});
	}

	async reconcileOutbox() {
		return runOutboxBatch(
			this.#database,
			createPoolPublisher(this.#pool),
			this.#now().milliseconds
		);
	}

	#enqueueReceive(event: Event, relayUrl: string, onSaturated: () => void): void {
		if (this.#pendingIncoming >= this.#maxPendingIncoming) {
			onSaturated();
			return;
		}
		this.#pendingIncoming += 1;
		this.#receiveQueue = this.#receiveQueue
			.then(() => this.#receive(event, relayUrl))
			.finally(() => {
				this.#pendingIncoming -= 1;
			});
	}

	#clearRelayRestart(relayUrl: string, generation: number): void {
		if (this.#restartingRelays.get(relayUrl) === generation) {
			this.#restartingRelays.delete(relayUrl);
		}
	}

	#requestRelayReplay(relayUrl: string, subscription: SubscriptionCloser): void {
		const generation = this.#generation;
		if (!this.#started || this.#restartingRelays.get(relayUrl) === generation) return;
		this.#restartingRelays.set(relayUrl, generation);
		subscription.close('incoming receive queue saturated; replaying');
		this.#subscriptions = this.#subscriptions.filter((current) => current !== subscription);
		void this.#receiveQueue.then(async () => {
			try {
				if (!this.#started || generation !== this.#generation) return;
				const replacement = await this.#openRelay(relayUrl);
				if (!this.#started || generation !== this.#generation) {
					replacement.close('messenger runtime stopped before relay replay');
					return;
				}
				this.#clearRelayRestart(relayUrl, generation);
				this.#subscriptions.push(replacement);
			} catch (error) {
				this.#onTransportError?.(error instanceof Error ? error : new Error(String(error)));
			} finally {
				this.#clearRelayRestart(relayUrl, generation);
			}
		});
	}

	async #receive(event: Event, relayUrl: string): Promise<void> {
		const now = this.#now();
		try {
			await this.#session.withSecretKey((accountSecretKey) =>
				commitIncomingWrap(this.#database, {
					wrap: event,
					accountSecretKey,
					relayUrl,
					receivedAt: now.milliseconds,
					now: now.seconds
				})
			);
		} catch (error) {
			this.#onReceiveError?.(error instanceof Error ? error : new Error(String(error)));
		}
	}

	async send(recipientPubkey: string, content: string): Promise<string> {
		if (!this.#recoveryConfirmed) {
			throw new Error('confirm the Recovery Code before sending messages');
		}
		const now = this.#now();
		const recipient = await discoverRecipientRelays(
			this.#pool,
			this.#lookupRelays,
			recipientPubkey,
			now.seconds
		);
		const wrapped = this.#session.withSecretKey((senderSecretKey) =>
			createWrappedDirectMessage({
				content,
				senderSecretKey,
				recipientPubkey,
				createdAt: now.seconds
			})
		);
		await commitOutgoingMessage(this.#database, {
			wrapped,
			recipientRelays: recipient.relays,
			senderRelays: this.#accountDmRelays,
			committedAt: now.milliseconds
		});
		await runOutboxBatch(this.#database, createPoolPublisher(this.#pool), now.milliseconds);
		return wrapped.rumor.id;
	}

	async publishOwnRelayList() {
		const now = this.#now();
		const event = this.#session.withSecretKey((secretKey) =>
			createDmRelayList(secretKey, this.#accountDmRelays, now.seconds)
		);
		const publisher = createPoolPublisher(this.#pool);
		const results = await Promise.all(
			this.#lookupRelays.map((relayUrl) => publisher(relayUrl, event))
		);
		if (!results.some((result) => result.accepted)) {
			throw new Error('DM relay preference was not accepted by any lookup relay');
		}
		return event;
	}

	async readConversation(conversationPubkey: string): Promise<HydratedMessage[]> {
		const records = await this.#database.messages
			.where('conversationPubkey')
			.equals(conversationPubkey)
			.sortBy('createdAt');
		const hydrated: HydratedMessage[] = [];
		for (const record of records) {
			const wrapId = record.direction === 'incoming' ? record.recipientWrapId : record.senderWrapId;
			if (!wrapId) continue;
			const wire = await this.#database.wireCopies.get(wrapId);
			if (!wire) continue;
			let wrap: Event;
			try {
				wrap = JSON.parse(wire.eventJson) as Event;
			} catch {
				continue;
			}
			const now = this.#now();
			const rumor = this.#session.withSecretKey((accountSecretKey) =>
				unwrapDirectMessage({ wrap, accountSecretKey, now: now.seconds })
			);
			hydrated.push({
				rumorId: rumor.id,
				conversationPubkey: record.conversationPubkey,
				direction: record.direction,
				content: rumor.content,
				createdAt: rumor.created_at,
				state: record.state
			});
		}
		return hydrated;
	}
}
