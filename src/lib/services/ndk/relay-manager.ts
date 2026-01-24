/**
 * Relay Manager
 * 
 * Handles relay connection pooling, health monitoring, and automatic failover.
 */

import type NDK from '@nostr-dev-kit/ndk';
import { NDKRelay } from '@nostr-dev-kit/ndk';
import { NetworkError, ErrorCode } from '$lib/core/errors';
import { db } from '$db';

/** Relay health status */
export interface RelayHealth {
	url: string;
	connected: boolean;
	latency: number | null;
	lastConnected: number | null;
	lastError: string | null;
	errorCount: number;
	successCount: number;
	score: number; // 0-100, higher is better
}

/** Relay manager configuration */
export interface RelayManagerConfig {
	/** Maximum number of connection retries */
	maxRetries: number;
	/** Base delay for exponential backoff (ms) */
	baseRetryDelay: number;
	/** Maximum retry delay (ms) */
	maxRetryDelay: number;
	/** Health check interval (ms) */
	healthCheckInterval: number;
	/** Minimum number of connected relays to consider "healthy" */
	minConnectedRelays: number;
	/** Timeout for relay operations (ms) */
	operationTimeout: number;
}

/** Default configuration */
const DEFAULT_CONFIG: RelayManagerConfig = {
	maxRetries: 5,
	baseRetryDelay: 1000,
	maxRetryDelay: 30000,
	healthCheckInterval: 60000,
	minConnectedRelays: 2,
	operationTimeout: 10000
};

/** Default relays */
export const DEFAULT_RELAYS = [
	'wss://relay.damus.io',
	'wss://relay.primal.net',
	'wss://nos.lol',
	'wss://relay.nostr.band',
	'wss://nostr.wine',
	'wss://relay.snort.social',
	'wss://purplepag.es'
];

/** Backup relays */
export const BACKUP_RELAYS = [
	'wss://relay.damus.io',
	'wss://nostr.mom',
	'wss://relay.nostr.net'
];

/**
 * Relay Manager Class
 * 
 * Manages relay connections with health monitoring and automatic failover.
 */
export class RelayManager {
	private _ndk: NDK | null = null;
	private _config: RelayManagerConfig;
	private _health: Map<string, RelayHealth> = new Map();
	private _retryCount: Map<string, number> = new Map();
	private _healthCheckTimer: ReturnType<typeof setInterval> | null = null;
	private _listeners: Set<(event: RelayEvent) => void> = new Set();

	constructor(config: Partial<RelayManagerConfig> = {}) {
		this._config = { ...DEFAULT_CONFIG, ...config };
	}

	/** Set NDK instance */
	setNDK(ndk: NDK): void {
		this._ndk = ndk;
		this.setupListeners();
	}

	/** Get relay health status */
	getHealth(url: string): RelayHealth | undefined {
		return this._health.get(url);
	}

	/** Get all relay health statuses */
	getAllHealth(): RelayHealth[] {
		return Array.from(this._health.values());
	}

	/** Get connected relays */
	getConnectedRelays(): string[] {
		return Array.from(this._health.entries())
			.filter(([_, health]) => health.connected)
			.map(([url]) => url);
	}

	/** Get relay health score */
	getRelayScore(url: string): number {
		const health = this._health.get(url);
		if (!health) return 0;

		let score = 50; // Base score

		// Connection status (±30)
		if (health.connected) {
			score += 30;
		} else {
			score -= 30;
		}

		// Latency (±10)
		if (health.latency !== null) {
			if (health.latency < 100) score += 10;
			else if (health.latency < 300) score += 5;
			else if (health.latency > 1000) score -= 10;
		}

		// Error rate (±10)
		const totalRequests = health.successCount + health.errorCount;
		if (totalRequests > 0) {
			const errorRate = health.errorCount / totalRequests;
			if (errorRate < 0.01) score += 10;
			else if (errorRate < 0.05) score += 5;
			else if (errorRate > 0.2) score -= 10;
		}

		return Math.max(0, Math.min(100, score));
	}

	/** Select best relays for an operation */
	selectBestRelays(count: number = 3): string[] {
		return Array.from(this._health.entries())
			.filter(([_, health]) => health.connected)
			.sort((a, b) => b[1].score - a[1].score)
			.slice(0, count)
			.map(([url]) => url);
	}

	/** Add a relay */
	async addRelay(url: string, read: boolean = true, write: boolean = true): Promise<void> {
		if (!this._ndk) {
			throw new NetworkError('NDK not initialized', { code: ErrorCode.NETWORK_ERROR });
		}

		// Validate URL
		if (!url.startsWith('wss://') && !url.startsWith('ws://')) {
			throw new NetworkError('Invalid relay URL', {
				code: ErrorCode.RELAY_CONNECTION_FAILED,
				details: { url }
			});
		}

		// Initialize health tracking
		this._health.set(url, {
			url,
			connected: false,
			latency: null,
			lastConnected: null,
			lastError: null,
			errorCount: 0,
			successCount: 0,
			score: 50
		});

		// Add to database
		await db.relays.put({ url, read, write, connected: false });

		// Add to NDK pool
		try {
			const relay = new NDKRelay(url, undefined, this._ndk);
			this._ndk.pool.addRelay(relay);
			await this.connectRelay(url);
		} catch (error) {
			this.recordError(url, error instanceof Error ? error.message : 'Connection failed');
			throw error;
		}
	}

	/** Remove a relay */
	async removeRelay(url: string): Promise<void> {
		this._health.delete(url);
		this._retryCount.delete(url);
		await db.relays.delete(url);
		// Note: NDK doesn't have a direct removeRelay method
	}

	/** Connect to a specific relay with retry logic */
	async connectRelay(url: string): Promise<void> {
		if (!this._ndk) return;

		const maxRetries = this._config.maxRetries;
		let lastError: Error | null = null;

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				const relay = this._ndk.pool.getRelay(url);
				if (relay) {
					await this.withTimeout(relay.connect(), this._config.operationTimeout);
					this.recordSuccess(url);
					return;
				}
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				this.recordError(url, lastError.message);

				if (attempt < maxRetries) {
					const delay = this.calculateBackoff(attempt);
					await this.sleep(delay);
				}
			}
		}

		throw new NetworkError(`Failed to connect to relay after ${maxRetries} attempts`, {
			code: ErrorCode.RELAY_CONNECTION_FAILED,
			cause: lastError || undefined,
			details: { url, attempts: maxRetries }
		});
	}

	/** Start health monitoring */
	startHealthMonitoring(): void {
		if (this._healthCheckTimer) return;

		this._healthCheckTimer = setInterval(() => {
			this.performHealthCheck();
		}, this._config.healthCheckInterval);

		// Initial check
		this.performHealthCheck();
	}

	/** Stop health monitoring */
	stopHealthMonitoring(): void {
		if (this._healthCheckTimer) {
			clearInterval(this._healthCheckTimer);
			this._healthCheckTimer = null;
		}
	}

	/** Perform health check on all relays */
	private async performHealthCheck(): Promise<void> {
		if (!this._ndk) return;

		const connectedCount = this.getConnectedRelays().length;

		// If below minimum, try to connect backup relays
		if (connectedCount < this._config.minConnectedRelays) {
			this.emit({ type: 'low_connectivity', connectedCount });
			await this.connectBackupRelays();
		}

		// Update scores
		for (const [url] of this._health) {
			const score = this.getRelayScore(url);
			const health = this._health.get(url);
			if (health) {
				health.score = score;
				this._health.set(url, health);
			}
		}
	}

	/** Connect to backup relays when connectivity is low */
	private async connectBackupRelays(): Promise<void> {
		for (const url of BACKUP_RELAYS) {
			if (!this._health.has(url)) {
				try {
					await this.addRelay(url);
				} catch {
					// Ignore errors, just try next
				}
			}
		}
	}

	/** Record a successful operation for a relay */
	recordSuccess(url: string): void {
		const health = this._health.get(url);
		if (health) {
			health.connected = true;
			health.successCount++;
			health.lastConnected = Date.now();
			health.score = this.getRelayScore(url);
			this._health.set(url, health);
			this._retryCount.delete(url);
		}
	}

	/** Record an error for a relay */
	recordError(url: string, error: string): void {
		const health = this._health.get(url);
		if (health) {
			health.errorCount++;
			health.lastError = error;
			health.score = this.getRelayScore(url);
			this._health.set(url, health);
		}
	}

	/** Add event listener */
	addListener(listener: (event: RelayEvent) => void): () => void {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	/** Emit event to listeners */
	private emit(event: RelayEvent): void {
		this._listeners.forEach(listener => {
			try {
				listener(event);
			} catch {
				// Ignore listener errors
			}
		});
	}

	/** Set up NDK pool listeners */
	private setupListeners(): void {
		if (!this._ndk) return;

		this._ndk.pool.on('relay:connect', (relay: NDKRelay) => {
			this.recordSuccess(relay.url);
			this.emit({ type: 'connected', url: relay.url });
		});

		this._ndk.pool.on('relay:disconnect', (relay: NDKRelay) => {
			const health = this._health.get(relay.url);
			if (health) {
				health.connected = false;
				this._health.set(relay.url, health);
			}
			this.emit({ type: 'disconnected', url: relay.url });
		});
	}

	/** Calculate exponential backoff delay */
	private calculateBackoff(attempt: number): number {
		const delay = this._config.baseRetryDelay * Math.pow(2, attempt);
		const jitter = Math.random() * 0.3 * delay; // Add 0-30% jitter
		return Math.min(delay + jitter, this._config.maxRetryDelay);
	}

	/** Sleep for a duration */
	private sleep(ms: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, ms));
	}

	/** Wrap promise with timeout */
	private withTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
		return Promise.race([
			promise,
			new Promise<T>((_, reject) =>
				setTimeout(() => reject(new Error('Operation timed out')), timeout)
			)
		]);
	}
}

/** Relay events */
export type RelayEvent =
	| { type: 'connected'; url: string }
	| { type: 'disconnected'; url: string }
	| { type: 'low_connectivity'; connectedCount: number }
	| { type: 'health_update'; health: RelayHealth };

/** Singleton instance */
export const relayManager = new RelayManager();

export default relayManager;
