import type { Event } from 'nostr-tools';
import {
	assertOperationCurrent,
	isOperationCancelled,
	type OperationGuard
} from '../core/operation-guard';
import type { UnlockedSession } from '../custody/session';
import {
	commitOutgoingMessage,
	type AccountDatabase,
	type MessageRecord
} from '../storage/account-database';
import {
	commitIncomingWrap,
	getRelaySubscriptionSince,
	markRelayFullReplayRequired,
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

const forcedFullReplays = new Set<string>();
const REPLAY_STORAGE_KEY = 'aura-r1:full-replay-required';

function replayRequirementKey(database: AccountDatabase, relayUrl: string): string {
	return `${database.name}\n${relayUrl}`;
}

function requireFullReplayFallback(database: AccountDatabase, relayUrl: string): void {
	forcedFullReplays.add(replayRequirementKey(database, relayUrl));
	try {
		globalThis.localStorage?.setItem(REPLAY_STORAGE_KEY, '1');
	} catch {
		// The in-process and cursor-record sentinels remain available.
	}
}

function clearDurableReplayStorageFallback(): void {
	try {
		globalThis.localStorage?.removeItem(REPLAY_STORAGE_KEY);
	} catch {
		// Retaining an origin-wide full-replay flag is conservative.
	}
}

function hasFullReplayFallback(database: AccountDatabase, relayUrl: string): boolean {
	const key = replayRequirementKey(database, relayUrl);
	if (forcedFullReplays.has(key)) return true;
	try {
		if (globalThis.localStorage?.getItem(REPLAY_STORAGE_KEY) === '1') {
			forcedFullReplays.add(key);
			return true;
		}
	} catch {
		// The cursor record remains authoritative when localStorage is unavailable.
	}
	return false;
}

function clearFullReplayFallback(database: AccountDatabase, relayUrl: string): void {
	forcedFullReplays.delete(replayRequirementKey(database, relayUrl));
}

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

interface OutboxRunState {
	generation: number;
	rerun: boolean;
	settled: boolean;
	promise: Promise<number>;
}

interface RelaySubscriptionState {
	relayUrl: string;
	generation: number;
	replayEpoch: number;
	active: boolean;
	closer?: SubscriptionCloser;
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
	#subscriptions: RelaySubscriptionState[] = [];
	#reconciliationTimer: ReturnType<typeof setInterval> | undefined;
	#outboxRun: OutboxRunState | undefined;
	#receiveQueue: Promise<void> = Promise.resolve();
	#pendingIncoming = 0;
	#restartingRelays = new Map<string, number>();
	#replaySafety = new Map<string, Promise<void>>();
	#replayEpochs = new Map<string, number>();
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

	#isGenerationCurrent(generation: number): boolean {
		return this.#generation === generation;
	}

	#operationGuard(generation: number): OperationGuard {
		return () => this.#isGenerationCurrent(generation);
	}

	#isStartedGeneration(generation: number): boolean {
		return this.#started && this.#isGenerationCurrent(generation);
	}

	#isActiveSubscription(subscription: RelaySubscriptionState): boolean {
		return subscription.active && this.#isStartedGeneration(subscription.generation);
	}

	#assertStartedGeneration(generation: number, message: string): void {
		if (!this.#isStartedGeneration(generation)) throw new Error(message);
	}

	async start(): Promise<SubscriptionCloser> {
		if (this.#started) throw new Error('messenger runtime is already started');
		const generation = ++this.#generation;
		this.#started = true;
		this.#subscriptions = [];
		const opened: RelaySubscriptionState[] = [];
		try {
			for (const relayUrl of this.#accountDmRelays) {
				const subscription = await this.#openRelay(relayUrl, generation);
				this.#assertStartedGeneration(generation, 'messenger runtime stopped during startup');
				opened.push(subscription);
				this.#subscriptions.push(subscription);
			}
			this.#assertStartedGeneration(generation, 'messenger runtime stopped during startup');
			this.#runReconciliation(generation);
			this.#reconciliationTimer = setInterval(
				() => this.#runReconciliation(generation),
				this.#reconciliationIntervalMs
			);
			return {
				close: (reason?: string) => {
					if (this.#isStartedGeneration(generation)) this.stop(reason);
				}
			};
		} catch (error) {
			for (const subscription of opened) {
				subscription.active = false;
				try {
					subscription.closer?.close('messenger runtime startup failed');
				} catch {
					// Preserve the startup failure.
				}
			}
			if (this.#generation === generation) {
				this.#subscriptions = [];
				this.#started = false;
			}
			throw error;
		}
	}

	async #openRelay(relayUrl: string, generation: number): Promise<RelaySubscriptionState> {
		const replaySafety = this.#replaySafety.get(relayUrl);
		if (replaySafety) {
			await replaySafety;
			if (this.#replaySafety.get(relayUrl) === replaySafety) {
				this.#replaySafety.delete(relayUrl);
			}
			this.#assertStartedGeneration(generation, 'messenger runtime stopped during startup');
		}
		const since = hasFullReplayFallback(this.#database, relayUrl)
			? 0
			: await getRelaySubscriptionSince(this.#database, relayUrl);
		this.#assertStartedGeneration(generation, 'messenger runtime stopped during startup');
		const subscription: RelaySubscriptionState = {
			relayUrl,
			generation,
			replayEpoch: this.#replayEpochs.get(relayUrl) ?? 0,
			active: true
		};
		subscription.closer = subscribeGiftWraps(
			this.#pool,
			[relayUrl],
			this.#session.pubkey,
			since,
			(event) => {
				if (!this.#isActiveSubscription(subscription)) return;
				this.#enqueueReceive(event, relayUrl, generation, () => {
					this.#requestRelayReplay(subscription);
				});
			},
			(reasons) => {
				if (!this.#isActiveSubscription(subscription)) return;
				if (reasons.length > 0 && this.#restartingRelays.get(relayUrl) !== generation) {
					this.#onTransportError?.(new Error(`relay subscription closed: ${reasons.join('; ')}`));
				}
			},
			() => this.#enqueueInitialSyncComplete(subscription)
		);
		if (!this.#isActiveSubscription(subscription)) {
			subscription.active = false;
			try {
				subscription.closer.close('messenger runtime stopped during startup');
			} catch {
				// Lifecycle invalidation already completed.
			}
			throw new Error('messenger runtime stopped during startup');
		}
		return subscription;
	}

	stop(reason = 'messenger runtime stopped'): void {
		this.#generation += 1;
		for (const subscription of this.#subscriptions) {
			subscription.active = false;
			try {
				subscription.closer?.close(reason);
			} catch {
				// Generation invalidation is authoritative even if transport cleanup throws.
			}
		}
		this.#subscriptions = [];
		this.#restartingRelays.clear();
		if (this.#reconciliationTimer) clearInterval(this.#reconciliationTimer);
		this.#reconciliationTimer = undefined;
		this.#started = false;
	}

	#runReconciliation(generation: number): void {
		if (!this.#isStartedGeneration(generation)) return;
		void this.reconcileOutbox().catch((error) => {
			if (isOperationCancelled(error) || !this.#isStartedGeneration(generation)) return;
			this.#onTransportError?.(error instanceof Error ? error : new Error(String(error)));
		});
	}

	async reconcileOutbox(): Promise<number> {
		const generation = this.#generation;
		this.#assertStartedGeneration(generation, 'messenger runtime is not started');
		return this.#requestOutboxRun(generation);
	}

	#requestOutboxRun(generation: number): Promise<number> {
		this.#assertStartedGeneration(generation, 'messenger runtime is not started');
		const currentRun = this.#outboxRun;
		if (currentRun?.generation === generation && !currentRun.settled) {
			currentRun.rerun = true;
			return currentRun.promise;
		}

		const state = { generation, rerun: false, settled: false } as OutboxRunState;
		state.promise = (async () => {
			try {
				let processed = 0;
				const isCurrent = this.#operationGuard(generation);
				do {
					state.rerun = false;
					assertOperationCurrent(isCurrent);
					processed += await runOutboxBatch(
						this.#database,
						createPoolPublisher(this.#pool),
						this.#now().milliseconds,
						isCurrent
					);
					assertOperationCurrent(isCurrent);
				} while (state.rerun);
				return processed;
			} finally {
				state.settled = true;
				if (this.#outboxRun === state) this.#outboxRun = undefined;
			}
		})();
		this.#outboxRun = state;
		return state.promise;
	}

	#enqueueInitialSyncComplete(subscription: RelaySubscriptionState): void {
		if (!this.#isActiveSubscription(subscription)) return;
		const { relayUrl, generation } = subscription;
		const completionIsCurrent = (): boolean =>
			this.#isActiveSubscription(subscription) &&
			(this.#replayEpochs.get(relayUrl) ?? 0) === subscription.replayEpoch;
		this.#receiveQueue = this.#receiveQueue.then(async () => {
			if (!completionIsCurrent()) return;
			try {
				await markRelayInitialSyncComplete(
					this.#database,
					relayUrl,
					this.#now().milliseconds,
					completionIsCurrent
				);
				assertOperationCurrent(completionIsCurrent);
				clearFullReplayFallback(this.#database, relayUrl);
			} catch (error) {
				if (!this.#isStartedGeneration(generation)) return;
				this.#onReceiveError?.(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	#enqueueReceive(
		event: Event,
		relayUrl: string,
		generation: number,
		onSaturated: () => void
	): void {
		if (!this.#isStartedGeneration(generation)) return;
		if (this.#pendingIncoming >= this.#maxPendingIncoming) {
			onSaturated();
			return;
		}
		this.#pendingIncoming += 1;
		this.#receiveQueue = this.#receiveQueue
			.then(() => this.#receive(event, relayUrl, generation))
			.finally(() => {
				this.#pendingIncoming -= 1;
			});
	}

	#clearRelayRestart(relayUrl: string, generation: number): void {
		if (this.#restartingRelays.get(relayUrl) === generation) {
			this.#restartingRelays.delete(relayUrl);
		}
	}

	#requestRelayReplay(subscription: RelaySubscriptionState): void {
		const { relayUrl, generation } = subscription;
		if (
			!this.#isActiveSubscription(subscription) ||
			this.#restartingRelays.get(relayUrl) === generation
		)
			return;
		this.#restartingRelays.set(relayUrl, generation);
		this.#replayEpochs.set(relayUrl, (this.#replayEpochs.get(relayUrl) ?? 0) + 1);
		subscription.active = false;
		const pendingReceiveQueue = this.#receiveQueue;
		requireFullReplayFallback(this.#database, relayUrl);
		const replaySafety = (async () => {
			try {
				await markRelayFullReplayRequired(this.#database, relayUrl, this.#now().milliseconds);
				clearDurableReplayStorageFallback();
			} catch (error) {
				if (this.#isStartedGeneration(generation)) {
					this.#onTransportError?.(error instanceof Error ? error : new Error(String(error)));
				}
			}
		})();
		this.#replaySafety.set(relayUrl, replaySafety);
		void (async () => {
			let transportClosed = false;
			const closeTransport = (): void => {
				if (transportClosed) return;
				transportClosed = true;
				try {
					subscription.closer?.close('incoming receive queue saturated; replaying');
				} catch (error) {
					if (this.#isStartedGeneration(generation)) {
						this.#onTransportError?.(error instanceof Error ? error : new Error(String(error)));
					}
				}
			};
			try {
				await replaySafety;
				await pendingReceiveQueue;
				if (!this.#started || generation !== this.#generation) return;
				this.#subscriptions = this.#subscriptions.filter((current) => current !== subscription);
				closeTransport();
				const replacement = await this.#openRelay(relayUrl, generation);
				if (!this.#started || generation !== this.#generation) {
					replacement.active = false;
					try {
						replacement.closer?.close('messenger runtime stopped before relay replay');
					} catch {
						// Lifecycle invalidation already completed.
					}
					return;
				}
				this.#clearRelayRestart(relayUrl, generation);
				this.#subscriptions.push(replacement);
			} catch (error) {
				if (!this.#isStartedGeneration(generation)) return;
				this.#onTransportError?.(error instanceof Error ? error : new Error(String(error)));
			} finally {
				const stillOwned = this.#subscriptions.includes(subscription);
				this.#subscriptions = this.#subscriptions.filter((current) => current !== subscription);
				if (stillOwned) closeTransport();
				this.#clearRelayRestart(relayUrl, generation);
			}
		})();
	}

	async #receive(event: Event, relayUrl: string, generation: number): Promise<void> {
		if (!this.#isStartedGeneration(generation)) return;
		const now = this.#now();
		try {
			const isCurrent = this.#operationGuard(generation);
			await this.#session.withSecretKey((accountSecretKey) => {
				this.#assertStartedGeneration(generation, 'messenger runtime stopped before receive');
				return commitIncomingWrap(
					this.#database,
					{
						wrap: event,
						accountSecretKey,
						relayUrl,
						receivedAt: now.milliseconds,
						now: now.seconds
					},
					isCurrent
				);
			});
		} catch (error) {
			if (!this.#isStartedGeneration(generation)) return;
			this.#onReceiveError?.(error instanceof Error ? error : new Error(String(error)));
		}
	}

	async send(recipientPubkey: string, content: string): Promise<string> {
		const generation = this.#generation;
		this.#assertStartedGeneration(generation, 'messenger runtime is not started');
		if (!this.#recoveryConfirmed) {
			throw new Error('confirm the Recovery Code before sending messages');
		}
		const isCurrent = this.#operationGuard(generation);
		assertOperationCurrent(isCurrent);
		const now = this.#now();
		const recipient = await discoverRecipientRelays(
			this.#pool,
			this.#lookupRelays,
			recipientPubkey,
			now.seconds
		);
		assertOperationCurrent(isCurrent);
		const wrapped = this.#session.withSecretKey((senderSecretKey) => {
			assertOperationCurrent(isCurrent);
			return createWrappedDirectMessage({
				content,
				senderSecretKey,
				recipientPubkey,
				createdAt: now.seconds
			});
		});
		assertOperationCurrent(isCurrent);
		await commitOutgoingMessage(
			this.#database,
			{
				wrapped,
				recipientRelays: recipient.relays,
				senderRelays: this.#accountDmRelays,
				committedAt: now.milliseconds
			},
			isCurrent
		);
		assertOperationCurrent(isCurrent);
		await this.#requestOutboxRun(generation);
		assertOperationCurrent(isCurrent);
		return wrapped.rumor.id;
	}

	async publishOwnRelayList() {
		const generation = this.#generation;
		this.#assertStartedGeneration(generation, 'messenger runtime is not started');
		const isCurrent = this.#operationGuard(generation);
		assertOperationCurrent(isCurrent);
		const now = this.#now();
		const event = this.#session.withSecretKey((secretKey) => {
			assertOperationCurrent(isCurrent);
			return createDmRelayList(secretKey, this.#accountDmRelays, now.seconds);
		});
		const publisher = createPoolPublisher(this.#pool);
		const results = await Promise.all(
			this.#lookupRelays.map(async (relayUrl) => {
				assertOperationCurrent(isCurrent);
				const result = await publisher(relayUrl, event);
				assertOperationCurrent(isCurrent);
				return result;
			})
		);
		assertOperationCurrent(isCurrent);
		if (!results.some((result) => result.accepted)) {
			throw new Error('DM relay preference was not accepted by any lookup relay');
		}
		return event;
	}

	async readConversation(conversationPubkey: string): Promise<HydratedMessage[]> {
		const generation = this.#generation;
		this.#assertStartedGeneration(generation, 'messenger runtime is not started');
		const isCurrent = this.#operationGuard(generation);
		assertOperationCurrent(isCurrent);
		const records = await this.#database.messages
			.where('conversationPubkey')
			.equals(conversationPubkey)
			.sortBy('createdAt');
		assertOperationCurrent(isCurrent);
		const hydrated: HydratedMessage[] = [];
		for (const record of records) {
			assertOperationCurrent(isCurrent);
			const wrapId = record.direction === 'incoming' ? record.recipientWrapId : record.senderWrapId;
			if (!wrapId) continue;
			const wire = await this.#database.wireCopies.get(wrapId);
			assertOperationCurrent(isCurrent);
			if (!wire) continue;
			let wrap: Event;
			try {
				wrap = JSON.parse(wire.eventJson) as Event;
			} catch {
				continue;
			}
			const now = this.#now();
			const rumor = this.#session.withSecretKey((accountSecretKey) => {
				assertOperationCurrent(isCurrent);
				return unwrapDirectMessage({ wrap, accountSecretKey, now: now.seconds });
			});
			assertOperationCurrent(isCurrent);
			hydrated.push({
				rumorId: rumor.id,
				conversationPubkey: record.conversationPubkey,
				direction: record.direction,
				content: rumor.content,
				createdAt: rumor.created_at,
				state: record.state
			});
		}
		assertOperationCurrent(isCurrent);
		return hydrated;
	}
}
