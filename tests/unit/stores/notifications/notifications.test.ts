/**
 * Notifications Store Tests
 *
 * Tests for toast notifications management.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock ErrorHandler
const mockErrorHandler = vi.hoisted(() => ({
	addListener: vi.fn().mockReturnValue(vi.fn())
}));

vi.mock('$lib/core/errors', () => ({
	ErrorHandler: mockErrorHandler,
	ErrorCode: {}
}));

// Import after mocks
import { notificationsStore, type Toast } from '$stores/notifications.svelte';
import type { AuraError } from '$lib/core/errors';

describe('Notifications Store', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		notificationsStore.clearAll();
	});

	afterEach(() => {
		notificationsStore.clearAll();
		vi.useRealTimers();
	});

	describe('Initial state', () => {
		it('should have empty toasts array initially', () => {
			expect(notificationsStore.toasts).toEqual([]);
		});
	});

	describe('addToast()', () => {
		it('should add a toast', () => {
			const id = notificationsStore.addToast({
				title: 'Test Toast'
			});

			expect(id).toMatch(/^toast-/);
			expect(notificationsStore.toasts).toHaveLength(1);
			expect(notificationsStore.toasts[0].title).toBe('Test Toast');
		});

		it('should default to info type', () => {
			notificationsStore.addToast({ title: 'Test' });

			expect(notificationsStore.toasts[0].type).toBe('info');
		});

		it('should set custom type', () => {
			notificationsStore.addToast({ title: 'Error', type: 'error' });

			expect(notificationsStore.toasts[0].type).toBe('error');
		});

		it('should set default duration based on type', () => {
			notificationsStore.addToast({ title: 'Info', type: 'info' });
			expect(notificationsStore.toasts[0].duration).toBe(5000);

			notificationsStore.addToast({ title: 'Success', type: 'success' });
			expect(notificationsStore.toasts[1].duration).toBe(4000);

			notificationsStore.addToast({ title: 'Warning', type: 'warning' });
			expect(notificationsStore.toasts[2].duration).toBe(6000);

			notificationsStore.addToast({ title: 'Error', type: 'error' });
			expect(notificationsStore.toasts[3].duration).toBe(8000);
		});

		it('should allow custom duration', () => {
			notificationsStore.addToast({
				title: 'Custom',
				duration: 10000
			});

			expect(notificationsStore.toasts[0].duration).toBe(10000);
		});

		it('should default dismissible to true', () => {
			notificationsStore.addToast({ title: 'Test' });

			expect(notificationsStore.toasts[0].dismissible).toBe(true);
		});

		it('should allow setting dismissible to false', () => {
			notificationsStore.addToast({
				title: 'Test',
				dismissible: false
			});

			expect(notificationsStore.toasts[0].dismissible).toBe(false);
		});

		it('should include message', () => {
			notificationsStore.addToast({
				title: 'Title',
				message: 'Message body'
			});

			expect(notificationsStore.toasts[0].message).toBe('Message body');
		});

		it('should include action', () => {
			const onClick = vi.fn();
			notificationsStore.addToast({
				title: 'Test',
				action: { label: 'Click me', onClick }
			});

			expect(notificationsStore.toasts[0].action?.label).toBe('Click me');
			notificationsStore.toasts[0].action?.onClick();
			expect(onClick).toHaveBeenCalled();
		});

		it('should set createdAt timestamp', () => {
			const now = Date.now();
			vi.setSystemTime(now);

			notificationsStore.addToast({ title: 'Test' });

			expect(notificationsStore.toasts[0].createdAt).toBe(now);
		});

		it('should auto-dismiss after duration', () => {
			notificationsStore.addToast({
				title: 'Test',
				duration: 3000
			});

			expect(notificationsStore.toasts).toHaveLength(1);

			vi.advanceTimersByTime(3000);

			expect(notificationsStore.toasts).toHaveLength(0);
		});

		it('should not auto-dismiss when duration is 0', () => {
			notificationsStore.addToast({
				title: 'Persistent',
				duration: 0
			});

			vi.advanceTimersByTime(100000);

			expect(notificationsStore.toasts).toHaveLength(1);
		});

		it('should remove oldest toast when at max capacity', () => {
			// Add 5 toasts (max)
			for (let i = 1; i <= 5; i++) {
				notificationsStore.addToast({ title: `Toast ${i}`, duration: 0 });
			}

			expect(notificationsStore.toasts).toHaveLength(5);
			expect(notificationsStore.toasts[0].title).toBe('Toast 1');

			// Add one more
			notificationsStore.addToast({ title: 'Toast 6', duration: 0 });

			expect(notificationsStore.toasts).toHaveLength(5);
			expect(notificationsStore.toasts[0].title).toBe('Toast 2');
			expect(notificationsStore.toasts[4].title).toBe('Toast 6');
		});
	});

	describe('removeToast()', () => {
		it('should remove toast by ID', () => {
			const id = notificationsStore.addToast({ title: 'Test', duration: 0 });

			expect(notificationsStore.toasts).toHaveLength(1);

			notificationsStore.removeToast(id);

			expect(notificationsStore.toasts).toHaveLength(0);
		});

		it('should clear timeout when removed', () => {
			const id = notificationsStore.addToast({
				title: 'Test',
				duration: 10000
			});

			notificationsStore.removeToast(id);

			// Advance time - should not throw or cause issues
			vi.advanceTimersByTime(10000);

			expect(notificationsStore.toasts).toHaveLength(0);
		});

		it('should handle non-existent ID gracefully', () => {
			notificationsStore.addToast({ title: 'Test', duration: 0 });

			expect(() => {
				notificationsStore.removeToast('non-existent-id');
			}).not.toThrow();

			expect(notificationsStore.toasts).toHaveLength(1);
		});
	});

	describe('clearAll()', () => {
		it('should remove all toasts', () => {
			notificationsStore.addToast({ title: 'Toast 1', duration: 0 });
			notificationsStore.addToast({ title: 'Toast 2', duration: 0 });
			notificationsStore.addToast({ title: 'Toast 3', duration: 0 });

			expect(notificationsStore.toasts).toHaveLength(3);

			notificationsStore.clearAll();

			expect(notificationsStore.toasts).toHaveLength(0);
		});

		it('should clear all timeouts', () => {
			notificationsStore.addToast({ title: 'Toast 1', duration: 5000 });
			notificationsStore.addToast({ title: 'Toast 2', duration: 5000 });

			notificationsStore.clearAll();

			// Advance time - should not cause issues
			vi.advanceTimersByTime(5000);

			expect(notificationsStore.toasts).toHaveLength(0);
		});
	});

	describe('Convenience methods', () => {
		describe('info()', () => {
			it('should create info toast', () => {
				notificationsStore.info('Info title');

				expect(notificationsStore.toasts[0].type).toBe('info');
				expect(notificationsStore.toasts[0].title).toBe('Info title');
			});

			it('should include message', () => {
				notificationsStore.info('Title', 'Message');

				expect(notificationsStore.toasts[0].message).toBe('Message');
			});

			it('should accept additional options', () => {
				notificationsStore.info('Title', 'Message', { duration: 1000 });

				expect(notificationsStore.toasts[0].duration).toBe(1000);
			});
		});

		describe('success()', () => {
			it('should create success toast', () => {
				notificationsStore.success('Success!');

				expect(notificationsStore.toasts[0].type).toBe('success');
				expect(notificationsStore.toasts[0].title).toBe('Success!');
			});
		});

		describe('warning()', () => {
			it('should create warning toast', () => {
				notificationsStore.warning('Warning!');

				expect(notificationsStore.toasts[0].type).toBe('warning');
				expect(notificationsStore.toasts[0].title).toBe('Warning!');
			});
		});

		describe('error()', () => {
			it('should create error toast', () => {
				notificationsStore.error('Error!');

				expect(notificationsStore.toasts[0].type).toBe('error');
				expect(notificationsStore.toasts[0].title).toBe('Error!');
			});
		});
	});

	describe('showError()', () => {
		it('should show AuraError as toast', () => {
			const auraError = {
				userMessage: 'Something went wrong',
				severity: 'error',
				recoverable: true
			};

			notificationsStore.showError(auraError as any);

			expect(notificationsStore.toasts[0].type).toBe('error');
			expect(notificationsStore.toasts[0].message).toBe('Something went wrong');
		});

		it('should have infinite duration for critical errors', () => {
			const criticalError = {
				userMessage: 'Critical failure',
				severity: 'critical',
				recoverable: false
			};

			notificationsStore.showError(criticalError as any);

			expect(notificationsStore.toasts[0].duration).toBe(0);
		});

		it('should set dismissible based on recoverable', () => {
			const nonRecoverableError = {
				userMessage: 'Cannot recover',
				severity: 'error',
				recoverable: false
			};

			notificationsStore.showError(nonRecoverableError as any);

			expect(notificationsStore.toasts[0].dismissible).toBe(false);
		});
	});

	describe('promise()', () => {
		it('should show loading toast during promise', async () => {
			let resolvePromise: (value: string) => void;
			const testPromise = new Promise<string>((resolve) => {
				resolvePromise = resolve;
			});

			const resultPromise = notificationsStore.promise(testPromise, {
				loading: 'Loading...',
				success: 'Done!',
				error: 'Failed!'
			});

			expect(notificationsStore.toasts).toHaveLength(1);
			expect(notificationsStore.toasts[0].title).toBe('Loading...');
			expect(notificationsStore.toasts[0].dismissible).toBe(false);

			resolvePromise!('result');
			await resultPromise;
		});

		it('should show success toast on resolve', async () => {
			const testPromise = Promise.resolve('data');

			await notificationsStore.promise(testPromise, {
				loading: 'Loading...',
				success: 'Done!',
				error: 'Failed!'
			});

			// Loading toast removed, success added
			expect(notificationsStore.toasts).toHaveLength(1);
			expect(notificationsStore.toasts[0].title).toBe('Done!');
			expect(notificationsStore.toasts[0].type).toBe('success');
		});

		it('should show error toast on reject', async () => {
			const testPromise = Promise.reject(new Error('fail'));

			await expect(
				notificationsStore.promise(testPromise, {
					loading: 'Loading...',
					success: 'Done!',
					error: 'Failed!'
				})
			).rejects.toThrow('fail');

			expect(notificationsStore.toasts).toHaveLength(1);
			expect(notificationsStore.toasts[0].title).toBe('Failed!');
			expect(notificationsStore.toasts[0].type).toBe('error');
		});

		it('should use function for success message', async () => {
			const testPromise = Promise.resolve({ count: 42 });

			await notificationsStore.promise(testPromise, {
				loading: 'Loading...',
				success: (data) => `Loaded ${data.count} items`,
				error: 'Failed!'
			});

			expect(notificationsStore.toasts[0].title).toBe('Loaded 42 items');
		});

		it('should use function for error message', async () => {
			const testPromise = Promise.reject(new Error('Network timeout'));

			await expect(
				notificationsStore.promise(testPromise, {
					loading: 'Loading...',
					success: 'Done!',
					error: (err: unknown) => `Error: ${(err as Error).message}`
				})
			).rejects.toThrow();

			expect(notificationsStore.toasts[0].title).toBe('Error: Network timeout');
		});

		it('should return promise result', async () => {
			const testPromise = Promise.resolve('result-data');

			const result = await notificationsStore.promise(testPromise, {
				loading: 'Loading...',
				success: 'Done!',
				error: 'Failed!'
			});

			expect(result).toBe('result-data');
		});
	});

	describe('destroy()', () => {
		it('should clear all toasts', () => {
			notificationsStore.addToast({ title: 'Test', duration: 0 });

			notificationsStore.destroy();

			expect(notificationsStore.toasts).toHaveLength(0);
		});
	});

	describe('Edge cases', () => {
		it('should generate unique IDs', () => {
			const id1 = notificationsStore.addToast({ title: 'Toast 1', duration: 0 });
			const id2 = notificationsStore.addToast({ title: 'Toast 2', duration: 0 });
			const id3 = notificationsStore.addToast({ title: 'Toast 3', duration: 0 });

			expect(id1).not.toBe(id2);
			expect(id2).not.toBe(id3);
			expect(id1).not.toBe(id3);
		});

		it('should handle rapid additions and removals', () => {
			for (let i = 0; i < 100; i++) {
				const id = notificationsStore.addToast({
					title: `Toast ${i}`,
					duration: 0
				});
				if (i % 2 === 0) {
					notificationsStore.removeToast(id);
				}
			}

			// Should have ~50 toasts, but capped at MAX_TOASTS (5)
			expect(notificationsStore.toasts.length).toBeLessThanOrEqual(5);
		});

		it('should handle zero duration', () => {
			notificationsStore.addToast({
				title: 'Persistent',
				duration: 0
			});

			vi.advanceTimersByTime(1000000);

			expect(notificationsStore.toasts).toHaveLength(1);
		});
	});
});
