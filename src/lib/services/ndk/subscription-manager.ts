/**
 * Subscription Manager
 * 
 * Manages NDK subscriptions with proper lifecycle management and cleanup.
 */

import type NDK from '@nostr-dev-kit/ndk';
import type { NDKEvent, NDKFilter, NDKSubscription, NDKSubscriptionOptions } from '@nostr-dev-kit/ndk';

/** Subscription metadata */
export interface SubscriptionMeta {
	id: string;
	filters: NDKFilter | NDKFilter[];
	options: NDKSubscriptionOptions;
	subscription: NDKSubscription;
	createdAt: number;
	eventCount: number;
	lastEvent: number | null;
	paused: boolean;
	label?: string;
}

/** Subscription callbacks */
export interface SubscriptionCallbacks {
	onEvent?: (event: NDKEvent) => void;
	onEose?: () => void;
	onClose?: () => void;
}

/**
 * Subscription Manager Class
 * 
 * Provides centralized management of all NDK subscriptions.
 */
export class SubscriptionManager {
	private _ndk: NDK | null = null;
	private _subscriptions: Map<string, SubscriptionMeta> = new Map();
	private _counter: number = 0;

	/** Set NDK instance */
	setNDK(ndk: NDK): void {
		this._ndk = ndk;
	}

	/** Get all active subscriptions */
	getActiveSubscriptions(): SubscriptionMeta[] {
		return Array.from(this._subscriptions.values());
	}

	/** Get subscription count */
	get count(): number {
		return this._subscriptions.size;
	}

	/** Subscribe to events */
	subscribe(
		filters: NDKFilter | NDKFilter[],
		options: NDKSubscriptionOptions = {},
		callbacks?: SubscriptionCallbacks,
		label?: string
	): string {
		if (!this._ndk) {
			throw new Error('NDK not initialized');
		}

		const id = `sub-${++this._counter}-${Date.now()}`;
		const sub = this._ndk.subscribe(filters, options);

		const meta: SubscriptionMeta = {
			id,
			filters,
			options,
			subscription: sub,
			createdAt: Date.now(),
			eventCount: 0,
			lastEvent: null,
			paused: false,
			label
		};

		// Set up event handlers
		if (callbacks?.onEvent) {
			sub.on('event', (event: NDKEvent) => {
				meta.eventCount++;
				meta.lastEvent = Date.now();
				callbacks.onEvent!(event);
			});
		}

		if (callbacks?.onEose) {
			sub.on('eose', callbacks.onEose);
		}

		if (callbacks?.onClose) {
			sub.on('close', () => {
				this._subscriptions.delete(id);
				callbacks.onClose!();
			});
		}

		this._subscriptions.set(id, meta);

		return id;
	}

	/** Unsubscribe by ID */
	unsubscribe(id: string): boolean {
		const meta = this._subscriptions.get(id);
		if (!meta) return false;

		try {
			meta.subscription.stop();
		} catch {
			// Ignore errors during stop
		}

		this._subscriptions.delete(id);
		return true;
	}

	/** Unsubscribe all with a specific label */
	unsubscribeByLabel(label: string): number {
		let count = 0;
		for (const [id, meta] of this._subscriptions) {
			if (meta.label === label) {
				this.unsubscribe(id);
				count++;
			}
		}
		return count;
	}

	/** Pause a subscription */
	pause(id: string): boolean {
		const meta = this._subscriptions.get(id);
		if (!meta || meta.paused) return false;

		try {
			meta.subscription.stop();
			meta.paused = true;
			return true;
		} catch {
			return false;
		}
	}

	/** Resume a paused subscription */
	resume(id: string): boolean {
		const meta = this._subscriptions.get(id);
		if (!meta || !meta.paused || !this._ndk) return false;

		try {
			// Create new subscription with same params
			const newSub = this._ndk.subscribe(meta.filters, meta.options);
			meta.subscription = newSub;
			meta.paused = false;
			return true;
		} catch {
			return false;
		}
	}

	/** Get subscription statistics */
	getStats(): {
		total: number;
		active: number;
		paused: number;
		totalEvents: number;
	} {
		let active = 0;
		let paused = 0;
		let totalEvents = 0;

		for (const meta of this._subscriptions.values()) {
			if (meta.paused) {
				paused++;
			} else {
				active++;
			}
			totalEvents += meta.eventCount;
		}

		return {
			total: this._subscriptions.size,
			active,
			paused,
			totalEvents
		};
	}

	/** Clean up old subscriptions */
	cleanup(maxAge: number = 30 * 60 * 1000): number {
		const cutoff = Date.now() - maxAge;
		let cleaned = 0;

		for (const [id, meta] of this._subscriptions) {
			// Clean up subscriptions that haven't received events in maxAge
			if (meta.lastEvent && meta.lastEvent < cutoff) {
				this.unsubscribe(id);
				cleaned++;
			}
		}

		return cleaned;
	}

	/** Unsubscribe all */
	unsubscribeAll(): void {
		for (const id of this._subscriptions.keys()) {
			this.unsubscribe(id);
		}
	}

	/** Create a one-time fetch subscription */
	async fetchOnce(
		filters: NDKFilter | NDKFilter[],
		options: { timeout?: number; limit?: number } = {}
	): Promise<NDKEvent[]> {
		if (!this._ndk) {
			throw new Error('NDK not initialized');
		}

		const timeout = options.timeout ?? 10000;
		const events: NDKEvent[] = [];

		return new Promise((resolve, reject) => {
			const timeoutId = setTimeout(() => {
				this.unsubscribe(subId);
				resolve(events);
			}, timeout);

			const subId = this.subscribe(
				filters,
				{ closeOnEose: true },
				{
					onEvent: (event) => {
						events.push(event);
						if (options.limit && events.length >= options.limit) {
							clearTimeout(timeoutId);
							this.unsubscribe(subId);
							resolve(events);
						}
					},
					onEose: () => {
						clearTimeout(timeoutId);
						resolve(events);
					},
					onClose: () => {
						clearTimeout(timeoutId);
						resolve(events);
					}
				},
				'fetch-once'
			);
		});
	}

	/** Subscribe with automatic reconnection */
	subscribeWithReconnect(
		filters: NDKFilter | NDKFilter[],
		callbacks: SubscriptionCallbacks,
		options: {
			reconnectDelay?: number;
			maxReconnects?: number;
			label?: string;
		} = {}
	): { id: string; stop: () => void } {
		const reconnectDelay = options.reconnectDelay ?? 5000;
		const maxReconnects = options.maxReconnects ?? Infinity;
		let reconnects = 0;
		let currentId: string | null = null;
		let stopped = false;

		const createSubscription = () => {
			if (stopped || !this._ndk) return;

			currentId = this.subscribe(
				filters,
				{ closeOnEose: false },
				{
					onEvent: callbacks.onEvent,
					onEose: callbacks.onEose,
					onClose: () => {
						callbacks.onClose?.();

						if (!stopped && reconnects < maxReconnects) {
							reconnects++;
							setTimeout(createSubscription, reconnectDelay);
						}
					}
				},
				options.label
			);
		};

		createSubscription();

		return {
			id: currentId || '',
			stop: () => {
				stopped = true;
				if (currentId) {
					this.unsubscribe(currentId);
				}
			}
		};
	}
}

/** Singleton instance */
export const subscriptionManager = new SubscriptionManager();

export default subscriptionManager;
