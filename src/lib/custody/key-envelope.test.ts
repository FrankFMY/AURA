import { describe, expect, it, vi } from 'vitest';
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

	it('zeroizes explicit WebCrypto copies of the PRF output and plaintext key', async () => {
		const captured: Uint8Array[] = [];
		const originalImportKey = crypto.subtle.importKey.bind(crypto.subtle);
		const originalEncrypt = crypto.subtle.encrypt.bind(crypto.subtle);
		vi.spyOn(crypto.subtle, 'importKey').mockImplementation((async (
			format: KeyFormat,
			keyData: BufferSource,
			algorithm: AlgorithmIdentifier | HmacImportParams | RsaHashedImportParams | EcKeyImportParams,
			extractable: boolean,
			keyUsages: KeyUsage[]
		) => {
			if (format === 'raw') {
				captured.push(
					keyData instanceof ArrayBuffer
						? new Uint8Array(keyData)
						: new Uint8Array(keyData.buffer, keyData.byteOffset, keyData.byteLength)
				);
			}
			return Reflect.apply(originalImportKey, crypto.subtle, [
				format,
				keyData,
				algorithm,
				extractable,
				keyUsages
			]) as Promise<CryptoKey>;
		}) as never);
		vi.spyOn(crypto.subtle, 'encrypt').mockImplementation((async (
			algorithm: AlgorithmIdentifier,
			key: CryptoKey,
			data: BufferSource
		) => {
			captured.push(
				data instanceof ArrayBuffer
					? new Uint8Array(data)
					: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
			);
			return originalEncrypt(algorithm, key, data);
		}) as never);

		await envelope();
		expect(captured).toHaveLength(2);
		for (const bytes of captured) expect(bytes).toEqual(new Uint8Array(32));
		vi.restoreAllMocks();
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

	it('bounds creation metadata before base64 and AAD allocation', async () => {
		await expect(
			createKeyEnvelope({
				secretKey: secret,
				prfOutput,
				credentialId: new Uint8Array(1_025),
				prfSalt,
				origin,
				createdAt
			})
		).rejects.toThrow(/credential ID.*1024|supported size/i);
		await expect(
			createKeyEnvelope({
				secretKey: secret,
				prfOutput,
				credentialId,
				prfSalt,
				origin: `https://${'a'.repeat(600)}.example`,
				createdAt
			})
		).rejects.toThrow(/origin.*supported size|origin.*long/i);
	});

	it('rejects oversized envelope fields before base64 decoding', async () => {
		const value = await envelope();
		await expect(
			unlockKeyEnvelope({
				envelope: { ...value, ciphertext: 'A'.repeat(68) },
				prfOutput,
				expectedOrigin: origin
			})
		).rejects.toThrow(/supported size/i);
	});

	it('rejects unknown envelope fields with a bounded constant error', async () => {
		const value = await envelope();
		const hostile = { ...value, [`field-${'x'.repeat(10_000)}`]: true };
		let message = '';
		try {
			await unlockKeyEnvelope({
				envelope: hostile,
				prfOutput,
				expectedOrigin: origin
			});
		} catch (cause) {
			message = cause instanceof Error ? cause.message : String(cause);
		}
		expect(message).toBe('unknown key envelope field');
		expect(message.length).toBeLessThan(80);
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
