import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	retry,
	CircuitBreaker,
	RequestDeduplicator,
	withTimeout,
	sleep,
	debounce,
	throttle
} from '$lib/core/resilience';

describe('retry', () => {
	it('should return result on success', async () => {
		const fn = vi.fn().mockResolvedValue('success');
		const result = await retry(fn);
		expect(result).toBe('success');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should retry on failure', async () => {
		const fn = vi
			.fn()
			.mockRejectedValueOnce(new Error('Fail 1'))
			.mockRejectedValueOnce(new Error('Fail 2'))
			.mockResolvedValue('success');

		const result = await retry(fn, { maxRetries: 3, initialDelay: 10 });
		expect(result).toBe('success');
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('should throw after max retries', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('Always fails'));

		await expect(retry(fn, { maxRetries: 2, initialDelay: 10 })).rejects.toThrow('Always fails');
		expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
	});

	it('should respect shouldRetry condition', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('Non-retryable'));

		await expect(
			retry(fn, {
				maxRetries: 3,
				initialDelay: 10,
				shouldRetry: () => false
			})
		).rejects.toThrow('Non-retryable');
		expect(fn).toHaveBeenCalledTimes(1);
	});
});

describe('CircuitBreaker', () => {
	let breaker: CircuitBreaker;

	beforeEach(() => {
		breaker = new CircuitBreaker({
			failureThreshold: 3,
			resetTimeout: 100,
			successThreshold: 2
		});
	});

	it('should start in closed state', () => {
		expect(breaker.getState()).toBe('closed');
		expect(breaker.isAllowed()).toBe(true);
	});

	it('should open after failure threshold', () => {
		breaker.recordFailure();
		breaker.recordFailure();
		expect(breaker.getState()).toBe('closed');

		breaker.recordFailure();
		expect(breaker.getState()).toBe('open');
		expect(breaker.isAllowed()).toBe(false);
	});

	it('should transition to half-open after reset timeout', async () => {
		breaker.recordFailure();
		breaker.recordFailure();
		breaker.recordFailure();
		expect(breaker.getState()).toBe('open');

		await sleep(150);
		expect(breaker.getState()).toBe('half-open');
	});

	it('should close after success threshold in half-open', async () => {
		breaker.recordFailure();
		breaker.recordFailure();
		breaker.recordFailure();

		await sleep(150);
		expect(breaker.getState()).toBe('half-open');

		breaker.recordSuccess();
		breaker.recordSuccess();
		expect(breaker.getState()).toBe('closed');
	});

	it('should execute function with protection', async () => {
		const fn = vi.fn().mockResolvedValue('success');
		const result = await breaker.execute(fn);
		expect(result).toBe('success');
	});

	it('should throw when circuit is open', async () => {
		breaker.recordFailure();
		breaker.recordFailure();
		breaker.recordFailure();

		await expect(breaker.execute(async () => 'test')).rejects.toThrow('Circuit breaker is open');
	});
});

describe('RequestDeduplicator', () => {
	it('should deduplicate concurrent requests', async () => {
		const deduplicator = new RequestDeduplicator<string>(1000);
		const fn = vi.fn().mockImplementation(async () => {
			await sleep(50);
			return 'result';
		});

		const [result1, result2] = await Promise.all([
			deduplicator.execute('key', fn),
			deduplicator.execute('key', fn)
		]);

		expect(result1).toBe('result');
		expect(result2).toBe('result');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should cache results', async () => {
		const deduplicator = new RequestDeduplicator<string>(1000);
		const fn = vi.fn().mockResolvedValue('result');

		await deduplicator.execute('key', fn);
		await deduplicator.execute('key', fn);

		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('should allow different keys', async () => {
		const deduplicator = new RequestDeduplicator<string>(1000);
		const fn = vi.fn().mockResolvedValue('result');

		await deduplicator.execute('key1', fn);
		await deduplicator.execute('key2', fn);

		expect(fn).toHaveBeenCalledTimes(2);
	});
});

describe('withTimeout', () => {
	it('should return result if within timeout', async () => {
		const result = await withTimeout(Promise.resolve('success'), 1000);
		expect(result).toBe('success');
	});

	it('should throw if timeout exceeded', async () => {
		const slowPromise = new Promise((resolve) => setTimeout(resolve, 1000));
		await expect(withTimeout(slowPromise, 10)).rejects.toThrow('Operation timed out');
	});
});

describe('debounce', () => {
	it('should debounce function calls', async () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 50);

		debounced();
		debounced();
		debounced();

		expect(fn).not.toHaveBeenCalled();

		await sleep(100);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});

describe('throttle', () => {
	it('should throttle function calls with trailing edge', async () => {
		const fn = vi.fn();
		const throttled = throttle(fn, 50);

		// First call executes immediately
		throttled();
		expect(fn).toHaveBeenCalledTimes(1);

		// These calls during throttle period schedule a trailing call
		throttled();
		throttled();
		expect(fn).toHaveBeenCalledTimes(1);

		// Wait for throttle period + buffer for trailing call to execute
		await sleep(70);
		expect(fn).toHaveBeenCalledTimes(2); // Trailing call executed

		// Wait for another full throttle period after trailing call
		await sleep(60);

		// New call after throttle period executes immediately
		throttled();
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('should execute immediately when throttle period has passed', async () => {
		const fn = vi.fn();
		const throttled = throttle(fn, 50);

		throttled();
		expect(fn).toHaveBeenCalledTimes(1);

		// Wait longer than throttle period
		await sleep(100);

		// Should execute immediately
		throttled();
		expect(fn).toHaveBeenCalledTimes(2);
	});
});
