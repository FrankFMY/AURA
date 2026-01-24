/**
 * NIP-44 Encryption Implementation
 * 
 * Versioned encryption for Nostr direct messages using XChaCha20-Poly1305.
 * https://github.com/nostr-protocol/nips/blob/master/44.md
 */

// @ts-ignore - Noble libraries have complex type exports
import { secp256k1 } from '@noble/curves/secp256k1.js';
// @ts-ignore
import { sha256 } from '@noble/hashes/sha256';
// @ts-ignore
import { hkdf } from '@noble/hashes/hkdf';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { hexToBytes, utf8ToBytes, bytesToUtf8 } from '@noble/ciphers/utils.js';

/** Generate random bytes using Web Crypto API */
function randomBytes(length: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(length));
}

/** NIP-44 version */
const NIP44_VERSION = 2;

/** Minimum plaintext size */
const MIN_PLAINTEXT_SIZE = 1;

/** Maximum plaintext size */
const MAX_PLAINTEXT_SIZE = 65535;

/** Padding block size */
const PADDING_BLOCK_SIZE = 32;

/**
 * Calculate padded length for plaintext
 */
function calcPaddedLen(unpaddedLen: number): number {
	if (unpaddedLen <= 0) return PADDING_BLOCK_SIZE;
	if (unpaddedLen <= PADDING_BLOCK_SIZE) return PADDING_BLOCK_SIZE;
	
	const nextPower = Math.ceil(Math.log2(unpaddedLen));
	const chunk = Math.max(PADDING_BLOCK_SIZE, Math.pow(2, nextPower - 1));
	
	return chunk * Math.ceil(unpaddedLen / chunk);
}

/**
 * Pad plaintext to hide message length
 */
function pad(plaintext: Uint8Array): Uint8Array {
	const unpaddedLen = plaintext.length;
	
	if (unpaddedLen < MIN_PLAINTEXT_SIZE || unpaddedLen > MAX_PLAINTEXT_SIZE) {
		throw new Error(`Plaintext length ${unpaddedLen} is out of range`);
	}
	
	const paddedLen = calcPaddedLen(unpaddedLen);
	const padded = new Uint8Array(2 + paddedLen);
	
	// Write length as big-endian uint16
	padded[0] = (unpaddedLen >> 8) & 0xff;
	padded[1] = unpaddedLen & 0xff;
	
	// Copy plaintext
	padded.set(plaintext, 2);
	
	// Fill rest with zeros (already initialized to 0)
	
	return padded;
}

/**
 * Unpad plaintext
 */
function unpad(padded: Uint8Array): Uint8Array {
	if (padded.length < 2) {
		throw new Error('Padded data too short');
	}
	
	// Read length as big-endian uint16
	const unpaddedLen = (padded[0] << 8) | padded[1];
	
	if (unpaddedLen < MIN_PLAINTEXT_SIZE || unpaddedLen > MAX_PLAINTEXT_SIZE) {
		throw new Error(`Invalid unpadded length: ${unpaddedLen}`);
	}
	
	if (padded.length < 2 + unpaddedLen) {
		throw new Error('Padded data shorter than declared length');
	}
	
	return padded.slice(2, 2 + unpaddedLen);
}

/**
 * Compute shared secret using ECDH
 */
function getSharedSecret(privateKey: string, publicKey: string): Uint8Array {
	const privKeyBytes = hexToBytes(privateKey);
	const pubKeyBytes = hexToBytes('02' + publicKey); // Add prefix for compressed key
	
	const sharedPoint = secp256k1.getSharedSecret(privKeyBytes, pubKeyBytes);
	// Take x-coordinate only (first 32 bytes after removing prefix)
	return sharedPoint.slice(1, 33);
}

/**
 * Derive conversation key using HKDF
 */
function getConversationKey(sharedSecret: Uint8Array): Uint8Array {
	return hkdf(sha256, sharedSecret, 'nip44-v2', undefined, 32);
}

/**
 * Derive message keys using HKDF
 */
function getMessageKeys(conversationKey: Uint8Array, nonce: Uint8Array): {
	chachaKey: Uint8Array;
	chachaNonce: Uint8Array;
	hmacKey: Uint8Array;
} {
	const keys = hkdf(sha256, conversationKey, nonce, 'nip44-v2', 76);
	
	return {
		chachaKey: keys.slice(0, 32),
		chachaNonce: keys.slice(32, 56),
		hmacKey: keys.slice(56, 76)
	};
}

/**
 * Encrypt a message using NIP-44
 * 
 * @param plaintext - Message to encrypt
 * @param senderPrivateKey - Sender's private key (hex)
 * @param recipientPublicKey - Recipient's public key (hex)
 * @returns Base64-encoded encrypted message
 */
export function encrypt(
	plaintext: string,
	senderPrivateKey: string,
	recipientPublicKey: string
): string {
	// Convert plaintext to bytes
	const plaintextBytes = utf8ToBytes(plaintext);
	
	// Validate length
	if (plaintextBytes.length < MIN_PLAINTEXT_SIZE || plaintextBytes.length > MAX_PLAINTEXT_SIZE) {
		throw new Error('Plaintext length out of range');
	}
	
	// Pad plaintext
	const padded = pad(plaintextBytes);
	
	// Generate random nonce
	const nonce = randomBytes(32);
	
	// Compute shared secret and conversation key
	const sharedSecret = getSharedSecret(senderPrivateKey, recipientPublicKey);
	const conversationKey = getConversationKey(sharedSecret);
	
	// Derive message keys
	const { chachaKey, chachaNonce } = getMessageKeys(conversationKey, nonce);
	
	// Encrypt using XChaCha20-Poly1305
	const cipher = xchacha20poly1305(chachaKey, chachaNonce);
	const ciphertext = cipher.encrypt(padded);
	
	// Construct payload: version (1) + nonce (32) + ciphertext (variable)
	const payload = new Uint8Array(1 + 32 + ciphertext.length);
	payload[0] = NIP44_VERSION;
	payload.set(nonce, 1);
	payload.set(ciphertext, 33);
	
	// Encode as base64
	return btoa(String.fromCharCode(...payload));
}

/**
 * Decrypt a message using NIP-44
 * 
 * @param payload - Base64-encoded encrypted message
 * @param recipientPrivateKey - Recipient's private key (hex)
 * @param senderPublicKey - Sender's public key (hex)
 * @returns Decrypted plaintext
 */
export function decrypt(
	payload: string,
	recipientPrivateKey: string,
	senderPublicKey: string
): string {
	// Decode base64
	const payloadBytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
	
	// Check minimum length
	if (payloadBytes.length < 1 + 32 + 16) {
		throw new Error('Payload too short');
	}
	
	// Extract version
	const version = payloadBytes[0];
	if (version !== NIP44_VERSION) {
		throw new Error(`Unsupported NIP-44 version: ${version}`);
	}
	
	// Extract nonce and ciphertext
	const nonce = payloadBytes.slice(1, 33);
	const ciphertext = payloadBytes.slice(33);
	
	// Compute shared secret and conversation key
	const sharedSecret = getSharedSecret(recipientPrivateKey, senderPublicKey);
	const conversationKey = getConversationKey(sharedSecret);
	
	// Derive message keys
	const { chachaKey, chachaNonce } = getMessageKeys(conversationKey, nonce);
	
	// Decrypt using XChaCha20-Poly1305
	const cipher = xchacha20poly1305(chachaKey, chachaNonce);
	const padded = cipher.decrypt(ciphertext);
	
	// Unpad plaintext
	const plaintextBytes = unpad(padded);
	
	// Convert to string
	return bytesToUtf8(plaintextBytes);
}

/**
 * Check if a message is NIP-44 encrypted
 */
export function isNip44Encrypted(payload: string): boolean {
	try {
		const payloadBytes = Uint8Array.from(atob(payload), c => c.charCodeAt(0));
		return payloadBytes.length >= 1 && payloadBytes[0] === NIP44_VERSION;
	} catch {
		return false;
	}
}

export default {
	encrypt,
	decrypt,
	isNip44Encrypted
};
