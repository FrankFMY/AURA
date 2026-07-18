import { entropyToMnemonic, mnemonicToEntropy, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { getPublicKey } from 'nostr-tools';

function assertValidSecretKey(secretKey: Uint8Array): void {
	if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
		throw new Error('Nostr secret key must contain exactly 32 bytes');
	}
	try {
		getPublicKey(secretKey);
	} catch {
		throw new Error('recovery entropy is not a valid secp256k1 secret key');
	}
}

function normalizeRecoveryWords(value: string): string {
	if (typeof value !== 'string') throw new Error('recovery code must be text');
	return value.trim().toLowerCase().split(/\s+/u).join(' ');
}

export function secretKeyToRecoveryWords(secretKey: Uint8Array): string {
	assertValidSecretKey(secretKey);
	return entropyToMnemonic(Uint8Array.from(secretKey), wordlist);
}

export function recoveryWordsToSecretKey(value: string): Uint8Array {
	const normalized = normalizeRecoveryWords(value);
	if (normalized.split(' ').length !== 24)
		throw new Error('recovery code must contain exactly 24 words');
	if (!validateMnemonic(normalized, wordlist)) {
		throw new Error('recovery code words or checksum are invalid');
	}
	const secretKey = Uint8Array.from(mnemonicToEntropy(normalized, wordlist));
	assertValidSecretKey(secretKey);
	return secretKey;
}
