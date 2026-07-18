import { describe, expect, it } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import { UnlockedSession } from './session';

const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

describe('unlocked account session', () => {
	it('copies caller key material and exposes it only inside a bounded callback', () => {
		const input = Uint8Array.from(secret);
		const session = new UnlockedSession(input);
		input.fill(0);
		expect(session.pubkey).toBe(getPublicKey(secret));
		expect(session.withSecretKey((key) => getPublicKey(key))).toBe(getPublicKey(secret));
	});

	it('zeroizes retained internal bytes and refuses use after lock', () => {
		const session = new UnlockedSession(secret);
		let observed: Uint8Array | undefined;
		session.withSecretKey((key) => {
			observed = key;
		});
		session.lock();
		expect(observed).toEqual(new Uint8Array(32));
		expect(session.locked).toBe(true);
		expect(() => session.withSecretKey(() => null)).toThrow(/locked/i);
	});

	it('makes lock idempotent', () => {
		const session = new UnlockedSession(secret);
		session.lock();
		expect(() => session.lock()).not.toThrow();
	});
});
