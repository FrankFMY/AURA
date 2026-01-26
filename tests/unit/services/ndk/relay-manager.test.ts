/**
 * Relay Manager Tests
 *
 * Tests for relay connection pooling, health monitoring, and failover.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
const { mockDb, mockNDKRelay, mockNDKPool } = vi.hoisted(() => ({
	mockDb: {
		relays: {
			toArray: vi.fn().mockResolvedValue([]),
			put: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined)
		}
	},
	mockNDKRelay: vi.fn().mockImplementation(function(this: any, url: string) {
		this.url = url;
		this.connect = vi.fn().mockResolvedValue(undefined);
		return this;
	}),
	mockNDKPool: {
		addRelay: vi.fn(),
		getRelay: vi.fn(),
		on: vi.fn()
	}
}));

vi.mock('$db', () => ({
	db: mockDb
}));

vi.mock('@nostr-dev-kit/ndk', () => ({
	NDKRelay: mockNDKRelay
}));

vi.mock('$lib/core/errors', () => ({
	NetworkError: class NetworkError extends Error {
		constructor(msg: string, opts?: any) {
			super(msg);
			this.name = 'NetworkError';
		}
	},
	ErrorCode: {
		NETWORK_ERROR: 'NETWORK_ERROR',
		RELAY_CONNECTION_FAILED: 'RELAY_CONNECTION_FAILED'
	}
}));

// Import after mocks
import { RelayManager, DEFAULT_RELAYS, BACKUP_RELAYS } from '$services/ndk/relay-manager';

describe('RelayManager', () => {
	let relayManager: RelayManager;
	let mockNDK: any;

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();

		// Create fresh instance with test config
		relayManager = new RelayManager({
			maxRetries: 2,
			baseRetryDelay: 100,
			maxRetryDelay: 1000,
			healthCheckInterval: 5000,
			minConnectedRelays: 1,
			operationTimeout: 1000,
			blacklistDuration: 10000
		});

		// Mock NDK instance
		mockNDK = {
			pool: {
				addRelay: vi.fn(),
				getRelay: vi.fn().mockImplementation((url: string) => ({
					url,
					connect: vi.fn().mockResolvedValue(undefined)
				})),
				on: vi.fn()
			}
		};
	});

	afterEach(() => {
		relayManager.stopHealthMonitoring();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	describe('Constants', () => {
		it('should export DEFAULT_RELAYS', () => {
			expect(DEFAULT_RELAYS).toBeDefined();
			expect(Array.isArray(DEFAULT_RELAYS)).toBe(true);
			expect(DEFAULT_RELAYS.length).toBeGreaterThan(0);
		});

		it('should export BACKUP_RELAYS', () => {
			expect(BACKUP_RELAYS).toBeDefined();
			expect(Array.isArray(BACKUP_RELAYS)).toBe(true);
			expect(BACKUP_RELAYS.length).toBeGreaterThan(0);
		});

		it('should have valid relay URLs', () => {
			DEFAULT_RELAYS.forEach(url => {
				expect(url).toMatch(/^wss?:\/\//);
			});
		});
	});

	describe('Blacklist management', () => {
		it('should not blacklist relay by default', () => {
			expect(relayManager.isBlacklisted('wss://test.relay')).toBe(false);
		});

		it('should blacklist a relay', () => {
			relayManager.blacklistRelay('wss://bad.relay');

			expect(relayManager.isBlacklisted('wss://bad.relay')).toBe(true);
		});

		it('should unblacklist a relay', () => {
			relayManager.blacklistRelay('wss://temp.relay');
			expect(relayManager.isBlacklisted('wss://temp.relay')).toBe(true);

			relayManager.unblacklistRelay('wss://temp.relay');
			expect(relayManager.isBlacklisted('wss://temp.relay')).toBe(false);
		});

		it('should auto-expire blacklist entries', () => {
			relayManager.blacklistRelay('wss://expiring.relay', 5000);
			expect(relayManager.isBlacklisted('wss://expiring.relay')).toBe(true);

			// Advance time past expiry
			vi.advanceTimersByTime(6000);

			expect(relayManager.isBlacklisted('wss://expiring.relay')).toBe(false);
		});

		it('should return all blacklisted relays', () => {
			relayManager.blacklistRelay('wss://relay1.test');
			relayManager.blacklistRelay('wss://relay2.test');

			const blacklisted = relayManager.getBlacklistedRelays();

			expect(blacklisted).toContain('wss://relay1.test');
			expect(blacklisted).toContain('wss://relay2.test');
			expect(blacklisted).toHaveLength(2);
		});

		it('should clean up expired entries when getting blacklisted relays', () => {
			relayManager.blacklistRelay('wss://short.relay', 1000);
			relayManager.blacklistRelay('wss://long.relay', 10000);

			vi.advanceTimersByTime(2000);

			const blacklisted = relayManager.getBlacklistedRelays();

			expect(blacklisted).not.toContain('wss://short.relay');
			expect(blacklisted).toContain('wss://long.relay');
		});
	});

	describe('quickHealthCheck()', () => {
		it('should return false for blacklisted relays', async () => {
			relayManager.blacklistRelay('wss://blacklisted.relay');

			const result = await relayManager.quickHealthCheck('wss://blacklisted.relay');

			expect(result).toBe(false);
		});

		it('should return false for invalid URL format', async () => {
			const result = await relayManager.quickHealthCheck('http://invalid.relay');

			expect(result).toBe(false);
		});

		it('should return false for non-websocket URL', async () => {
			const result = await relayManager.quickHealthCheck('https://notws.relay');

			expect(result).toBe(false);
		});

		// Note: Full WebSocket testing would require a real server or more complex mocking
	});

	describe('setNDK()', () => {
		it('should set NDK instance', () => {
			relayManager.setNDK(mockNDK);

			expect(mockNDK.pool.on).toHaveBeenCalledWith('relay:connect', expect.any(Function));
			expect(mockNDK.pool.on).toHaveBeenCalledWith('relay:disconnect', expect.any(Function));
		});
	});

	describe('Health tracking', () => {
		it('should return undefined for unknown relay health', () => {
			const health = relayManager.getHealth('wss://unknown.relay');

			expect(health).toBeUndefined();
		});

		it('should return empty array when no health data', () => {
			const allHealth = relayManager.getAllHealth();

			expect(allHealth).toEqual([]);
		});

		it('should return connected relays', () => {
			// Set up health data manually
			(relayManager as any)._health.set('wss://connected.relay', {
				url: 'wss://connected.relay',
				connected: true,
				latency: 100,
				lastConnected: Date.now(),
				lastError: null,
				errorCount: 0,
				successCount: 10,
				score: 80
			});

			(relayManager as any)._health.set('wss://disconnected.relay', {
				url: 'wss://disconnected.relay',
				connected: false,
				latency: null,
				lastConnected: null,
				lastError: 'Connection refused',
				errorCount: 5,
				successCount: 0,
				score: 20
			});

			const connected = relayManager.getConnectedRelays();

			expect(connected).toContain('wss://connected.relay');
			expect(connected).not.toContain('wss://disconnected.relay');
		});
	});

	describe('getRelayScore()', () => {
		it('should return 0 for unknown relay', () => {
			const score = relayManager.getRelayScore('wss://unknown.relay');

			expect(score).toBe(0);
		});

		it('should give higher score to connected relay', () => {
			(relayManager as any)._health.set('wss://connected.relay', {
				url: 'wss://connected.relay',
				connected: true,
				latency: 50,
				lastConnected: Date.now(),
				lastError: null,
				errorCount: 0,
				successCount: 100,
				score: 0
			});

			(relayManager as any)._health.set('wss://disconnected.relay', {
				url: 'wss://disconnected.relay',
				connected: false,
				latency: null,
				lastConnected: null,
				lastError: 'Error',
				errorCount: 10,
				successCount: 10,
				score: 0
			});

			const connectedScore = relayManager.getRelayScore('wss://connected.relay');
			const disconnectedScore = relayManager.getRelayScore('wss://disconnected.relay');

			expect(connectedScore).toBeGreaterThan(disconnectedScore);
		});

		it('should penalize high latency', () => {
			(relayManager as any)._health.set('wss://fast.relay', {
				url: 'wss://fast.relay',
				connected: true,
				latency: 50,
				lastConnected: Date.now(),
				lastError: null,
				errorCount: 0,
				successCount: 10,
				score: 0
			});

			(relayManager as any)._health.set('wss://slow.relay', {
				url: 'wss://slow.relay',
				connected: true,
				latency: 2000,
				lastConnected: Date.now(),
				lastError: null,
				errorCount: 0,
				successCount: 10,
				score: 0
			});

			const fastScore = relayManager.getRelayScore('wss://fast.relay');
			const slowScore = relayManager.getRelayScore('wss://slow.relay');

			expect(fastScore).toBeGreaterThan(slowScore);
		});

		it('should penalize high error rate', () => {
			(relayManager as any)._health.set('wss://reliable.relay', {
				url: 'wss://reliable.relay',
				connected: true,
				latency: 100,
				lastConnected: Date.now(),
				lastError: null,
				errorCount: 0,
				successCount: 100,
				score: 0
			});

			(relayManager as any)._health.set('wss://unreliable.relay', {
				url: 'wss://unreliable.relay',
				connected: true,
				latency: 100,
				lastConnected: Date.now(),
				lastError: 'Some error',
				errorCount: 50,
				successCount: 50,
				score: 0
			});

			const reliableScore = relayManager.getRelayScore('wss://reliable.relay');
			const unreliableScore = relayManager.getRelayScore('wss://unreliable.relay');

			expect(reliableScore).toBeGreaterThan(unreliableScore);
		});

		it('should clamp score between 0 and 100', () => {
			(relayManager as any)._health.set('wss://perfect.relay', {
				url: 'wss://perfect.relay',
				connected: true,
				latency: 10,
				lastConnected: Date.now(),
				lastError: null,
				errorCount: 0,
				successCount: 1000,
				score: 0
			});

			const score = relayManager.getRelayScore('wss://perfect.relay');

			expect(score).toBeLessThanOrEqual(100);
			expect(score).toBeGreaterThanOrEqual(0);
		});
	});

	describe('selectBestRelays()', () => {
		it('should return empty array when no relays', () => {
			const best = relayManager.selectBestRelays(3);

			expect(best).toEqual([]);
		});

		it('should select only connected relays', () => {
			(relayManager as any)._health.set('wss://connected.relay', {
				url: 'wss://connected.relay',
				connected: true,
				score: 80
			});

			(relayManager as any)._health.set('wss://disconnected.relay', {
				url: 'wss://disconnected.relay',
				connected: false,
				score: 90
			});

			const best = relayManager.selectBestRelays(2);

			expect(best).toContain('wss://connected.relay');
			expect(best).not.toContain('wss://disconnected.relay');
		});

		it('should sort by score descending', () => {
			(relayManager as any)._health.set('wss://low.relay', {
				url: 'wss://low.relay',
				connected: true,
				score: 30
			});

			(relayManager as any)._health.set('wss://high.relay', {
				url: 'wss://high.relay',
				connected: true,
				score: 90
			});

			(relayManager as any)._health.set('wss://mid.relay', {
				url: 'wss://mid.relay',
				connected: true,
				score: 60
			});

			const best = relayManager.selectBestRelays(3);

			expect(best[0]).toBe('wss://high.relay');
			expect(best[1]).toBe('wss://mid.relay');
			expect(best[2]).toBe('wss://low.relay');
		});

		it('should limit results to requested count', () => {
			(relayManager as any)._health.set('wss://relay1.test', { url: 'wss://relay1.test', connected: true, score: 90 });
			(relayManager as any)._health.set('wss://relay2.test', { url: 'wss://relay2.test', connected: true, score: 80 });
			(relayManager as any)._health.set('wss://relay3.test', { url: 'wss://relay3.test', connected: true, score: 70 });
			(relayManager as any)._health.set('wss://relay4.test', { url: 'wss://relay4.test', connected: true, score: 60 });

			const best = relayManager.selectBestRelays(2);

			expect(best).toHaveLength(2);
		});
	});

	describe('addRelay()', () => {
		it('should throw if NDK not initialized', async () => {
			await expect(relayManager.addRelay('wss://test.relay'))
				.rejects.toThrow('NDK not initialized');
		});

		it('should throw for invalid URL', async () => {
			relayManager.setNDK(mockNDK);

			await expect(relayManager.addRelay('http://invalid.relay'))
				.rejects.toThrow('Invalid relay URL');
		});

		it('should throw for blacklisted relay', async () => {
			relayManager.setNDK(mockNDK);
			relayManager.blacklistRelay('wss://blacklisted.relay');

			await expect(relayManager.addRelay('wss://blacklisted.relay'))
				.rejects.toThrow('temporarily blacklisted');
		});

		it('should add relay to database', async () => {
			relayManager.setNDK(mockNDK);

			await relayManager.addRelay('wss://new.relay');

			expect(mockDb.relays.put).toHaveBeenCalledWith({
				url: 'wss://new.relay',
				read: true,
				write: true,
				connected: false
			});
		});

		it('should initialize health tracking', async () => {
			relayManager.setNDK(mockNDK);

			await relayManager.addRelay('wss://tracked.relay');

			const health = relayManager.getHealth('wss://tracked.relay');
			expect(health).toBeDefined();
			expect(health?.url).toBe('wss://tracked.relay');
			expect(health?.connected).toBe(true); // After successful connect
		});

		it('should support read/write configuration', async () => {
			relayManager.setNDK(mockNDK);

			await relayManager.addRelay('wss://readonly.relay', true, false);

			expect(mockDb.relays.put).toHaveBeenCalledWith({
				url: 'wss://readonly.relay',
				read: true,
				write: false,
				connected: false
			});
		});
	});

	describe('removeRelay()', () => {
		it('should remove relay from database', async () => {
			await relayManager.removeRelay('wss://old.relay');

			expect(mockDb.relays.delete).toHaveBeenCalledWith('wss://old.relay');
		});

		it('should remove health data', async () => {
			(relayManager as any)._health.set('wss://old.relay', { url: 'wss://old.relay' });

			await relayManager.removeRelay('wss://old.relay');

			expect(relayManager.getHealth('wss://old.relay')).toBeUndefined();
		});

		it('should remove from blacklist', async () => {
			relayManager.blacklistRelay('wss://blacklisted.relay');
			expect(relayManager.isBlacklisted('wss://blacklisted.relay')).toBe(true);

			await relayManager.removeRelay('wss://blacklisted.relay');

			expect(relayManager.isBlacklisted('wss://blacklisted.relay')).toBe(false);
		});
	});

	describe('connectRelay()', () => {
		it('should throw for blacklisted relay', async () => {
			relayManager.setNDK(mockNDK);
			relayManager.blacklistRelay('wss://blacklisted.relay');

			await expect(relayManager.connectRelay('wss://blacklisted.relay'))
				.rejects.toThrow('temporarily blacklisted');
		});

		it('should connect successfully', async () => {
			relayManager.setNDK(mockNDK);

			// Set up health data
			(relayManager as any)._health.set('wss://test.relay', {
				url: 'wss://test.relay',
				connected: false,
				successCount: 0
			});

			await relayManager.connectRelay('wss://test.relay');

			expect(mockNDK.pool.getRelay).toHaveBeenCalledWith('wss://test.relay');
		});

		it('should unblacklist relay method works correctly', () => {
			// Test that unblacklistRelay removes from blacklist
			relayManager.blacklistRelay('wss://recovering.relay');
			expect(relayManager.isBlacklisted('wss://recovering.relay')).toBe(true);

			relayManager.unblacklistRelay('wss://recovering.relay');
			expect(relayManager.isBlacklisted('wss://recovering.relay')).toBe(false);
		});

		it('should retry on failure', async () => {
			relayManager.setNDK(mockNDK);

			let attempts = 0;
			mockNDK.pool.getRelay.mockImplementation(() => ({
				connect: vi.fn().mockImplementation(() => {
					attempts++;
					if (attempts < 3) {
						return Promise.reject(new Error('Connection failed'));
					}
					return Promise.resolve();
				})
			}));

			(relayManager as any)._health.set('wss://flaky.relay', { url: 'wss://flaky.relay' });

			// Need to advance timers for backoff delays
			const connectPromise = relayManager.connectRelay('wss://flaky.relay');

			// Advance through retry delays
			await vi.advanceTimersByTimeAsync(200);
			await vi.advanceTimersByTimeAsync(400);

			await connectPromise;

			expect(attempts).toBe(3);
		});

		it('should blacklist after max retries', async () => {
			relayManager.setNDK(mockNDK);

			mockNDK.pool.getRelay.mockImplementation(() => ({
				connect: vi.fn().mockRejectedValue(new Error('Always fails'))
			}));

			(relayManager as any)._health.set('wss://failing.relay', { url: 'wss://failing.relay', errorCount: 0 });

			// Use a wrapper to handle the async rejection properly
			let error: Error | null = null;
			const connectPromise = relayManager.connectRelay('wss://failing.relay').catch(e => {
				error = e;
			});

			// Advance through all retry attempts with proper async handling
			for (let i = 0; i < 5; i++) {
				await vi.advanceTimersByTimeAsync(500);
			}

			await connectPromise;

			expect(error).not.toBeNull();
			expect(error!.message).toContain('Failed to connect');
			expect(relayManager.isBlacklisted('wss://failing.relay')).toBe(true);
		});
	});

	describe('Health monitoring', () => {
		it('should start health monitoring', () => {
			relayManager.setNDK(mockNDK);

			relayManager.startHealthMonitoring();

			// Initial check should be called
			// (Health check is async, so we just verify no errors)
		});

		it('should not start duplicate monitoring', () => {
			relayManager.setNDK(mockNDK);

			relayManager.startHealthMonitoring();
			relayManager.startHealthMonitoring();

			// Should not throw and should only have one timer
		});

		it('should stop health monitoring', () => {
			relayManager.setNDK(mockNDK);

			relayManager.startHealthMonitoring();
			relayManager.stopHealthMonitoring();

			// Verify timer is cleared (internal state)
			expect((relayManager as any)._healthCheckTimer).toBeNull();
		});
	});

	describe('recordSuccess() / recordError()', () => {
		beforeEach(() => {
			(relayManager as any)._health.set('wss://test.relay', {
				url: 'wss://test.relay',
				connected: false,
				latency: null,
				lastConnected: null,
				lastError: null,
				errorCount: 0,
				successCount: 0,
				score: 50
			});
		});

		it('should record success', () => {
			relayManager.recordSuccess('wss://test.relay');

			const health = relayManager.getHealth('wss://test.relay');
			expect(health?.connected).toBe(true);
			expect(health?.successCount).toBe(1);
			expect(health?.lastConnected).toBeDefined();
		});

		it('should record error', () => {
			relayManager.recordError('wss://test.relay', 'Connection refused');

			const health = relayManager.getHealth('wss://test.relay');
			expect(health?.errorCount).toBe(1);
			expect(health?.lastError).toBe('Connection refused');
		});

		it('should update score after success', () => {
			const initialScore = relayManager.getHealth('wss://test.relay')?.score;

			relayManager.recordSuccess('wss://test.relay');

			const newScore = relayManager.getHealth('wss://test.relay')?.score;
			expect(newScore).toBeGreaterThan(initialScore!);
		});
	});

	describe('Event listeners', () => {
		it('should add and call listeners', () => {
			const listener = vi.fn();

			relayManager.addListener(listener);
			relayManager.blacklistRelay('wss://test.relay');

			expect(listener).toHaveBeenCalledWith({
				type: 'blacklisted',
				url: 'wss://test.relay',
				expiry: expect.any(Number)
			});
		});

		it('should remove listener when unsubscribe called', () => {
			const listener = vi.fn();

			const unsubscribe = relayManager.addListener(listener);
			unsubscribe();

			relayManager.blacklistRelay('wss://test.relay');

			expect(listener).not.toHaveBeenCalled();
		});

		it('should emit unblacklist event', () => {
			const listener = vi.fn();

			relayManager.addListener(listener);
			relayManager.blacklistRelay('wss://test.relay');
			relayManager.unblacklistRelay('wss://test.relay');

			expect(listener).toHaveBeenCalledWith({
				type: 'unblacklisted',
				url: 'wss://test.relay'
			});
		});

		it('should handle listener errors gracefully', () => {
			const badListener = vi.fn().mockImplementation(() => {
				throw new Error('Listener error');
			});
			const goodListener = vi.fn();

			relayManager.addListener(badListener);
			relayManager.addListener(goodListener);

			// Should not throw
			expect(() => relayManager.blacklistRelay('wss://test.relay')).not.toThrow();

			// Good listener should still be called
			expect(goodListener).toHaveBeenCalled();
		});
	});

	describe('cleanStaleRelays()', () => {
		it('should keep default relays', async () => {
			mockDb.relays.toArray.mockResolvedValue([
				{ url: DEFAULT_RELAYS[0] },
				{ url: 'wss://custom.relay' }
			]);

			const removed = await relayManager.cleanStaleRelays();

			// Custom relay should be removed (no health data)
			expect(removed).toBeGreaterThanOrEqual(1);
			expect(mockDb.relays.delete).toHaveBeenCalledWith('wss://custom.relay');
		});

		it('should keep recently connected relays', async () => {
			mockDb.relays.toArray.mockResolvedValue([
				{ url: 'wss://active.relay' }
			]);

			// Set up recent health data
			(relayManager as any)._health.set('wss://active.relay', {
				url: 'wss://active.relay',
				lastConnected: Date.now()
			});

			const removed = await relayManager.cleanStaleRelays();

			expect(removed).toBe(0);
			expect(mockDb.relays.delete).not.toHaveBeenCalledWith('wss://active.relay');
		});

		it('should remove old relays', async () => {
			mockDb.relays.toArray.mockResolvedValue([
				{ url: 'wss://stale.relay' }
			]);

			// Set up old health data
			const oldTime = Date.now() - 10 * 24 * 60 * 60 * 1000; // 10 days ago
			(relayManager as any)._health.set('wss://stale.relay', {
				url: 'wss://stale.relay',
				lastConnected: oldTime
			});

			const removed = await relayManager.cleanStaleRelays(7 * 24 * 60 * 60 * 1000); // 7 day max age

			expect(removed).toBe(1);
			expect(mockDb.relays.delete).toHaveBeenCalledWith('wss://stale.relay');
		});
	});
});
