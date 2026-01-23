import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { keyManager } from '$lib/services/crypto/key-manager';

// We need to enhance the global crypto mock for these tests
const subtleCryptoMock = {
	importKey: vi.fn().mockResolvedValue({ type: 'mock-key' }),
	deriveKey: vi.fn().mockResolvedValue({ type: 'mock-derived-key' }),
	encrypt: vi.fn(async (algo: any, key: any, data: Uint8Array) => {
		// Simple mock: "encrypt" by reversing the data
		return data.slice().reverse().buffer;
	}),
	decrypt: vi.fn(async (algo: any, key: any, data: ArrayBuffer) => {
		// Simple mock: "decrypt" by reversing it back
		const u8 = new Uint8Array(data);
		return u8.slice().reverse().buffer;
	}),
	digest: vi.fn().mockResolvedValue(new ArrayBuffer(32))
};

Object.defineProperty(window, 'crypto', {
	value: {
		getRandomValues: (arr: Uint8Array) => {
			for (let i = 0; i < arr.length; i++) {
				arr[i] = i; // Predictable values
			}
			return arr;
		},
		subtle: subtleCryptoMock
	}
});

// Mock btoa and atob for Node.js environment
if (typeof btoa === 'undefined') {
	global.btoa = (str) => Buffer.from(str, 'binary').toString('base64');
	global.atob = (b64Encoded) => Buffer.from(b64Encoded, 'base64').toString('binary');
}

describe('KeyManager', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Reset mocks to clear history and restore default implementation
		vi.mocked(subtleCryptoMock.decrypt).mockRestore();
		vi.mocked(subtleCryptoMock.deriveKey).mockRestore();
		vi.clearAllMocks();
		
		// Restore default mock implementations after they might have been changed in a test
		subtleCryptoMock.decrypt.mockImplementation(async (algo: any, key: any, data: ArrayBuffer) => {
			const u8 = new Uint8Array(data);
			return u8.slice().reverse().buffer;
		});
		subtleCryptoMock.deriveKey.mockResolvedValue({ type: 'mock-derived-key' });


		keyManager.endSession(); // Ensure clean state
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('Encryption/Decryption', () => {
		it('should perform a successful encrypt-decrypt round-trip', async () => {
			const secretData = 'my-secret-nostr-private-key';
			const password = 'strong_password';

			const encrypted = await keyManager.encrypt(secretData, password);

			expect(encrypted).toHaveProperty('iv');
			expect(encrypted).toHaveProperty('ciphertext');
			expect(encrypted).toHaveProperty('salt');
			
			// Check that crypto functions were called
			expect(subtleCryptoMock.deriveKey).toHaveBeenCalled();
			expect(subtleCryptoMock.encrypt).toHaveBeenCalled();
			
			const decrypted = await keyManager.decrypt(encrypted, password);
			
			expect(subtleCryptoMock.decrypt).toHaveBeenCalled();
			expect(decrypted).toBe(secretData);
		});

		it('should fail to decrypt with the wrong password', async () => {
			const secretData = 'my-secret-nostr-private-key';
			const correctPassword = 'strong_password';
			const wrongPassword = 'wrong_password';

			const encrypted = await keyManager.encrypt(secretData, correctPassword);
			
			// Mock decrypt to throw for this specific test
			(subtleCryptoMock.decrypt as Mock).mockRejectedValue(new Error('Decryption failed'));

			await expect(keyManager.decrypt(encrypted, wrongPassword)).rejects.toThrow('Decryption failed');
		});
	});
	
	describe('Session Management', () => {
		it('should start and end a session', () => {
			expect(keyManager.isSessionActive()).toBe(false);
			keyManager.startSession(10000);
			expect(keyManager.isSessionActive()).toBe(true);
			keyManager.endSession();
			expect(keyManager.isSessionActive()).toBe(false);
		});

		it('should trigger onExpired callback when session times out', async () => {
			const onExpired = vi.fn();
			const timeout = 30 * 60 * 1000; // 30 minutes
			
			keyManager.startSession(timeout, onExpired);
			expect(onExpired).not.toHaveBeenCalled();

			// Advance time to just before expiration
			await vi.advanceTimersByTimeAsync(timeout - 1);
			expect(onExpired).not.toHaveBeenCalled();

			// Advance time past expiration
			await vi.advanceTimersByTimeAsync(1);
			expect(onExpired).toHaveBeenCalled();
			expect(keyManager.isSessionActive()).toBe(false);
		});
		
		it('should trigger onWarning callback before session expires', async () => {
			const onWarning = vi.fn();
			const timeout = 30 * 60 * 1000;
			const warningLeadTime = 5 * 60 * 1000;

			keyManager.startSession(timeout, undefined, onWarning);
			expect(onWarning).not.toHaveBeenCalled();
			
			// Advance time to trigger the warning
			await vi.advanceTimersByTimeAsync(timeout - warningLeadTime);
			
			expect(onWarning).toHaveBeenCalled();
			// Check that it's called with roughly the correct remaining time
			const remainingTime = onWarning.mock.calls[0][0];
			expect(remainingTime).toBeLessThanOrEqual(warningLeadTime);
			expect(remainingTime).toBeGreaterThan(warningLeadTime - 1000);
		});
	});

	describe('Utility Functions', () => {
		it('should generate a random hex string of correct length', () => {
			const hex = keyManager.generateRandomHex(32);
			expect(hex).toHaveLength(64);
			expect(/^[0-9a-f]{64}$/.test(hex)).toBe(true);
		});
		
		it('should securely compare two strings', () => {
			expect(keyManager.secureCompare('abc', 'abc')).toBe(true);
			expect(keyManager.secureCompare('abc', 'def')).toBe(false);
			expect(keyManager.secureCompare('abc', 'abcd')).toBe(false);
		});
		
		it('should hash data using SHA-256', async () => {
			await keyManager.hash('test data');
			expect(subtleCryptoMock.digest).toHaveBeenCalledTimes(1);

			const callArgs = (subtleCryptoMock.digest as Mock).mock.calls[0];
			expect(callArgs[0]).toBe('SHA-256');

			// Workaround for a strange `toBeInstanceOf(Uint8Array)` failure in the test environment.
			// We check for characteristic properties instead.
			expect(callArgs[1].constructor.name).toBe('Uint8Array');
			expect(typeof callArgs[1].byteLength).toBe('number');
		});
	});
});
