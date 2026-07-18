import { describe, expect, it } from 'vitest';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { getPublicKey } from 'nostr-tools';
import { recoveryWordsToSecretKey, secretKeyToRecoveryWords } from './recovery';

const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

describe('AURA exact-key recovery code', () => {
	it('round-trips a Nostr secret through exactly 24 BIP-39 words', () => {
		const words = secretKeyToRecoveryWords(secret);
		expect(words.split(' ')).toHaveLength(24);
		const restored = recoveryWordsToSecretKey(words);
		expect(restored).toEqual(secret);
		expect(getPublicKey(restored)).toBe(getPublicKey(secret));
	});

	it('normalizes harmless user whitespace and case', () => {
		const words = secretKeyToRecoveryWords(secret);
		const pasted = `  ${words.toUpperCase().split(' ').join('  \n ')}  `;
		expect(recoveryWordsToSecretKey(pasted)).toEqual(secret);
	});

	it('rejects wrong lengths and invalid checksum words', () => {
		expect(() => secretKeyToRecoveryWords(new Uint8Array(31))).toThrow(/32 bytes/i);
		const words = secretKeyToRecoveryWords(secret).split(' ');
		words[7] = 'notaword';
		expect(() => recoveryWordsToSecretKey(words.join(' '))).toThrow(/recovery code/i);
		expect(() => recoveryWordsToSecretKey('abandon abandon')).toThrow(/24 words/i);
	});

	it('rejects valid mnemonic entropy that is not a valid secp256k1 secret', () => {
		const zeroKeyWords = entropyToMnemonic(new Uint8Array(32), wordlist);
		expect(() => recoveryWordsToSecretKey(zeroKeyWords)).toThrow(/secp256k1/i);
	});
});
