import { describe, expect, it } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import { createKeyEnvelope, readKeyEnvelopeCredential, unlockKeyEnvelope } from './key-envelope';

const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const prfOutput = Uint8Array.from({ length: 32 }, (_, index) => 200 - index);
const credentialId = Uint8Array.from({ length: 24 }, (_, index) => index + 50);
const prfSalt = Uint8Array.from({ length: 32 }, (_, index) => index + 90);
const origin = 'https://aura.frankfmy.com';
const createdAt = 1_750_000_000;

async function envelope() {
	return createKeyEnvelope({
		secretKey: secret,
		prfOutput,
		credentialId,
		prfSalt,
		origin,
		createdAt,
		randomBytes: (length: number) => Uint8Array.from({ length }, (_, index) => index + 7)
	});
}

describe('authenticated local key envelope', () => {
	it('round-trips the exact key without serializing raw key material', async () => {
		const value = await envelope();
		const serialized = JSON.stringify(value);
		const rawHex = Array.from(secret, (byte) => byte.toString(16).padStart(2, '0')).join('');
		const rawBase64 = btoa(String.fromCharCode(...secret));
		expect(serialized).not.toContain(rawHex);
		expect(serialized).not.toContain(rawBase64);
		expect(value.account_pubkey).toBe(getPublicKey(secret));

		const restored = await unlockKeyEnvelope({
			envelope: value,
			prfOutput,
			expectedOrigin: origin
		});
		expect(restored).toEqual(secret);
		expect(readKeyEnvelopeCredential(value)).toEqual({ credentialId, prfSalt });
	});

	it('fails closed with the wrong PRF output or deployment origin', async () => {
		const value = await envelope();
		await expect(
			unlockKeyEnvelope({
				envelope: value,
				prfOutput: Uint8Array.from(prfOutput, (byte) => byte ^ 0xff),
				expectedOrigin: origin
			})
		).rejects.toThrow(/unlock|decrypt|authentication/i);
		await expect(
			unlockKeyEnvelope({ envelope: value, prfOutput, expectedOrigin: 'https://evil.example' })
		).rejects.toThrow(/origin/i);
	});

	it('rejects metadata and ciphertext tampering', async () => {
		const value = await envelope();
		await expect(
			unlockKeyEnvelope({
				envelope: { ...value, account_pubkey: '22'.repeat(32) },
				prfOutput,
				expectedOrigin: origin
			})
		).rejects.toThrow(/unlock|decrypt|authentication/i);
		await expect(
			unlockKeyEnvelope({
				envelope: { ...value, ciphertext: `${value.ciphertext.slice(0, -1)}A` },
				prfOutput,
				expectedOrigin: origin
			})
		).rejects.toThrow(/unlock|decrypt|authentication|canonical/i);
	});

	it('rejects malformed key, PRF and nonce inputs', async () => {
		await expect(
			createKeyEnvelope({
				secretKey: new Uint8Array(31),
				prfOutput,
				credentialId,
				prfSalt,
				origin,
				createdAt
			})
		).rejects.toThrow(/32 bytes/i);
		const value = await envelope();
		await expect(
			unlockKeyEnvelope({ envelope: { ...value, nonce: 'AA' }, prfOutput, expectedOrigin: origin })
		).rejects.toThrow(/nonce/i);
	});
});
