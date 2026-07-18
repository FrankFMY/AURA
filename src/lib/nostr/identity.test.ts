import { describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { parseNostrPubkey } from './identity';

describe('Nostr contact identifier parser', () => {
	it('accepts canonical hex and npub', () => {
		const pubkey = getPublicKey(generateSecretKey());
		expect(parseNostrPubkey(pubkey)).toBe(pubkey);
		expect(parseNostrPubkey(nip19.npubEncode(pubkey))).toBe(pubkey);
	});

	it('normalizes harmless surrounding whitespace but not hex case', () => {
		const pubkey = getPublicKey(generateSecretKey());
		expect(parseNostrPubkey(`  ${nip19.npubEncode(pubkey)}\n`)).toBe(pubkey);
		expect(() => parseNostrPubkey(pubkey.toUpperCase())).toThrow(/identifier/i);
	});

	it('rejects nsec, malformed and unsupported identifiers', () => {
		const secret = generateSecretKey();
		for (const value of [nip19.nsecEncode(secret), 'not-a-key', '', 'npub1broken']) {
			expect(() => parseNostrPubkey(value)).toThrow(/identifier/i);
		}
	});
});
