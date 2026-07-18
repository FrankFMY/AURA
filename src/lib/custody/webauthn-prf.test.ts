import { describe, expect, it } from 'vitest';
import { createPrfCredential, getPrfOutput, type CredentialProvider } from './webauthn-prf';

const pubkey = '11'.repeat(32);
const rawId = Uint8Array.from({ length: 24 }, (_, index) => index + 1);
const prfOutput = Uint8Array.from({ length: 32 }, (_, index) => index + 50);

function credential(
	output: Uint8Array | null = prfOutput,
	includeEnabled = true
): PublicKeyCredential {
	return {
		id: 'credential',
		type: 'public-key',
		rawId: rawId.buffer,
		response: {} as AuthenticatorResponse,
		authenticatorAttachment: 'platform',
		getClientExtensionResults: () =>
			output
				? ({
						prf: {
							...(includeEnabled ? { enabled: true } : {}),
							results: { first: output.buffer }
						}
					} as AuthenticationExtensionsClientOutputs)
				: ({ prf: { enabled: false } } as AuthenticationExtensionsClientOutputs),
		toJSON: () => ({})
	} as PublicKeyCredential;
}

describe('WebAuthn PRF custody adapter', () => {
	it('creates a resident user-verified credential and obtains PRF output', async () => {
		let creation: CredentialCreationOptions | undefined;
		const provider: CredentialProvider = {
			create: async (options) => {
				creation = options;
				return credential();
			},
			get: async () => null
		};
		const result = await createPrfCredential({
			accountPubkey: pubkey,
			displayName: 'Artem',
			rpId: 'aura.frankfmy.com',
			provider,
			randomBytes: (length) => Uint8Array.from({ length }, (_, index) => index + 9)
		});
		expect(result.credentialId).toEqual(rawId);
		expect(result.prfOutput).toEqual(prfOutput);
		expect(result.prfSalt).toHaveLength(32);
		expect(creation?.publicKey?.authenticatorSelection).toMatchObject({
			residentKey: 'required',
			userVerification: 'required'
		});
		expect(creation?.publicKey?.rp.id).toBe('aura.frankfmy.com');
	});

	it('falls back to an immediate user-verified assertion when create-time PRF evaluation is unavailable', async () => {
		const registration = credential(null);
		registration.getClientExtensionResults = () =>
			({ prf: { enabled: true } }) as AuthenticationExtensionsClientOutputs;
		let assertions = 0;
		const result = await createPrfCredential({
			accountPubkey: pubkey,
			displayName: 'Artem',
			rpId: 'aura.frankfmy.com',
			provider: {
				create: async () => registration,
				get: async () => {
					assertions += 1;
					return credential(prfOutput, false);
				}
			}
		});
		expect(assertions).toBe(1);
		expect(result.prfOutput).toEqual(prfOutput);
	});

	it('gets PRF output only from the expected credential with user verification', async () => {
		let request: CredentialRequestOptions | undefined;
		const provider: CredentialProvider = {
			create: async () => null,
			get: async (options) => {
				request = options;
				return credential(prfOutput, false);
			}
		};
		const result = await getPrfOutput({
			credentialId: rawId,
			prfSalt: Uint8Array.from({ length: 32 }, (_, index) => index + 4),
			rpId: 'aura.frankfmy.com',
			provider,
			randomBytes: (length) => new Uint8Array(length).fill(7)
		});
		expect(result).toEqual(prfOutput);
		expect(request?.publicKey?.userVerification).toBe('required');
		expect(new Uint8Array(request?.publicKey?.allowCredentials?.[0].id as ArrayBuffer)).toEqual(
			rawId
		);
	});

	it('fails closed when PRF is unavailable or the ceremony is cancelled', async () => {
		const noPrf: CredentialProvider = {
			create: async () => credential(null),
			get: async () => credential(null)
		};
		await expect(
			createPrfCredential({
				accountPubkey: pubkey,
				displayName: 'Artem',
				rpId: 'aura.frankfmy.com',
				provider: noPrf
			})
		).rejects.toThrow(/PRF/i);
		await expect(
			getPrfOutput({
				credentialId: rawId,
				prfSalt: new Uint8Array(32),
				rpId: 'aura.frankfmy.com',
				provider: { create: async () => null, get: async () => null }
			})
		).rejects.toThrow(/cancel|credential/i);
	});

	it('rejects a credential substitution even if it returns PRF bytes', async () => {
		const substituted = credential();
		Object.defineProperty(substituted, 'rawId', { value: new Uint8Array(24).fill(99).buffer });
		await expect(
			getPrfOutput({
				credentialId: rawId,
				prfSalt: new Uint8Array(32),
				rpId: 'aura.frankfmy.com',
				provider: { create: async () => null, get: async () => substituted }
			})
		).rejects.toThrow(/credential/i);
	});
});
