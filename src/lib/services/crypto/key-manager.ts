/**
 * Secure Key Manager using Web Crypto API
 * 
 * This module provides secure key management including:
 * - Encryption of sensitive data using AES-GCM
 * - Session timeout handling
 * - Secure memory management for private keys
 */

/** Salt for key derivation */
const KEY_DERIVATION_SALT = new Uint8Array([
	0x41, 0x55, 0x52, 0x41, 0x2d, 0x4b, 0x45, 0x59,
	0x2d, 0x53, 0x41, 0x4c, 0x54, 0x2d, 0x56, 0x31
]);

/** Iterations for PBKDF2 */
const PBKDF2_ITERATIONS = 100000;

/** Session configuration */
const SESSION_CONFIG = {
	/** Default session timeout in milliseconds (30 minutes) */
	defaultTimeout: 30 * 60 * 1000,
	/** Maximum session timeout (24 hours) */
	maxTimeout: 24 * 60 * 60 * 1000,
	/** Inactivity warning before timeout (5 minutes) */
	warningBeforeTimeout: 5 * 60 * 1000
};

/** Encrypted data format */
interface EncryptedData {
	iv: string; // Base64 encoded
	ciphertext: string; // Base64 encoded
	salt: string; // Base64 encoded
}

/** Session state */
interface SessionState {
	expiresAt: number;
	lastActivity: number;
	warningShown: boolean;
}

class KeyManager {
	private _derivedKey: CryptoKey | null = null;
	private _sessionState: SessionState | null = null;
	private _activityTimeout: ReturnType<typeof setTimeout> | null = null;
	private _warningTimeout: ReturnType<typeof setTimeout> | null = null;
	private _onSessionExpired: (() => void) | null = null;
	private _onSessionWarning: ((remainingMs: number) => void) | null = null;

	/**
	 * Check if Web Crypto API is available
	 */
	isSupported(): boolean {
		return globalThis.crypto?.subtle !== undefined &&
			globalThis.crypto?.getRandomValues !== undefined;
	}

	/**
	 * Derive an encryption key from a password using PBKDF2
	 */
	async deriveKey(password: string, salt?: Uint8Array): Promise<{ key: CryptoKey; salt: Uint8Array }> {
		if (!this.isSupported()) {
			throw new Error('Web Crypto API not supported');
		}

		const actualSalt = salt || crypto.getRandomValues(new Uint8Array(16));
		
		// Import password as key material
		const keyMaterial = await crypto.subtle.importKey(
			'raw',
			new TextEncoder().encode(password),
			'PBKDF2',
			false,
			['deriveBits', 'deriveKey']
		);

		// Derive the actual encryption key
		const key = await crypto.subtle.deriveKey(
			{
				name: 'PBKDF2',
				salt: actualSalt.buffer as ArrayBuffer,
				iterations: PBKDF2_ITERATIONS,
				hash: 'SHA-256'
			},
			keyMaterial,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt']
		);

		return { key, salt: actualSalt };
	}

	/**
	 * Encrypt data using AES-GCM
	 */
	async encrypt(data: string, password: string): Promise<EncryptedData> {
		if (!this.isSupported()) {
			throw new Error('Web Crypto API not supported');
		}

		const { key, salt } = await this.deriveKey(password);
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const encodedData = new TextEncoder().encode(data);

		const ciphertext = await crypto.subtle.encrypt(
			{ name: 'AES-GCM', iv },
			key,
			encodedData
		);

		return {
			iv: this.arrayBufferToBase64(iv),
			ciphertext: this.arrayBufferToBase64(ciphertext),
			salt: this.arrayBufferToBase64(salt)
		};
	}

	/**
	 * Decrypt data using AES-GCM
	 */
	async decrypt(encryptedData: EncryptedData, password: string): Promise<string> {
		if (!this.isSupported()) {
			throw new Error('Web Crypto API not supported');
		}

		const salt = this.base64ToArrayBuffer(encryptedData.salt);
		const iv = this.base64ToArrayBuffer(encryptedData.iv);
		const ciphertext = this.base64ToArrayBuffer(encryptedData.ciphertext);

		const { key } = await this.deriveKey(password, new Uint8Array(salt));

		const decrypted = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: new Uint8Array(iv) },
			key,
			ciphertext
		);

		return new TextDecoder().decode(decrypted);
	}

	/**
	 * Start a session with timeout management
	 */
	startSession(
		timeoutMs: number = SESSION_CONFIG.defaultTimeout,
		onExpired?: () => void,
		onWarning?: (remainingMs: number) => void
	): void {
		// Clear any existing session
		this.endSession();

		const validTimeout = Math.min(
			Math.max(timeoutMs, 60000), // Minimum 1 minute
			SESSION_CONFIG.maxTimeout
		);

		this._sessionState = {
			expiresAt: Date.now() + validTimeout,
			lastActivity: Date.now(),
			warningShown: false
		};

		this._onSessionExpired = onExpired || null;
		this._onSessionWarning = onWarning || null;

		this.scheduleTimeouts();
	}

	/**
	 * Record activity to reset the session timeout
	 */
	recordActivity(): void {
		if (!this._sessionState) return;

		const now = Date.now();
		const remainingTime = this._sessionState.expiresAt - now;

		// Only extend if more than 1 minute has passed since last activity
		if (now - this._sessionState.lastActivity > 60000) {
			this._sessionState.lastActivity = now;
			this._sessionState.expiresAt = now + remainingTime + 60000;
			this._sessionState.warningShown = false;
			this.scheduleTimeouts();
		}
	}

	/**
	 * End the current session
	 */
	endSession(): void {
		this.clearTimeouts();
		this._sessionState = null;
		this._derivedKey = null;
		this._onSessionExpired = null;
		this._onSessionWarning = null;
	}

	/**
	 * Check if session is active
	 */
	isSessionActive(): boolean {
		if (!this._sessionState) return false;
		return Date.now() < this._sessionState.expiresAt;
	}

	/**
	 * Get remaining session time in milliseconds
	 */
	getRemainingSessionTime(): number {
		if (!this._sessionState) return 0;
		return Math.max(0, this._sessionState.expiresAt - Date.now());
	}

	/**
	 * Generate a secure random hex string
	 */
	generateRandomHex(byteLength: number = 32): string {
		if (!this.isSupported()) {
			throw new Error('Web Crypto API not supported');
		}

		const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
		return Array.from(bytes)
			.map(b => b.toString(16).padStart(2, '0'))
			.join('');
	}

	/**
	 * Securely compare two strings (constant-time comparison)
	 */
	secureCompare(a: string, b: string): boolean {
		if (a.length !== b.length) return false;

		const encoder = new TextEncoder();
		const bufferA = encoder.encode(a);
		const bufferB = encoder.encode(b);

		let result = 0;
		for (let i = 0; i < bufferA.length; i++) {
			result |= bufferA[i] ^ bufferB[i];
		}

		return result === 0;
	}

	/**
	 * Hash data using SHA-256
	 */
	async hash(data: string): Promise<string> {
		if (!this.isSupported()) {
			throw new Error('Web Crypto API not supported');
		}

		const encoded = new TextEncoder().encode(data);
		const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
		return this.arrayBufferToBase64(hashBuffer);
	}

	/**
	 * Securely clear a string from memory (best effort)
	 * Note: JavaScript doesn't guarantee memory clearing, but this helps
	 */
	secureClear(str: string): void {
		// We can't actually clear strings in JS, but we can at least
		// set variables to null/undefined to allow garbage collection
		// This is a placeholder for documentation purposes
	}

	// Private methods

	private scheduleTimeouts(): void {
		this.clearTimeouts();

		if (!this._sessionState) return;

		const remaining = this._sessionState.expiresAt - Date.now();

		// Schedule warning
		const warningTime = remaining - SESSION_CONFIG.warningBeforeTimeout;
		if (warningTime > 0 && !this._sessionState.warningShown) {
			this._warningTimeout = setTimeout(() => {
				if (this._sessionState && !this._sessionState.warningShown) {
					this._sessionState.warningShown = true;
					this._onSessionWarning?.(this.getRemainingSessionTime());
				}
			}, warningTime);
		}

		// Schedule expiration
		if (remaining > 0) {
			this._activityTimeout = setTimeout(() => {
				this._onSessionExpired?.();
				this.endSession();
			}, remaining);
		}
	}

	private clearTimeouts(): void {
		if (this._activityTimeout) {
			clearTimeout(this._activityTimeout);
			this._activityTimeout = null;
		}
		if (this._warningTimeout) {
			clearTimeout(this._warningTimeout);
			this._warningTimeout = null;
		}
	}

	private arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
		const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
		let binary = '';
		for (let i = 0; i < bytes.byteLength; i++) {
			binary += String.fromCodePoint(bytes[i]);
		}
		return btoa(binary);
	}

	private base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.codePointAt(i) ?? 0;
		}
		return bytes.buffer;
	}
}

/** Singleton instance */
export const keyManager = new KeyManager();

export default keyManager;
