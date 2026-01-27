/**
 * Event Publisher
 * 
 * Handles event publishing with queue management, retry logic, and deduplication.
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent, type NDKSigner, type NDKRelay } from '@nostr-dev-kit/ndk';
import { NetworkError, ErrorCode } from '$lib/core/errors';
import { dbHelpers } from '$db';

/** Publish status */
export type PublishStatus = 'pending' | 'publishing' | 'published' | 'failed';

/** Queued event */
export interface QueuedEvent {
	id: string;
	event: NDKEvent;
	status: PublishStatus;
	retries: number;
	maxRetries: number;
	createdAt: number;
	lastAttempt: number | null;
	error: string | null;
	publishedTo: string[];
	onSuccess?: (relays: Set<NDKRelay>) => void;
	onError?: (error: Error) => void;
}

/** Publisher configuration */
export interface PublisherConfig {
	/** Maximum retries for failed publishes */
	maxRetries: number;
	/** Delay between retries (ms) */
	retryDelay: number;
	/** Maximum queue size */
	maxQueueSize: number;
	/** Timeout for publish operations (ms) */
	publishTimeout: number;
	/** Minimum relays for successful publish */
	minRelaysForSuccess: number;
	/** Enable offline queue persistence */
	persistQueue: boolean;
}

/** Default configuration */
const DEFAULT_CONFIG: PublisherConfig = {
	maxRetries: 3,
	retryDelay: 2000,
	maxQueueSize: 100,
	publishTimeout: 15000,
	minRelaysForSuccess: 1,
	persistQueue: true
};

/**
 * Event Publisher Class
 * 
 * Manages event publishing with queuing and retry logic.
 */
export class EventPublisher {
	private _ndk: NDK | null = null;
	private _signer: NDKSigner | null = null;
	private readonly _config: PublisherConfig;
	private readonly _queue: Map<string, QueuedEvent> = new Map();
	private _processing: boolean = false;
	private readonly _publishedIds: Set<string> = new Set(); // Deduplication cache
	private readonly _listeners: Set<(event: PublisherEvent) => void> = new Set();

	constructor(config: Partial<PublisherConfig> = {}) {
		this._config = { ...DEFAULT_CONFIG, ...config };
	}

	/** Set NDK instance */
	setNDK(ndk: NDK): void {
		this._ndk = ndk;
	}

	/** Set signer */
	setSigner(signer: NDKSigner | null): void {
		this._signer = signer;
	}

	/** Get queue status */
	getQueueStatus(): { pending: number; publishing: number; failed: number } {
		let pending = 0;
		let publishing = 0;
		let failed = 0;

		for (const item of this._queue.values()) {
			switch (item.status) {
				case 'pending':
					pending++;
					break;
				case 'publishing':
					publishing++;
					break;
				case 'failed':
					failed++;
					break;
			}
		}

		return { pending, publishing, failed };
	}

	/** Publish an event */
	async publish(event: NDKEvent, options: {
		immediate?: boolean;
		maxRetries?: number;
		onSuccess?: (relays: Set<NDKRelay>) => void;
		onError?: (error: Error) => void;
	} = {}): Promise<Set<NDKRelay>> {
		if (!this._ndk) {
			throw new NetworkError('NDK not initialized', { code: ErrorCode.NETWORK_ERROR });
		}

		if (!this._signer) {
			throw new NetworkError('No signer available', { code: ErrorCode.AUTH_FAILED });
		}

		// Check for duplicate
		if (event.id && this._publishedIds.has(event.id)) {
			return new Set();
		}

		// Sign if not already signed
		if (!event.sig) {
			await event.sign(this._signer);
		}

		// Add to deduplication cache
		if (event.id) {
			this._publishedIds.add(event.id);
			// Limit cache size
			if (this._publishedIds.size > 1000) {
				const firstId = this._publishedIds.values().next().value;
				if (firstId) this._publishedIds.delete(firstId);
			}
		}

		// If immediate, publish directly
		if (options.immediate) {
			return this.publishDirect(event);
		}

		// Add to queue
		const queueId = event.id || `temp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		
		if (this._queue.size >= this._config.maxQueueSize) {
			// Remove oldest failed item or oldest pending
			const toRemove = this.findOldestRemovable();
			if (toRemove) {
				this._queue.delete(toRemove);
			}
		}

		const queuedEvent: QueuedEvent = {
			id: queueId,
			event,
			status: 'pending',
			retries: 0,
			maxRetries: options.maxRetries ?? this._config.maxRetries,
			createdAt: Date.now(),
			lastAttempt: null,
			error: null,
			publishedTo: [],
			onSuccess: options.onSuccess,
			onError: options.onError
		};

		this._queue.set(queueId, queuedEvent);
		this.emit({ type: 'queued', eventId: queueId });

		// Start processing if not already
		this.processQueue();

		// Return a promise that resolves when published
		return new Promise((resolve, reject) => {
			const originalOnSuccess = queuedEvent.onSuccess;
			const originalOnError = queuedEvent.onError;

			queuedEvent.onSuccess = (relays) => {
				originalOnSuccess?.(relays);
				resolve(relays);
			};

			queuedEvent.onError = (error) => {
				originalOnError?.(error);
				reject(error);
			};
		});
	}

	/** Publish directly without queueing */
	private async publishDirect(event: NDKEvent): Promise<Set<NDKRelay>> {
		if (!this._ndk || !this._signer) {
			throw new NetworkError('NDK or signer not available', { code: ErrorCode.NETWORK_ERROR });
		}

		const relays = await this.withTimeout(
			event.publish(),
			this._config.publishTimeout
		);

		// Cache locally
		await this.cacheEvent(event);

		return relays;
	}

	/** Process the publish queue */
	private async processQueue(): Promise<void> {
		if (this._processing) return;
		this._processing = true;

		try {
			while (true) {
				const nextItem = this.findNextToProcess();
				if (!nextItem) break;

				await this.processItem(nextItem);
			}
		} finally {
			this._processing = false;
		}
	}

	/** Process a single queue item */
	private async processItem(item: QueuedEvent): Promise<void> {
		item.status = 'publishing';
		item.lastAttempt = Date.now();

		try {
			const relays = await this.publishDirect(item.event);

			if (relays.size >= this._config.minRelaysForSuccess) {
				item.status = 'published';
				item.publishedTo = Array.from(relays).map(r => r.url);
				this.emit({ type: 'published', eventId: item.id, relays: relays.size });
				item.onSuccess?.(relays);
				this._queue.delete(item.id);
			} else {
				throw new Error(`Only published to ${relays.size} relays`);
			}
		} catch (error) {
			item.retries++;
			item.error = error instanceof Error ? error.message : String(error);

			if (item.retries >= item.maxRetries) {
				item.status = 'failed';
				this.emit({ type: 'failed', eventId: item.id, error: item.error });
				item.onError?.(error instanceof Error ? error : new Error(String(error)));
			} else {
				item.status = 'pending';
				this.emit({ type: 'retry', eventId: item.id, attempt: item.retries });
				// Wait before retry
				await this.sleep(this._config.retryDelay * item.retries);
			}
		}
	}

	/** Find next item to process */
	private findNextToProcess(): QueuedEvent | null {
		for (const item of this._queue.values()) {
			if (item.status === 'pending') {
				return item;
			}
		}
		return null;
	}

	/** Find oldest removable item */
	private findOldestRemovable(): string | null {
		let oldest: QueuedEvent | null = null;
		let oldestId: string | null = null;

		for (const [id, item] of this._queue) {
			if (item.status === 'failed') {
				if (!oldest || item.createdAt < oldest.createdAt) {
					oldest = item;
					oldestId = id;
				}
			}
		}

		if (oldestId) return oldestId;

		// If no failed items, find oldest pending
		for (const [id, item] of this._queue) {
			if (item.status === 'pending') {
				if (!oldest || item.createdAt < oldest.createdAt) {
					oldest = item;
					oldestId = id;
				}
			}
		}

		return oldestId;
	}

	/** Retry all failed items */
	async retryFailed(): Promise<void> {
		for (const item of this._queue.values()) {
			if (item.status === 'failed') {
				item.status = 'pending';
				item.retries = 0;
				item.error = null;
			}
		}
		this.processQueue();
	}

	/** Clear failed items from queue */
	clearFailed(): void {
		for (const [id, item] of this._queue) {
			if (item.status === 'failed') {
				this._queue.delete(id);
			}
		}
	}

	/** Cache event locally */
	private async cacheEvent(event: NDKEvent): Promise<void> {
		try {
			await dbHelpers.saveEvent({
				id: event.id,
				pubkey: event.pubkey,
				kind: event.kind ?? 1,
				created_at: event.created_at ?? Math.floor(Date.now() / 1000),
				content: event.content,
				tags: event.tags,
				sig: event.sig ?? ''
			});
		} catch (error) {
			console.error('Failed to cache event:', error);
		}
	}

	/** Add event listener */
	addListener(listener: (event: PublisherEvent) => void): () => void {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	/** Emit event */
	private emit(event: PublisherEvent): void {
		this._listeners.forEach(listener => {
			try {
				listener(event);
			} catch {
				// Ignore listener errors
			}
		});
	}

	/**
	 * Process pending events from IndexedDB outbox.
	 * Called when coming back online after being offline.
	 */
	async processOutbox(): Promise<number> {
		if (!this._ndk) {
			return 0;
		}

		const pendingEvents = await dbHelpers.getOutboxEvents();
		let processed = 0;

		for (const item of pendingEvents) {
			try {
				// Parse stored event
				const eventData = JSON.parse(item.event_json);
				const event = new NDKEvent(this._ndk, eventData);

				// Try to publish
				const relays = await this.publish(event);

				if (relays.size > 0) {
					// Success - remove from outbox
					await dbHelpers.removeFromOutbox(item.id);
					processed++;
				} else {
					// Failed - increment retry count
					await dbHelpers.updateOutboxEvent(item.id, 'No relays accepted the event');
				}
			} catch (error) {
				// Update retry info
				const errorMsg = error instanceof Error ? error.message : 'Unknown error';
				await dbHelpers.updateOutboxEvent(item.id, errorMsg);

				// Remove if too many retries
				if (item.retries >= this._config.maxRetries) {
					await dbHelpers.removeFromOutbox(item.id);
				}
			}
		}

		return processed;
	}

	/** Helper: sleep */
	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/** Helper: timeout wrapper */
	private withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) =>
				setTimeout(() => reject(new Error('Publish timed out')), timeout)
			)
		]);
	}
}

/** Publisher events */
export type PublisherEvent =
	| { type: 'queued'; eventId: string }
	| { type: 'published'; eventId: string; relays: number }
	| { type: 'retry'; eventId: string; attempt: number }
	| { type: 'failed'; eventId: string; error: string };

/** Singleton instance */
export const eventPublisher = new EventPublisher();

export default eventPublisher;
