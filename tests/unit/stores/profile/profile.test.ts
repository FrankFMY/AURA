/**
 * Profile Store Tests
 *
 * Tests for user profile management, loading, saving, and caching.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
const mockDbHelpers = vi.hoisted(() => ({
	getProfile: vi.fn(),
	saveProfile: vi.fn()
}));

const mockNdkService = vi.hoisted(() => ({
	fetchProfile: vi.fn(),
	publish: vi.fn().mockResolvedValue(undefined),
	ndk: {},
	signer: { pubkey: 'test-signer' }
}));

const mockAuthStore = vi.hoisted(() => ({
	pubkey: 'test-pubkey-abc123',
	fetchProfile: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('$db', () => ({
	dbHelpers: mockDbHelpers
}));

vi.mock('$services/ndk', () => ({
	default: mockNdkService
}));

vi.mock('$stores/auth.svelte', () => ({
	default: mockAuthStore
}));

vi.mock('@nostr-dev-kit/ndk', () => ({
	NDKEvent: vi.fn().mockImplementation(function(this: any) {
		this.kind = 0;
		this.content = '';
		return this;
	})
}));

// Import after mocks
import { profileStore } from '$stores/profile.svelte';

describe('Profile Store', () => {
	const testProfile = {
		name: 'Test User',
		display_name: 'Testy',
		about: 'Test bio',
		picture: 'https://example.com/pic.jpg',
		banner: 'https://example.com/banner.jpg',
		website: 'https://example.com',
		nip05: 'test@example.com',
		lud16: 'test@getalby.com'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockAuthStore.pubkey = 'test-pubkey-abc123';
		mockNdkService.signer = { pubkey: 'test-signer' };
		profileStore.clear();
	});

	afterEach(() => {
		profileStore.clear();
	});

	describe('Initial state', () => {
		it('should have empty profile initially', () => {
			expect(profileStore.profile).toEqual({});
		});

		it('should not be loading initially', () => {
			expect(profileStore.isLoading).toBe(false);
		});

		it('should not be saving initially', () => {
			expect(profileStore.isSaving).toBe(false);
		});

		it('should have no error initially', () => {
			expect(profileStore.error).toBeNull();
		});

		it('should not be dirty initially', () => {
			expect(profileStore.isDirty).toBe(false);
		});
	});

	describe('load()', () => {
		it('should set error when not authenticated', async () => {
			mockAuthStore.pubkey = null as any;

			await profileStore.load();

			expect(profileStore.error).toBe('Not authenticated');
		});

		it('should load profile from cache', async () => {
			mockDbHelpers.getProfile.mockResolvedValue(testProfile);
			mockNdkService.fetchProfile.mockResolvedValue(null);

			await profileStore.load();

			expect(mockDbHelpers.getProfile).toHaveBeenCalledWith('test-pubkey-abc123');
			expect(profileStore.profile.name).toBe('Test User');
			expect(profileStore.profile.display_name).toBe('Testy');
		});

		it('should fetch fresh profile from relays', async () => {
			mockDbHelpers.getProfile.mockResolvedValue(null);
			mockNdkService.fetchProfile.mockResolvedValue({
				content: JSON.stringify(testProfile)
			});

			await profileStore.load();

			expect(mockNdkService.fetchProfile).toHaveBeenCalledWith('test-pubkey-abc123');
			expect(profileStore.profile.name).toBe('Test User');
		});

		it('should prefer relay data over cache', async () => {
			const cachedProfile = { ...testProfile, name: 'Cached Name' };
			const freshProfile = { ...testProfile, name: 'Fresh Name' };

			mockDbHelpers.getProfile.mockResolvedValue(cachedProfile);
			mockNdkService.fetchProfile.mockResolvedValue({
				content: JSON.stringify(freshProfile)
			});

			await profileStore.load();

			expect(profileStore.profile.name).toBe('Fresh Name');
		});

		it('should handle parse errors gracefully', async () => {
			mockDbHelpers.getProfile.mockResolvedValue(testProfile);
			mockNdkService.fetchProfile.mockResolvedValue({
				content: 'invalid-json'
			});

			await profileStore.load();

			// Should keep cached profile on parse error
			expect(profileStore.profile.name).toBe('Test User');
			expect(profileStore.error).toBeNull();
		});

		it('should handle fetch errors', async () => {
			mockDbHelpers.getProfile.mockResolvedValue(null);
			mockNdkService.fetchProfile.mockRejectedValue(new Error('Network error'));

			await profileStore.load();

			expect(profileStore.error).toBe('Network error');
		});

		it('should reset isDirty after load', async () => {
			mockDbHelpers.getProfile.mockResolvedValue(testProfile);
			mockNdkService.fetchProfile.mockResolvedValue(null);

			// Make it dirty first
			profileStore.updateField('name', 'Changed');
			expect(profileStore.isDirty).toBe(true);

			await profileStore.load();

			expect(profileStore.isDirty).toBe(false);
		});

		it('should set isLoading during operation', async () => {
			let loadingDuringFetch = false;
			mockDbHelpers.getProfile.mockResolvedValue(null);
			mockNdkService.fetchProfile.mockImplementation(async () => {
				loadingDuringFetch = profileStore.isLoading;
				return null;
			});

			await profileStore.load();

			expect(loadingDuringFetch).toBe(true);
			expect(profileStore.isLoading).toBe(false);
		});
	});

	describe('updateField()', () => {
		it('should update a single field', () => {
			profileStore.updateField('name', 'New Name');

			expect(profileStore.profile.name).toBe('New Name');
		});

		it('should preserve other fields', () => {
			profileStore.updateField('name', 'First');
			profileStore.updateField('about', 'Bio');

			expect(profileStore.profile.name).toBe('First');
			expect(profileStore.profile.about).toBe('Bio');
		});

		it('should set isDirty to true', () => {
			expect(profileStore.isDirty).toBe(false);

			profileStore.updateField('name', 'Changed');

			expect(profileStore.isDirty).toBe(true);
		});

		it('should handle all profile fields', () => {
			profileStore.updateField('name', 'Name');
			profileStore.updateField('display_name', 'Display');
			profileStore.updateField('about', 'About');
			profileStore.updateField('picture', 'pic.jpg');
			profileStore.updateField('banner', 'banner.jpg');
			profileStore.updateField('website', 'site.com');
			profileStore.updateField('nip05', 'user@domain.com');
			profileStore.updateField('lud16', 'user@ln.com');

			expect(profileStore.profile).toEqual({
				name: 'Name',
				display_name: 'Display',
				about: 'About',
				picture: 'pic.jpg',
				banner: 'banner.jpg',
				website: 'site.com',
				nip05: 'user@domain.com',
				lud16: 'user@ln.com'
			});
		});
	});

	describe('save()', () => {
		it('should fail when not authenticated', async () => {
			mockAuthStore.pubkey = null as any;

			const result = await profileStore.save();

			expect(result).toBe(false);
			expect(profileStore.error).toBe('Not authenticated');
		});

		it('should fail when no signer', async () => {
			mockNdkService.signer = null as any;

			const result = await profileStore.save();

			expect(result).toBe(false);
			expect(profileStore.error).toBe('No signer available');
		});

		it('should publish kind:0 event', async () => {
			profileStore.updateField('name', 'Test');

			const result = await profileStore.save();

			expect(result).toBe(true);
			expect(mockNdkService.publish).toHaveBeenCalled();
		});

		it('should save to local cache', async () => {
			profileStore.updateField('name', 'Test');

			await profileStore.save();

			expect(mockDbHelpers.saveProfile).toHaveBeenCalledWith(
				expect.objectContaining({
					pubkey: 'test-pubkey-abc123',
					name: 'Test',
					updated_at: expect.any(Number)
				})
			);
		});

		it('should update auth store profile', async () => {
			profileStore.updateField('name', 'Test');

			await profileStore.save();

			expect(mockAuthStore.fetchProfile).toHaveBeenCalled();
		});

		it('should reset isDirty on success', async () => {
			profileStore.updateField('name', 'Test');
			expect(profileStore.isDirty).toBe(true);

			await profileStore.save();

			expect(profileStore.isDirty).toBe(false);
		});

		it('should handle publish errors', async () => {
			mockNdkService.publish.mockRejectedValue(new Error('Publish failed'));
			profileStore.updateField('name', 'Test');

			const result = await profileStore.save();

			expect(result).toBe(false);
			expect(profileStore.error).toBe('Publish failed');
		});

		it('should set isSaving during operation', async () => {
			let savingDuringPublish = false;
			mockNdkService.publish.mockImplementation(async () => {
				savingDuringPublish = profileStore.isSaving;
			});

			profileStore.updateField('name', 'Test');
			await profileStore.save();

			expect(savingDuringPublish).toBe(true);
			expect(profileStore.isSaving).toBe(false);
		});
	});

	describe('reset()', () => {
		it('should reload profile from source', async () => {
			mockDbHelpers.getProfile.mockResolvedValue(testProfile);
			mockNdkService.fetchProfile.mockResolvedValue(null);

			profileStore.updateField('name', 'Changed');
			await profileStore.reset();

			expect(profileStore.profile.name).toBe('Test User');
		});

		it('should clear isDirty', async () => {
			mockDbHelpers.getProfile.mockResolvedValue(null);
			mockNdkService.fetchProfile.mockResolvedValue(null);

			profileStore.updateField('name', 'Changed');
			expect(profileStore.isDirty).toBe(true);

			await profileStore.reset();

			expect(profileStore.isDirty).toBe(false);
		});
	});

	describe('clear()', () => {
		it('should clear profile', () => {
			profileStore.updateField('name', 'Test');

			profileStore.clear();

			expect(profileStore.profile).toEqual({});
		});

		it('should clear isDirty', () => {
			profileStore.updateField('name', 'Test');
			expect(profileStore.isDirty).toBe(true);

			profileStore.clear();

			expect(profileStore.isDirty).toBe(false);
		});

		it('should clear error', async () => {
			mockAuthStore.pubkey = null as any;
			await profileStore.load();
			expect(profileStore.error).not.toBeNull();

			mockAuthStore.pubkey = 'test-pubkey-abc123';
			profileStore.clear();

			expect(profileStore.error).toBeNull();
		});
	});

	describe('Edge cases', () => {
		it('should handle empty profile from relay', async () => {
			mockDbHelpers.getProfile.mockResolvedValue(null);
			mockNdkService.fetchProfile.mockResolvedValue({
				content: '{}'
			});

			await profileStore.load();

			expect(profileStore.profile).toEqual({
				name: undefined,
				display_name: undefined,
				about: undefined,
				picture: undefined,
				banner: undefined,
				website: undefined,
				nip05: undefined,
				lud16: undefined
			});
		});

		it('should handle null event content', async () => {
			mockDbHelpers.getProfile.mockResolvedValue(testProfile);
			mockNdkService.fetchProfile.mockResolvedValue({
				content: null
			});

			await profileStore.load();

			// Should keep cached profile
			expect(profileStore.profile.name).toBe('Test User');
		});

		it('should handle partial profile data', async () => {
			mockDbHelpers.getProfile.mockResolvedValue(null);
			mockNdkService.fetchProfile.mockResolvedValue({
				content: JSON.stringify({ name: 'Only Name' })
			});

			await profileStore.load();

			expect(profileStore.profile.name).toBe('Only Name');
			expect(profileStore.profile.about).toBeUndefined();
		});
	});
});
