/**
 * Sync Manager
 * 
 * Handles offline-first data synchronization with background sync queue.
 */

import { dbHelpers, type OutboxEvent } from '$db';
import ndkService from '$services/ndk';
import { retry, CircuitBreaker } from '$lib/core/resilience';
import { browser } from '$app/environment';

/** Sync status */
export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error';

/** Sync event */
export type SyncEvent =
	| { type: 'status_change'; status: SyncStatus }
	| { type: 'event_synced'; id: string }
	| { type: 'event_failed'; id: string; error: string }
	| { type: 'queue_update'; pending: number };

/**
 * Sync Manager Class
 * 
 * Manages background synchronization of events when coming back online.
 */
class SyncManager {
	private _status: SyncStatus = 'idle';
	private _isOnline = browser ? navigator.onLine : true;
	private _syncInterval: ReturnType<typeof setInterval> | null = null;
	private _listeners: Set<(event: SyncEvent) => void> = new Set();
	private _circuitBreaker = new CircuitBreaker({
		failureThreshold: 3,
		resetTimeout: 60000
	});

	/** Get current sync status */
	get status(): SyncStatus {
		return this._status;
	}

	/** Check if online */
	get isOnline(): boolean {
		return this._isOnline;
	}

	/**
	 * Initialize sync manager
	 */
	init(): void {
		if (!browser) return;

		// Listen for online/offline events
		window.addEventListener('online', () => this.handleOnline());
		window.addEventListener('offline', () => this.handleOffline());

		// Start periodic sync
		this.startPeriodicSync();

		// Initial sync if online
		if (this._isOnline) {
			this.sync();
		}
	}

	/**
	 * Add event to outbox for later sync
	 */
	async queueEvent(eventJson: string): Promise<string> {
		const id = await dbHelpers.addToOutbox(eventJson);
		this.emit({ type: 'queue_update', pending: await this.getPendingCount() });

		// Try to sync immediately if online
		if (this._isOnline) {
			this.sync();
		}

		return id;
	}

	/**
	 * Sync all pending events
	 */
	async sync(): Promise<void> {
		if (this._status === 'syncing' || !this._isOnline) {
			return;
		}

		if (!this._circuitBreaker.isAllowed()) {
			this.setStatus('error');
			return;
		}

		this.setStatus('syncing');

		try {
			const pendingEvents = await dbHelpers.getOutboxEvents();

			for (const outboxEvent of pendingEvents) {
				await this.syncEvent(outboxEvent);
			}

			this._circuitBreaker.recordSuccess();
			this.setStatus('idle');
		} catch (error) {
			console.error('Sync failed:', error);
			this._circuitBreaker.recordFailure();
			this.setStatus('error');
		}
	}

	/**
	 * Sync a single event
	 */
	private async syncEvent(outboxEvent: OutboxEvent): Promise<void> {
		try {
			const event = JSON.parse(outboxEvent.event_json);

			// Use retry with exponential backoff
			await retry(
				async () => {
					const { NDKEvent } = await import('@nostr-dev-kit/ndk');
					const ndkEvent = new NDKEvent(ndkService.ndk);
					Object.assign(ndkEvent, event);
					await ndkEvent.publish();
				},
				{
					maxRetries: 3,
					initialDelay: 1000,
					shouldRetry: (error, attempt) => {
						// Don't retry if max retries reached in outbox
						return outboxEvent.retries + attempt < 10;
					}
				}
			);

			// Remove from outbox on success
			await dbHelpers.removeFromOutbox(outboxEvent.id);
			this.emit({ type: 'event_synced', id: outboxEvent.id });
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';

			// Update outbox with error
			await dbHelpers.updateOutboxEvent(outboxEvent.id, errorMessage);
			this.emit({ type: 'event_failed', id: outboxEvent.id, error: errorMessage });

			// If too many retries, remove from queue
			if (outboxEvent.retries >= 10) {
				await dbHelpers.removeFromOutbox(outboxEvent.id);
			}
		}

		this.emit({ type: 'queue_update', pending: await this.getPendingCount() });
	}

	/**
	 * Get count of pending events
	 */
	async getPendingCount(): Promise<number> {
		const events = await dbHelpers.getOutboxEvents();
		return events.length;
	}

	/**
	 * Clear all pending events
	 */
	async clearQueue(): Promise<void> {
		const events = await dbHelpers.getOutboxEvents();
		for (const event of events) {
			await dbHelpers.removeFromOutbox(event.id);
		}
		this.emit({ type: 'queue_update', pending: 0 });
	}

	/**
	 * Add event listener
	 */
	addListener(listener: (event: SyncEvent) => void): () => void {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	/**
	 * Stop sync manager
	 */
	stop(): void {
		if (this._syncInterval) {
			clearInterval(this._syncInterval);
			this._syncInterval = null;
		}
	}

	// Private methods

	private handleOnline(): void {
		this._isOnline = true;
		this.setStatus('idle');
		this.sync();
	}

	private handleOffline(): void {
		this._isOnline = false;
		this.setStatus('offline');
	}

	private startPeriodicSync(): void {
		// Sync every 30 seconds
		this._syncInterval = setInterval(() => {
			if (this._isOnline && this._status !== 'syncing') {
				this.sync();
			}
		}, 30000);
	}

	private setStatus(status: SyncStatus): void {
		if (this._status !== status) {
			this._status = status;
			this.emit({ type: 'status_change', status });
		}
	}

	private emit(event: SyncEvent): void {
		this._listeners.forEach((listener) => {
			try {
				listener(event);
			} catch {
				// Ignore listener errors
			}
		});
	}
}

/** Singleton instance */
export const syncManager = new SyncManager();

export default syncManager;
