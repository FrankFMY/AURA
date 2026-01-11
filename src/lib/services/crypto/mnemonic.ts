/**
 * BIP39 Mnemonic Service
 * 
 * Generates and validates seed phrases for user-friendly key creation.
 * Uses @scure/bip39 for secure mnemonic generation.
 */

import * as bip39 from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { getPublicKey } from 'nostr-tools';
import { nip19 } from 'nostr-tools';

const { generateMnemonic, mnemonicToSeedSync, validateMnemonic } = bip39;

/** Convert bytes to hex string */
function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('');
}

export interface GeneratedKeys {
	mnemonic: string;
	words: string[];
	privateKeyHex: string;
	publicKeyHex: string;
	nsec: string;
	npub: string;
}

/**
 * Generate a new 12-word mnemonic and derive Nostr keys
 */
export function generateNostrMnemonic(): GeneratedKeys {
	// Generate 12-word mnemonic (128 bits of entropy)
	const mnemonic = generateMnemonic(wordlist, 128);
	const words = mnemonic.split(' ');

	// Derive seed from mnemonic
	const seed = mnemonicToSeedSync(mnemonic);

	// Use first 32 bytes of seed as private key
	// This is a simplified derivation - for full BIP44 compliance,
	// you'd use a proper derivation path like m/44'/1237'/0'/0/0
	const privateKeyBytes = seed.slice(0, 32);
	const privateKeyHex = bytesToHex(privateKeyBytes);

	// Derive public key
	const publicKeyHex = getPublicKey(privateKeyBytes);

	// Encode to Nostr formats
	const nsec = nip19.nsecEncode(privateKeyBytes);
	const npub = nip19.npubEncode(publicKeyHex);

	return {
		mnemonic,
		words,
		privateKeyHex,
		publicKeyHex,
		nsec,
		npub,
	};
}

/**
 * Validate a mnemonic phrase
 */
export function isValidMnemonic(mnemonic: string): boolean {
	return validateMnemonic(mnemonic, wordlist);
}

/**
 * Recover keys from mnemonic
 */
export function recoverFromMnemonic(mnemonic: string): GeneratedKeys | null {
	if (!isValidMnemonic(mnemonic)) {
		return null;
	}

	const words = mnemonic.trim().toLowerCase().split(/\s+/);
	const normalizedMnemonic = words.join(' ');

	const seed = mnemonicToSeedSync(normalizedMnemonic);
	const privateKeyBytes = seed.slice(0, 32);
	const privateKeyHex = bytesToHex(privateKeyBytes);
	const publicKeyHex = getPublicKey(privateKeyBytes);
	const nsec = nip19.nsecEncode(privateKeyBytes);
	const npub = nip19.npubEncode(publicKeyHex);

	return {
		mnemonic: normalizedMnemonic,
		words,
		privateKeyHex,
		publicKeyHex,
		nsec,
		npub,
	};
}

/**
 * Get random indices for word verification
 * Returns 3 random indices from the 12-word phrase
 */
export function getVerificationIndices(): number[] {
	const indices: number[] = [];
	while (indices.length < 3) {
		const idx = Math.floor(Math.random() * 12);
		if (!indices.includes(idx)) {
			indices.push(idx);
		}
	}
	return indices.sort((a, b) => a - b);
}

/**
 * Verify user's word selections
 */
export function verifyWords(
	words: string[],
	indices: number[],
	userInputs: string[],
): boolean {
	if (userInputs.length !== indices.length) return false;

	return indices.every((wordIndex, inputIndex) => {
		const expected = words[wordIndex].toLowerCase().trim();
		const actual = userInputs[inputIndex].toLowerCase().trim();
		return expected === actual;
	});
}

export default {
	generateNostrMnemonic,
	isValidMnemonic,
	recoverFromMnemonic,
	getVerificationIndices,
	verifyWords,
};
