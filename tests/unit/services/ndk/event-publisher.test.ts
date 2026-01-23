import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { EventPublisher, type PublisherConfig } from '$lib/services/ndk/event-publisher';
import type NDK from '@nostr-dev-kit/ndk';
import { NDKEvent, type NDKSigner, type NDKRelay } from '@nostr-dev-kit/ndk';
import { ErrorCode } from '$lib/core/errors';

// Mock dependencies
vi.mock('$db', () => ({
	dbHelpers: {
		saveEvent: vi.fn(),
		getOutboxEvents: vi.fn(),
		removeFromOutbox: vi.fn(),
		updateOutboxEvent: vi.fn()
	}
}));

// Mock NDKEvent to control its behavior
vi.mock('@nostr-dev-kit/ndk', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@nostr-dev-kit/ndk')>();
	const NDKEventMock = vi.fn();
	NDKEventMock.prototype.sign = vi.fn().mockResolvedValue(undefined);
	NDKEventMock.prototype.publish = vi.fn().mockResolvedValue(new Set([{ url: 'wss://mock.relay' }]));

	return {
		...actual,
		NDKEvent: NDKEventMock
	};
});

describe('EventPublisher', () => {
	let publisher: EventPublisher;
	let mockNdk: NDK;
	let mockSigner: NDKSigner;
	let mockEvent: NDKEvent;

	beforeEach(() => {
		vi.useFakeTimers();
		publisher = new EventPublisher({ retryDelay: 100 });
		mockNdk = {} as NDK;
		mockSigner = {} as NDKSigner;
		mockEvent = new NDKEvent(mockNdk, {
			id: 'test-event-id',
			kind: 1,
			content: 'hello'
		});

		publisher.setNDK(mockNdk);
		publisher.setSigner(mockSigner);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it('should throw an error if NDK is not set', async () => {
		publisher.setNDK(null as any);
		await expect(publisher.publish(mockEvent)).rejects.toThrow('NDK not initialized');
	});

	it('should throw an error if signer is not set', async () => {
		publisher.setSigner(null);
		await expect(publisher.publish(mockEvent)).rejects.toThrow('No signer available');
	});

	it('should sign the event if it is not already signed', async () => {
		mockEvent.sig = undefined;
		await publisher.publish(mockEvent);
		expect(mockEvent.sign).toHaveBeenCalledWith(mockSigner);
	});

	it('should successfully publish an event and remove it from the queue', async () => {
		const onSuccess = vi.fn();
		const promise = publisher.publish(mockEvent, { onSuccess });

		// Allow all timers and microtasks to complete
		await vi.runAllTimersAsync();

		const result = await promise;
		expect(result.size).toBe(1);

		// Check final status
		const status = publisher.getQueueStatus();
		expect(status.pending).toBe(0);
		expect(status.publishing).toBe(0);
		expect(onSuccess).toHaveBeenCalled();
	});

	it('should handle publish failure and retry', async () => {
		const onError = vi.fn();
		const maxRetries = 2;

		// Fail first, then succeed
		(mockEvent.publish as Mock)
			.mockRejectedValueOnce(new Error('Relay error'))
			.mockResolvedValueOnce(new Set([{ url: 'wss://mock.relay' }]));

		const promise = publisher.publish(mockEvent, { onError, maxRetries });

		// Run all timers to process initial attempt and the subsequent retry
		await vi.runAllTimersAsync();

		// Wait for the promise to resolve
		await expect(promise).resolves.toBeTruthy();

		// Verify behavior
		expect(mockEvent.publish).toHaveBeenCalledTimes(2);
		expect(onError).not.toHaveBeenCalled();

		const status = publisher.getQueueStatus();
		expect(status.pending).toBe(0);
		expect(status.failed).toBe(0);
	});

	it('should move event to "failed" status after max retries', async () => {
		const onError = vi.fn();
		const maxRetries = 2;

		(mockEvent.publish as Mock).mockRejectedValue(new Error('Persistent error'));

		const promise = publisher.publish(mockEvent, { onError, maxRetries });

		// Attach a no-op catch to prevent unhandled rejection warnings in the test runner.
		// The `await expect().rejects` will still correctly catch and assert the rejection.
		promise.catch(() => {});

		// Let the entire loop of retries and failures complete
		await vi.runAllTimersAsync();

		// Assert the final state
		await expect(promise).rejects.toThrow('Persistent error');

		expect(onError).toHaveBeenCalled();
		// It will be called once for the initial attempt, and once for the single retry allowed by maxRetries=2
		// attempt 1 (retries: 0) -> fail, retries becomes 1. 1 < 2 is true.
		// attempt 2 (retries: 1) -> fail, retries becomes 2. 2 >= 2 is true. -> permanent fail.
		expect(mockEvent.publish).toHaveBeenCalledTimes(2);

		const status = publisher.getQueueStatus();
		expect(status.failed).toBe(1);
	});
});
