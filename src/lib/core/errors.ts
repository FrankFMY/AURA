/**
 * Custom Error Classes for AURA
 * 
 * Provides structured error handling with error codes,
 * user-friendly messages, and logging capabilities.
 */

/** Error codes for categorization */
export enum ErrorCode {
	// Network errors (1xxx)
	NETWORK_ERROR = 1000,
	RELAY_CONNECTION_FAILED = 1001,
	RELAY_TIMEOUT = 1002,
	RELAY_DISCONNECTED = 1003,
	FETCH_FAILED = 1004,
	WEBSOCKET_ERROR = 1005,

	// Authentication errors (2xxx)
	AUTH_FAILED = 2000,
	INVALID_KEY = 2001,
	NO_EXTENSION = 2002,
	EXTENSION_DENIED = 2003,
	SESSION_EXPIRED = 2004,
	INVALID_SIGNATURE = 2005,

	// Cryptography errors (3xxx)
	CRYPTO_ERROR = 3000,
	ENCRYPTION_FAILED = 3001,
	DECRYPTION_FAILED = 3002,
	KEY_DERIVATION_FAILED = 3003,
	UNSUPPORTED_ALGORITHM = 3004,

	// Wallet errors (4xxx)
	WALLET_ERROR = 4000,
	WALLET_NOT_CONNECTED = 4001,
	INSUFFICIENT_BALANCE = 4002,
	PAYMENT_FAILED = 4003,
	INVALID_INVOICE = 4004,
	NWC_CONNECTION_FAILED = 4005,

	// Validation errors (5xxx)
	VALIDATION_ERROR = 5000,
	INVALID_PUBKEY = 5001,
	INVALID_EVENT = 5002,
	INVALID_CONTENT = 5003,
	CONTENT_TOO_LONG = 5004,

	// Database errors (6xxx)
	DATABASE_ERROR = 6000,
	STORAGE_QUOTA_EXCEEDED = 6001,
	INDEXEDDB_NOT_SUPPORTED = 6002,
	MIGRATION_FAILED = 6003,

	// Generic errors (9xxx)
	UNKNOWN_ERROR = 9000,
	NOT_IMPLEMENTED = 9001,
	OPERATION_CANCELLED = 9002
}

/** Error severity levels */
export type ErrorSeverity = 'info' | 'warning' | 'error' | 'critical';

/** Base error options */
export interface AuraErrorOptions {
	code?: ErrorCode;
	cause?: Error;
	details?: Record<string, unknown>;
	userMessage?: string;
	severity?: ErrorSeverity;
	recoverable?: boolean;
}

/**
 * Base error class for all AURA errors
 */
export class AuraError extends Error {
	readonly code: ErrorCode;
	readonly timestamp: number;
	readonly details: Record<string, unknown>;
	readonly userMessage: string;
	readonly severity: ErrorSeverity;
	readonly recoverable: boolean;

	constructor(message: string, options: AuraErrorOptions = {}) {
		super(message);
		this.name = 'AuraError';
		this.code = options.code || ErrorCode.UNKNOWN_ERROR;
		this.timestamp = Date.now();
		this.details = options.details || {};
		this.userMessage = options.userMessage || this.getDefaultUserMessage();
		this.severity = options.severity || 'error';
		this.recoverable = options.recoverable ?? true;

		// Maintain proper stack trace
		if (options.cause) {
			this.cause = options.cause;
		}

		// Set prototype explicitly for instanceof to work correctly
		Object.setPrototypeOf(this, new.target.prototype);
	}

	private getDefaultUserMessage(): string {
		const messages: Record<number, string> = {
			[ErrorCode.NETWORK_ERROR]: 'Network connection error. Please check your internet connection.',
			[ErrorCode.RELAY_CONNECTION_FAILED]: 'Failed to connect to relay servers. Please try again.',
			[ErrorCode.AUTH_FAILED]: 'Authentication failed. Please try logging in again.',
			[ErrorCode.INVALID_KEY]: 'Invalid key format. Please check your input.',
			[ErrorCode.NO_EXTENSION]: 'No Nostr extension found. Please install a NIP-07 compatible extension.',
			[ErrorCode.SESSION_EXPIRED]: 'Your session has expired. Please log in again.',
			[ErrorCode.WALLET_NOT_CONNECTED]: 'Wallet is not connected. Please connect your wallet first.',
			[ErrorCode.PAYMENT_FAILED]: 'Payment failed. Please try again.',
			[ErrorCode.VALIDATION_ERROR]: 'Invalid input. Please check your data.',
			[ErrorCode.DATABASE_ERROR]: 'Database error. Please refresh the page.',
			[ErrorCode.UNKNOWN_ERROR]: 'An unexpected error occurred. Please try again.'
		};
		return messages[this.code] || messages[ErrorCode.UNKNOWN_ERROR];
	}

	toJSON(): Record<string, unknown> {
		return {
			name: this.name,
			message: this.message,
			code: this.code,
			timestamp: this.timestamp,
			details: this.details,
			userMessage: this.userMessage,
			severity: this.severity,
			recoverable: this.recoverable,
			stack: this.stack
		};
	}
}

/**
 * Network-related errors
 */
export class NetworkError extends AuraError {
	constructor(message: string, options: AuraErrorOptions = {}) {
		super(message, {
			...options,
			code: options.code || ErrorCode.NETWORK_ERROR,
			severity: options.severity || 'error'
		});
		this.name = 'NetworkError';
	}
}

/**
 * Authentication-related errors
 */
export class AuthError extends AuraError {
	constructor(message: string, options: AuraErrorOptions = {}) {
		super(message, {
			...options,
			code: options.code || ErrorCode.AUTH_FAILED,
			severity: options.severity || 'error'
		});
		this.name = 'AuthError';
	}
}

/**
 * Cryptography-related errors
 */
export class CryptoError extends AuraError {
	constructor(message: string, options: AuraErrorOptions = {}) {
		super(message, {
			...options,
			code: options.code || ErrorCode.CRYPTO_ERROR,
			severity: options.severity || 'error'
		});
		this.name = 'CryptoError';
	}
}

/**
 * Wallet-related errors
 */
export class WalletError extends AuraError {
	constructor(message: string, options: AuraErrorOptions = {}) {
		super(message, {
			...options,
			code: options.code || ErrorCode.WALLET_ERROR,
			severity: options.severity || 'error'
		});
		this.name = 'WalletError';
	}
}

/**
 * Validation errors
 */
export class ValidationError extends AuraError {
	readonly field?: string;

	constructor(message: string, field?: string, options: AuraErrorOptions = {}) {
		super(message, {
			...options,
			code: options.code || ErrorCode.VALIDATION_ERROR,
			severity: options.severity || 'warning',
			details: { ...options.details, field }
		});
		this.name = 'ValidationError';
		this.field = field;
	}
}

/**
 * Database errors
 */
export class DatabaseError extends AuraError {
	constructor(message: string, options: AuraErrorOptions = {}) {
		super(message, {
			...options,
			code: options.code || ErrorCode.DATABASE_ERROR,
			severity: options.severity || 'error'
		});
		this.name = 'DatabaseError';
	}
}

/**
 * Error handler utility
 */
export class ErrorHandler {
	private static listeners: ((error: AuraError) => void)[] = [];

	/**
	 * Handle an error
	 */
	static handle(error: unknown): AuraError {
		const auraError = this.normalize(error);
		
		// Log to console in development
		if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'development') {
			console.error('[AURA Error]', auraError.toJSON());
		}

		// Notify listeners
		this.listeners.forEach(listener => {
			try {
				listener(auraError);
			} catch (e) {
				console.error('Error listener threw:', e);
			}
		});

		return auraError;
	}

	/**
	 * Normalize any error to an AuraError
	 */
	static normalize(error: unknown): AuraError {
		if (error instanceof AuraError) {
			return error;
		}

		if (error instanceof Error) {
			return new AuraError(error.message, {
				cause: error,
				details: { originalName: error.name }
			});
		}

		if (typeof error === 'string') {
			return new AuraError(error);
		}

		return new AuraError('An unknown error occurred', {
			details: { originalError: String(error) }
		});
	}

	/**
	 * Add an error listener
	 */
	static addListener(listener: (error: AuraError) => void): () => void {
		this.listeners.push(listener);
		return () => {
			this.listeners = this.listeners.filter(l => l !== listener);
		};
	}

	/**
	 * Remove all listeners
	 */
	static clearListeners(): void {
		this.listeners = [];
	}
}

/**
 * Wrap an async function with error handling
 */
export function withErrorHandling<T extends (...args: unknown[]) => Promise<unknown>>(
	fn: T,
	errorTransformer?: (error: unknown) => AuraError
): T {
	return (async (...args: unknown[]) => {
		try {
			return await fn(...args);
		} catch (error) {
			const auraError = errorTransformer 
				? errorTransformer(error)
				: ErrorHandler.normalize(error);
			ErrorHandler.handle(auraError);
			throw auraError;
		}
	}) as T;
}

/**
 * Try-catch wrapper that returns a result type
 */
export async function tryCatch<T>(
	fn: () => Promise<T>
): Promise<{ success: true; data: T } | { success: false; error: AuraError }> {
	try {
		const data = await fn();
		return { success: true, data };
	} catch (error) {
		return { success: false, error: ErrorHandler.normalize(error) };
	}
}

export default {
	AuraError,
	NetworkError,
	AuthError,
	CryptoError,
	WalletError,
	ValidationError,
	DatabaseError,
	ErrorHandler,
	ErrorCode,
	withErrorHandling,
	tryCatch
};
