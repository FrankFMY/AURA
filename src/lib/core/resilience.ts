/**
 * Resilience Utilities
 * 
 * Provides retry logic, circuit breaker, and connection management patterns.
 */

/** Retry configuration */
export interface RetryConfig {
	/** Maximum number of retries */
	maxRetries: number;
	/** Initial delay in milliseconds */
	initialDelay: number;
	/** Maximum delay in milliseconds */
	maxDelay: number;
	/** Backoff multiplier */
	backoffMultiplier: number;
	/** Add jitter to delay */
	jitter: boolean;
	/** Retry condition function */
	shouldRetry?: (error: unknown, attempt: number) => boolean;
}

/** Default retry configuration */
const DEFAULT_RETRY_CONFIG: RetryConfig = {
	maxRetries: 3,
	initialDelay: 1000,
	maxDelay: 30000,
	backoffMultiplier: 2,
	jitter: true
};

/**
 * Retry a function with exponential backoff
 */
export async function retry<T>(
	fn: () => Promise<T>,
	config: Partial<RetryConfig> = {}
): Promise<T> {
	const cfg = { ...DEFAULT_RETRY_CONFIG, ...config };
	let lastError: unknown;

	for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			// Check if we should retry
			if (cfg.shouldRetry && !cfg.shouldRetry(error, attempt)) {
				throw error;
			}

			// Don't wait after last attempt
			if (attempt === cfg.maxRetries) {
				break;
			}

			// Calculate delay with exponential backoff
			let delay = cfg.initialDelay * Math.pow(cfg.backoffMultiplier, attempt);
			delay = Math.min(delay, cfg.maxDelay);

			// Add jitter
			if (cfg.jitter) {
				delay = delay * (0.5 + Math.random() * 0.5);
			}

			await sleep(delay);
		}
	}

	throw lastError;
}

/** Circuit breaker state */
export type CircuitState = 'closed' | 'open' | 'half-open';

/** Circuit breaker configuration */
export interface CircuitBreakerConfig {
	/** Number of failures before opening circuit */
	failureThreshold: number;
	/** Time in ms before attempting to close circuit */
	resetTimeout: number;
	/** Number of successful calls in half-open state to close circuit */
	successThreshold: number;
}

/** Default circuit breaker configuration */
const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
	failureThreshold: 5,
	resetTimeout: 30000,
	successThreshold: 2
};

/**
 * Circuit Breaker Pattern Implementation
 */
export class CircuitBreaker {
	private state: CircuitState = 'closed';
	private failures = 0;
	private successes = 0;
	private lastFailure: number | null = null;
	private readonly config: CircuitBreakerConfig;

	constructor(config: Partial<CircuitBreakerConfig> = {}) {
		this.config = { ...DEFAULT_CIRCUIT_CONFIG, ...config };
	}

	/** Get current state */
	getState(): CircuitState {
		this.checkReset();
		return this.state;
	}

	/** Check if circuit allows requests */
	isAllowed(): boolean {
		this.checkReset();
		return this.state !== 'open';
	}

	/** Record a successful call */
	recordSuccess(): void {
		if (this.state === 'half-open') {
			this.successes++;
			if (this.successes >= this.config.successThreshold) {
				this.close();
			}
		} else if (this.state === 'closed') {
			this.failures = 0;
		}
	}

	/** Record a failed call */
	recordFailure(): void {
		this.failures++;
		this.lastFailure = Date.now();

		if (this.state === 'half-open' || this.failures >= this.config.failureThreshold) {
			this.open();
		}
	}

	/** Execute a function with circuit breaker protection */
	async execute<T>(fn: () => Promise<T>): Promise<T> {
		if (!this.isAllowed()) {
			throw new Error('Circuit breaker is open');
		}

		try {
			const result = await fn();
			this.recordSuccess();
			return result;
		} catch (error) {
			this.recordFailure();
			throw error;
		}
	}

	/** Reset the circuit breaker */
	reset(): void {
		this.close();
	}

	private open(): void {
		this.state = 'open';
		this.successes = 0;
	}

	private close(): void {
		this.state = 'closed';
		this.failures = 0;
		this.successes = 0;
		this.lastFailure = null;
	}

	private checkReset(): void {
		if (
			this.state === 'open' &&
			this.lastFailure &&
			Date.now() - this.lastFailure >= this.config.resetTimeout
		) {
			this.state = 'half-open';
			this.successes = 0;
		}
	}
}

/** Request deduplication cache */
export class RequestDeduplicator<T> {
	private readonly pending = new Map<string, Promise<T>>();
	private readonly cache = new Map<string, { value: T; timestamp: number }>();
	private readonly ttl: number;

	constructor(ttlMs: number = 5000) {
		this.ttl = ttlMs;
	}

	/**
	 * Execute a request with deduplication
	 */
	async execute(key: string, fn: () => Promise<T>): Promise<T> {
		// Check cache
		const cached = this.cache.get(key);
		if (cached && Date.now() - cached.timestamp < this.ttl) {
			return cached.value;
		}

		// Check if request is already pending
		const pending = this.pending.get(key);
		if (pending) {
			return pending;
		}

		// Execute request
		const promise = fn()
			.then((result) => {
				this.cache.set(key, { value: result, timestamp: Date.now() });
				return result;
			})
			.finally(() => {
				this.pending.delete(key);
			});

		this.pending.set(key, promise);
		return promise;
	}

	/** Clear cache */
	clear(): void {
		this.pending.clear();
		this.cache.clear();
	}

	/** Invalidate a specific key */
	invalidate(key: string): void {
		this.cache.delete(key);
	}
}

/** Timeout wrapper */
export function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	message: string = 'Operation timed out'
): Promise<T> {
	return Promise.race([
		promise,
		new Promise<T>((_, reject) =>
			setTimeout(() => reject(new Error(message)), timeoutMs)
		)
	]);
}

/** Sleep utility */
export function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Debounce function */
export function debounce<T extends (...args: unknown[]) => unknown>(
	fn: T,
	delayMs: number
): (...args: Parameters<T>) => void {
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	return (...args: Parameters<T>) => {
		if (timeoutId) {
			clearTimeout(timeoutId);
		}
		timeoutId = setTimeout(() => {
			fn(...args);
			timeoutId = null;
		}, delayMs);
	};
}

/** Throttle function */
export function throttle<T extends (...args: unknown[]) => unknown>(
	fn: T,
	limitMs: number
): (...args: Parameters<T>) => void {
	let lastCall = 0;
	let timeoutId: ReturnType<typeof setTimeout> | null = null;

	return (...args: Parameters<T>) => {
		const now = Date.now();
		const remaining = limitMs - (now - lastCall);

		if (remaining <= 0) {
			if (timeoutId) {
				clearTimeout(timeoutId);
				timeoutId = null;
			}
			lastCall = now;
			fn(...args);
		} else if (!timeoutId) {
			timeoutId = setTimeout(() => {
				lastCall = Date.now();
				timeoutId = null;
				fn(...args);
			}, remaining);
		}
	};
}

export default {
	retry,
	CircuitBreaker,
	RequestDeduplicator,
	withTimeout,
	sleep,
	debounce,
	throttle
};
