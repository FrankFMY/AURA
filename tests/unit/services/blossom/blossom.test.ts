import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock functions
const { mockSign, mockPublish, MockNDKEvent } = vi.hoisted(() => {
	const mockSign = vi.fn().mockResolvedValue(undefined);
	const mockPublish = vi.fn().mockResolvedValue(undefined);
	
	class MockNDKEvent {
		kind = 0;
		created_at = 0;
		content = '';
		tags: string[][] = [];
		sign = mockSign;
		publish = mockPublish;
		
		constructor(_ndk?: any) {}
		
		rawEvent() {
			return {
				id: 'test-id',
				pubkey: 'testpubkey123',
				created_at: Math.floor(Date.now() / 1000),
				kind: 24242,
				tags: this.tags,
				content: this.content,
				sig: 'testsig'
			};
		}
	}
	
	return { mockSign, mockPublish, MockNDKEvent };
});

// Mock auth store
vi.mock('$stores/auth.svelte', () => ({
	authStore: {
		pubkey: 'testpubkey123'
	}
}));

// Mock NDK service
vi.mock('$services/ndk', () => ({
	default: {
		ndk: {}
	}
}));

// Mock NDKEvent
vi.mock('@nostr-dev-kit/ndk', () => ({
	NDKEvent: MockNDKEvent
}));

// Import after mocks
import { blossomService, type BlossomServer, type UploadResult } from '$lib/services/blossom';

describe('Blossom Service', () => {
	const defaultServers = [
		{ url: 'https://blossom.primal.net', name: 'Primal' },
		{ url: 'https://media.nostr.band', name: 'Nostr.band' },
		{ url: 'https://nostr.build', name: 'Nostr.build' }
	];

	beforeEach(() => {
		vi.clearAllMocks();
		// Reset service state
		(blossomService as any).servers = [...defaultServers];
		(blossomService as any).preferredServer = null;
	});

	describe('Server Management', () => {
		it('should return default servers', () => {
			const servers = blossomService.getServers();
			expect(servers.length).toBe(3);
			expect(servers[0].url).toBe('https://blossom.primal.net');
		});

		it('should add a new server', () => {
			const newServer: BlossomServer = {
				url: 'https://custom.server.com',
				name: 'Custom'
			};

			blossomService.addServer(newServer);

			const servers = blossomService.getServers();
			expect(servers.length).toBe(4);
			expect(servers.find(s => s.url === newServer.url)).toBeDefined();
		});

		it('should not add duplicate servers', () => {
			const existingServer: BlossomServer = {
				url: 'https://blossom.primal.net',
				name: 'Duplicate'
			};

			blossomService.addServer(existingServer);

			const servers = blossomService.getServers();
			expect(servers.length).toBe(3);
		});

		it('should remove a server', () => {
			blossomService.removeServer('https://blossom.primal.net');

			const servers = blossomService.getServers();
			expect(servers.length).toBe(2);
			expect(servers.find(s => s.url === 'https://blossom.primal.net')).toBeUndefined();
		});

		it('should set preferred server', () => {
			const customUrl = 'https://custom.server.com';
			blossomService.setPreferredServer(customUrl);

			expect((blossomService as any).preferredServer).toBe(customUrl);
		});

		it('should clear preferred server', () => {
			blossomService.setPreferredServer('https://test.com');
			blossomService.setPreferredServer(null);

			expect((blossomService as any).preferredServer).toBeNull();
		});
	});

	describe('Blob URL Generation', () => {
		it('should generate blob URL with default server', () => {
			const sha256 = 'abc123def456';
			const url = blossomService.getBlobUrl(sha256);

			expect(url).toBe('https://blossom.primal.net/abc123def456');
		});

		it('should generate blob URL with specific server', () => {
			const sha256 = 'abc123def456';
			const url = blossomService.getBlobUrl(sha256, 'https://custom.server.com');

			expect(url).toBe('https://custom.server.com/abc123def456');
		});

		it('should use preferred server for blob URL', () => {
			const sha256 = 'abc123def456';
			blossomService.setPreferredServer('https://preferred.server.com');

			const url = blossomService.getBlobUrl(sha256);

			expect(url).toBe('https://preferred.server.com/abc123def456');
		});
	});

	describe('Blob Existence Check', () => {
		it('should return true when blob exists', async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true
			});

			const exists = await blossomService.exists('abc123');

			expect(exists).toBe(true);
			expect(fetch).toHaveBeenCalledWith(
				'https://blossom.primal.net/abc123',
				{ method: 'HEAD' }
			);
		});

		it('should return false when blob does not exist', async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false
			});

			const exists = await blossomService.exists('nonexistent');

			expect(exists).toBe(false);
		});

		it('should return false on network error', async () => {
			global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

			const exists = await blossomService.exists('abc123');

			expect(exists).toBe(false);
		});
	});

	describe('Delete Operations', () => {
		it('should return true on successful delete', async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: true
			});

			const success = await blossomService.delete('abc123');

			expect(success).toBe(true);
			expect(fetch).toHaveBeenCalledWith(
				'https://blossom.primal.net/abc123',
				expect.objectContaining({
					method: 'DELETE',
					headers: expect.objectContaining({
						'Authorization': expect.stringMatching(/^Nostr /)
					})
				})
			);
		});

		it('should return false on failed delete', async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false
			});

			const success = await blossomService.delete('abc123');

			expect(success).toBe(false);
		});

		it('should return false on network error during delete', async () => {
			global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

			const success = await blossomService.delete('abc123');

			expect(success).toBe(false);
		});
	});

	describe('List Uploads', () => {
		it('should fetch user uploads', async () => {
			const mockBlobs = [
				{ sha256: 'abc123', url: 'https://test.com/abc123', size: 1000, type: 'image/png', uploaded: 12345 },
				{ sha256: 'def456', url: 'https://test.com/def456', size: 2000, type: 'image/jpeg', uploaded: 12346 }
			];

			global.fetch = vi.fn().mockResolvedValue({
				ok: true,
				json: () => Promise.resolve(mockBlobs)
			});

			const blobs = await blossomService.listUploads();

			expect(blobs).toEqual(mockBlobs);
		});

		it('should return empty array on error', async () => {
			global.fetch = vi.fn().mockResolvedValue({
				ok: false,
				status: 500
			});

			const blobs = await blossomService.listUploads();

			expect(blobs).toEqual([]);
		});
	});

	describe('Image Dimensions', () => {
		it('should return null for non-image files', async () => {
			const file = new File(['test'], 'test.txt', { type: 'text/plain' });

			const dimensions = await blossomService.getImageDimensions(file);

			expect(dimensions).toBeNull();
		});
	});

	describe('Server URL Selection', () => {
		it('should use first server when no preferred server', () => {
			const url = (blossomService as any).getUploadServer();
			expect(url).toBe('https://blossom.primal.net');
		});

		it('should use preferred server when set', () => {
			blossomService.setPreferredServer('https://preferred.com');
			const url = (blossomService as any).getUploadServer();
			expect(url).toBe('https://preferred.com');
		});
	});
});
