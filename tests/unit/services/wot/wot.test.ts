import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock functions
const { mockFetchEvents } = vi.hoisted(() => ({
	mockFetchEvents: vi.fn()
}));

// Mock NDK service
vi.mock('$services/ndk', () => ({
	default: {
		ndk: {
			fetchEvents: mockFetchEvents
		}
	}
}));

// Mock db helpers
vi.mock('$db', () => ({
	dbHelpers: {}
}));

// Import after mocks
import { wotService, type TrustLevel, type WoTResult } from '$lib/services/wot';

describe('WoT Service', () => {
	const myPubkey = 'mypubkey123';
	const friendPubkey = 'friend456';
	const friendOfFriendPubkey = 'fof789';
	const unknownPubkey = 'unknown000';
	const mutedPubkey = 'muted111';

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset the service state by accessing private properties via any
		(wotService as any).myPubkey = null;
		(wotService as any).myFollows = new Set();
		(wotService as any).myMuted = new Set();
		(wotService as any).graph = new Map();
		(wotService as any).trustCache = new Map();
		(wotService as any).initialized = false;
	});

	describe('Trust Level Calculation', () => {
		beforeEach(async () => {
			// Mock contact list fetch (kind:3)
			mockFetchEvents.mockImplementation(async (filter: any) => {
				if (filter.kinds?.[0] === 3 && filter.authors?.[0] === myPubkey) {
					// My contact list
					return new Set([{
						pubkey: myPubkey,
						tags: [
							['p', friendPubkey]
						]
					}]);
				}
				if (filter.kinds?.[0] === 10000) {
					// My mute list
					return new Set([{
						pubkey: myPubkey,
						tags: [
							['p', mutedPubkey]
						]
					}]);
				}
				if (filter.kinds?.[0] === 3 && filter.authors?.includes(friendPubkey)) {
					// Friend's contact list
					return new Set([{
						pubkey: friendPubkey,
						tags: [
							['p', friendOfFriendPubkey],
							['p', myPubkey]
						]
					}]);
				}
				return new Set();
			});

			await wotService.init(myPubkey);
		});

		it('should return "self" trust level for own pubkey', () => {
			const result = wotService.getTrust(myPubkey);
			
			expect(result.level).toBe('self');
			expect(result.score).toBe(100);
			expect(result.isMuted).toBe(false);
		});

		it('should return "trusted" for direct follows', () => {
			const result = wotService.getTrust(friendPubkey);
			
			expect(result.level).toBe('trusted');
			expect(result.score).toBe(90);
			expect(result.isMuted).toBe(false);
		});

		it('should return "friend-of-friend" for second-degree connections', () => {
			const result = wotService.getTrust(friendOfFriendPubkey);
			
			expect(result.level).toBe('friend-of-friend');
			expect(result.score).toBeGreaterThanOrEqual(50);
			expect(result.score).toBeLessThanOrEqual(70);
			expect(result.isMuted).toBe(false);
		});

		it('should return "muted" for muted users', () => {
			const result = wotService.getTrust(mutedPubkey);
			
			expect(result.level).toBe('muted');
			expect(result.score).toBe(0);
			expect(result.isMuted).toBe(true);
		});

		it('should return "unknown" for users not in the graph', () => {
			const result = wotService.getTrust(unknownPubkey);
			
			expect(result.level).toBe('unknown');
			expect(result.score).toBe(0);
			expect(result.isMuted).toBe(false);
		});
	});

	describe('Trust Level Helpers', () => {
		beforeEach(async () => {
			mockFetchEvents.mockImplementation(async (filter: any) => {
				if (filter.kinds?.[0] === 3) {
					return new Set([{
						pubkey: myPubkey,
						tags: [['p', friendPubkey]]
					}]);
				}
				if (filter.kinds?.[0] === 10000) {
					return new Set(); // Empty mute list
				}
				return new Set();
			});
			await wotService.init(myPubkey);
		});

		it('getTrustLevel should return the level string', () => {
			expect(wotService.getTrustLevel(myPubkey)).toBe('self');
			expect(wotService.getTrustLevel(friendPubkey)).toBe('trusted');
		});

		it('getTrustScore should return numeric score', () => {
			expect(wotService.getTrustScore(myPubkey)).toBe(100);
			expect(wotService.getTrustScore(friendPubkey)).toBe(90);
		});

		it('isTrusted should return true for trusted levels', () => {
			expect(wotService.isTrusted(myPubkey)).toBe(true);
			expect(wotService.isTrusted(friendPubkey)).toBe(true);
			expect(wotService.isTrusted(unknownPubkey)).toBe(false);
		});
	});

	describe('Trust Colors', () => {
		beforeEach(async () => {
			mockFetchEvents.mockImplementation(async (filter: any) => {
				if (filter.kinds?.[0] === 3) {
					return new Set([{
						pubkey: myPubkey,
						tags: [['p', friendPubkey]]
					}]);
				}
				if (filter.kinds?.[0] === 10000) {
					return new Set([{
						pubkey: myPubkey,
						tags: [['p', mutedPubkey]]
					}]);
				}
				return new Set();
			});
			await wotService.init(myPubkey);
		});

		it('should return correct colors for trust levels', () => {
			expect(wotService.getTrustColor(myPubkey)).toBe('text-primary');
			expect(wotService.getTrustColor(friendPubkey)).toBe('text-green-500');
			expect(wotService.getTrustColor(mutedPubkey)).toBe('text-red-500');
			expect(wotService.getTrustColor(unknownPubkey)).toBe('text-muted-foreground');
		});
	});

	describe('Mute/Unmute', () => {
		beforeEach(async () => {
			mockFetchEvents.mockResolvedValue(new Set());
			await wotService.init(myPubkey);
		});

		it('should add user to mute list', async () => {
			const testPubkey = 'testuser123';
			
			expect(wotService.isMuted(testPubkey)).toBe(false);
			
			await wotService.mute(testPubkey);
			
			expect(wotService.isMuted(testPubkey)).toBe(true);
		});

		it('should remove user from mute list', async () => {
			const testPubkey = 'testuser123';
			
			await wotService.mute(testPubkey);
			expect(wotService.isMuted(testPubkey)).toBe(true);
			
			await wotService.unmute(testPubkey);
			expect(wotService.isMuted(testPubkey)).toBe(false);
		});
	});

	describe('Statistics', () => {
		beforeEach(async () => {
			mockFetchEvents.mockImplementation(async (filter: any) => {
				if (filter.kinds?.[0] === 3 && filter.authors?.[0] === myPubkey) {
					return new Set([{
						pubkey: myPubkey,
						tags: [
							['p', 'friend1'],
							['p', 'friend2'],
							['p', 'friend3']
						]
					}]);
				}
				if (filter.kinds?.[0] === 10000) {
					return new Set([{
						pubkey: myPubkey,
						tags: [['p', 'muted1']]
					}]);
				}
				return new Set();
			});
			await wotService.init(myPubkey);
		});

		it('should return correct statistics', () => {
			const stats = wotService.getStats();
			
			expect(stats.followsCount).toBe(3);
			expect(stats.mutedCount).toBe(1);
			expect(stats.graphSize).toBeGreaterThan(0);
		});
	});

	describe('Cache Management', () => {
		beforeEach(async () => {
			mockFetchEvents.mockResolvedValue(new Set([{
				pubkey: myPubkey,
				tags: [['p', friendPubkey]]
			}]));
			await wotService.init(myPubkey);
		});

		it('should cache trust calculations', () => {
			// First call
			const result1 = wotService.getTrust(friendPubkey);
			// Second call should use cache
			const result2 = wotService.getTrust(friendPubkey);
			
			expect(result1).toEqual(result2);
		});

		it('should clear cache', () => {
			wotService.getTrust(friendPubkey);
			const statsBefore = wotService.getStats();
			
			wotService.clearCache();
			const statsAfter = wotService.getStats();
			
			expect(statsAfter.cacheSize).toBe(0);
		});
	});

	describe('Without Initialization', () => {
		it('should return unknown for any pubkey if not initialized', () => {
			const result = wotService.getTrust('anypubkey');
			
			expect(result.level).toBe('unknown');
			expect(result.score).toBe(0);
		});
	});
});
