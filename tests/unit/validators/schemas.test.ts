import { describe, it, expect } from 'vitest';
import {
	pubkeySchema,
	npubSchema,
	nsecSchema,
	relayUrlSchema,
	nwcUrlSchema,
	lightningAddressSchema,
	bolt11Schema,
	nip05Schema,
	noteContentSchema,
	validate,
	validatePubkey,
	validatePrivateKey
} from '$lib/validators/schemas';

describe('validation schemas', () => {
	describe('pubkeySchema', () => {
		it('should accept valid 64-char hex pubkey', () => {
			const validPubkey = 'a'.repeat(64);
			expect(pubkeySchema.safeParse(validPubkey).success).toBe(true);
		});

		it('should reject invalid pubkey', () => {
			expect(pubkeySchema.safeParse('invalid').success).toBe(false);
			expect(pubkeySchema.safeParse('a'.repeat(63)).success).toBe(false);
			expect(pubkeySchema.safeParse('g'.repeat(64)).success).toBe(false);
		});
	});

	describe('npubSchema', () => {
		it('should accept valid npub', () => {
			const validNpub = 'npub1' + 'a'.repeat(58);
			expect(npubSchema.safeParse(validNpub).success).toBe(true);
		});

		it('should reject invalid npub', () => {
			expect(npubSchema.safeParse('npub1short').success).toBe(false);
			expect(npubSchema.safeParse('nsec1' + 'a'.repeat(58)).success).toBe(false);
		});
	});

	describe('nsecSchema', () => {
		it('should accept valid nsec', () => {
			const validNsec = 'nsec1' + 'a'.repeat(58);
			expect(nsecSchema.safeParse(validNsec).success).toBe(true);
		});

		it('should reject invalid nsec', () => {
			expect(nsecSchema.safeParse('nsec1short').success).toBe(false);
		});
	});

	describe('relayUrlSchema', () => {
		it('should accept valid wss relay URL', () => {
			expect(relayUrlSchema.safeParse('wss://relay.example.com').success).toBe(true);
		});

		it('should accept valid ws relay URL', () => {
			expect(relayUrlSchema.safeParse('ws://localhost:8080').success).toBe(true);
		});

		it('should reject http URLs', () => {
			expect(relayUrlSchema.safeParse('https://relay.example.com').success).toBe(false);
		});

		it('should reject invalid URLs', () => {
			expect(relayUrlSchema.safeParse('not a url').success).toBe(false);
		});
	});

	describe('lightningAddressSchema', () => {
		it('should accept valid lightning address', () => {
			expect(lightningAddressSchema.safeParse('user@domain.com').success).toBe(true);
		});

		it('should reject addresses with +', () => {
			expect(lightningAddressSchema.safeParse('user+tag@domain.com').success).toBe(false);
		});

		it('should reject invalid email format', () => {
			expect(lightningAddressSchema.safeParse('invalid').success).toBe(false);
		});
	});

	describe('nip05Schema', () => {
		it('should accept valid NIP-05 identifier', () => {
			expect(nip05Schema.safeParse('_@domain.com').success).toBe(true);
			expect(nip05Schema.safeParse('user@nostr.com').success).toBe(true);
		});

		it('should reject invalid NIP-05', () => {
			expect(nip05Schema.safeParse('invalid').success).toBe(false);
		});
	});

	describe('noteContentSchema', () => {
		it('should accept valid content', () => {
			expect(noteContentSchema.safeParse('Hello world!').success).toBe(true);
		});

		it('should reject empty content', () => {
			expect(noteContentSchema.safeParse('').success).toBe(false);
		});

		it('should reject content exceeding max length', () => {
			expect(noteContentSchema.safeParse('a'.repeat(10001)).success).toBe(false);
		});
	});

	describe('validate helper', () => {
		it('should return success for valid data', () => {
			const result = validate(pubkeySchema, 'a'.repeat(64));
			expect(result.success).toBe(true);
		});

		it('should return error message for invalid data', () => {
			const result = validate(pubkeySchema, 'invalid');
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error).toBeTruthy();
			}
		});
	});

	describe('validatePubkey', () => {
		it('should validate hex pubkey', () => {
			const hexKey = 'a'.repeat(64);
			expect(validatePubkey(hexKey)).toBe(hexKey);
		});

		it('should return null for invalid pubkey', () => {
			expect(validatePubkey('invalid')).toBeNull();
		});
	});
});
