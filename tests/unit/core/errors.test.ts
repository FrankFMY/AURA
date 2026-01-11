import { describe, it, expect, vi } from 'vitest';
import {
	AuraError,
	NetworkError,
	AuthError,
	CryptoError,
	WalletError,
	ValidationError,
	DatabaseError,
	ErrorHandler,
	ErrorCode,
	tryCatch
} from '$lib/core/errors';

describe('Error classes', () => {
	describe('AuraError', () => {
		it('should create error with default values', () => {
			const error = new AuraError('Test error');
			expect(error.message).toBe('Test error');
			expect(error.code).toBe(ErrorCode.UNKNOWN_ERROR);
			expect(error.severity).toBe('error');
			expect(error.recoverable).toBe(true);
		});

		it('should create error with custom options', () => {
			const error = new AuraError('Test error', {
				code: ErrorCode.NETWORK_ERROR,
				severity: 'critical',
				recoverable: false,
				details: { foo: 'bar' }
			});
			expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
			expect(error.severity).toBe('critical');
			expect(error.recoverable).toBe(false);
			expect(error.details).toEqual({ foo: 'bar' });
		});

		it('should serialize to JSON', () => {
			const error = new AuraError('Test error', { code: ErrorCode.AUTH_FAILED });
			const json = error.toJSON();
			expect(json.name).toBe('AuraError');
			expect(json.message).toBe('Test error');
			expect(json.code).toBe(ErrorCode.AUTH_FAILED);
		});
	});

	describe('NetworkError', () => {
		it('should have correct name and default code', () => {
			const error = new NetworkError('Network failed');
			expect(error.name).toBe('NetworkError');
			expect(error.code).toBe(ErrorCode.NETWORK_ERROR);
		});
	});

	describe('AuthError', () => {
		it('should have correct name and default code', () => {
			const error = new AuthError('Auth failed');
			expect(error.name).toBe('AuthError');
			expect(error.code).toBe(ErrorCode.AUTH_FAILED);
		});
	});

	describe('ValidationError', () => {
		it('should include field name', () => {
			const error = new ValidationError('Invalid input', 'email');
			expect(error.name).toBe('ValidationError');
			expect(error.field).toBe('email');
			expect(error.details.field).toBe('email');
		});
	});
});

describe('ErrorHandler', () => {
	describe('normalize', () => {
		it('should return AuraError unchanged', () => {
			const original = new AuraError('Test');
			const normalized = ErrorHandler.normalize(original);
			expect(normalized).toBe(original);
		});

		it('should wrap standard Error', () => {
			const original = new Error('Standard error');
			const normalized = ErrorHandler.normalize(original);
			expect(normalized).toBeInstanceOf(AuraError);
			expect(normalized.message).toBe('Standard error');
		});

		it('should wrap string errors', () => {
			const normalized = ErrorHandler.normalize('String error');
			expect(normalized).toBeInstanceOf(AuraError);
			expect(normalized.message).toBe('String error');
		});

		it('should handle unknown error types', () => {
			const normalized = ErrorHandler.normalize(42);
			expect(normalized).toBeInstanceOf(AuraError);
		});
	});

	describe('handle', () => {
		it('should notify listeners', () => {
			const listener = vi.fn();
			const unsubscribe = ErrorHandler.addListener(listener);

			const error = new AuraError('Test');
			ErrorHandler.handle(error);

			expect(listener).toHaveBeenCalledWith(error);
			unsubscribe();
		});

		it('should allow removing listeners', () => {
			const listener = vi.fn();
			const unsubscribe = ErrorHandler.addListener(listener);
			unsubscribe();

			ErrorHandler.handle(new AuraError('Test'));
			expect(listener).not.toHaveBeenCalled();
		});
	});
});

describe('tryCatch', () => {
	it('should return success result for successful operation', async () => {
		const result = await tryCatch(async () => 'success');
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data).toBe('success');
		}
	});

	it('should return error result for failed operation', async () => {
		const result = await tryCatch(async () => {
			throw new Error('Failed');
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error).toBeInstanceOf(AuraError);
		}
	});
});
