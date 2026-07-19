const HEX_32 = /^[0-9a-f]{64}$/u;

interface PrfExtensionInput {
	prf: { eval: { first: ArrayBuffer } };
}

interface PrfExtensionOutput {
	prf?: { enabled?: boolean; results?: { first?: ArrayBuffer } };
}

export interface CredentialProvider {
	create(options: CredentialCreationOptions): Promise<PublicKeyCredential | null>;
	get(options: CredentialRequestOptions): Promise<PublicKeyCredential | null>;
}

export interface PrfCredentialResult {
	credentialId: Uint8Array;
	prfSalt: Uint8Array;
	prfOutput: Uint8Array;
}

export interface CreatePrfCredentialOptions {
	accountPubkey: string;
	displayName: string;
	rpId: string;
	provider?: CredentialProvider;
	randomBytes?: (length: number) => Uint8Array;
}

export interface GetPrfOutputOptions {
	credentialId: Uint8Array;
	prfSalt: Uint8Array;
	rpId: string;
	provider?: CredentialProvider;
	randomBytes?: (length: number) => Uint8Array;
}

function defaultProvider(): CredentialProvider {
	if (typeof navigator === 'undefined' || !navigator.credentials) {
		throw new Error('WebAuthn is not available on this platform');
	}
	return {
		create: async (options) =>
			(await navigator.credentials.create(options)) as PublicKeyCredential | null,
		get: async (options) => (await navigator.credentials.get(options)) as PublicKeyCredential | null
	};
}

function randomBytes(length: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(length));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
	return Uint8Array.from(bytes).buffer;
}

function hexToBytes(value: string): Uint8Array {
	return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

function assertBytes(value: Uint8Array, minimum: number, maximum: number, label: string): void {
	if (!(value instanceof Uint8Array) || value.length < minimum || value.length > maximum) {
		throw new Error(`${label} length is invalid`);
	}
}

function validateRpId(value: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 253) {
		throw new Error('WebAuthn RP ID is invalid');
	}
	let url: URL;
	try {
		url = new URL(`https://${value}`);
	} catch {
		throw new Error('WebAuthn RP ID is invalid');
	}
	if (url.hostname !== value || url.pathname !== '/' || url.port || url.username || url.password) {
		throw new Error('WebAuthn RP ID must be a hostname');
	}
	return value;
}

function extractPrfOutput(output: PrfExtensionOutput): Uint8Array {
	const first = output.prf?.results?.first;
	if (!(first instanceof ArrayBuffer)) {
		throw new Error('WebAuthn PRF is not available for this credential');
	}
	const bytes = new Uint8Array(first);
	try {
		if (bytes.length !== 32) throw new Error('WebAuthn PRF output must contain exactly 32 bytes');
		return Uint8Array.from(bytes);
	} finally {
		bytes.fill(0);
	}
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.length !== right.length) return false;
	let difference = 0;
	for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
	return difference === 0;
}

export async function createPrfCredential(
	options: CreatePrfCredentialOptions
): Promise<PrfCredentialResult> {
	if (!HEX_32.test(options.accountPubkey)) throw new Error('account pubkey is invalid');
	if (
		typeof options.displayName !== 'string' ||
		options.displayName.trim() !== options.displayName ||
		options.displayName.length < 1 ||
		Array.from(options.displayName).length > 80 ||
		options.displayName.normalize('NFC') !== options.displayName
	) {
		throw new Error('display name must be 1 to 80 trimmed NFC characters');
	}
	const rpId = validateRpId(options.rpId);
	const nextBytes = options.randomBytes ?? randomBytes;
	const challenge = nextBytes(32);
	const prfSalt = nextBytes(32);
	const provider = options.provider ?? defaultProvider();
	assertBytes(challenge, 32, 32, 'WebAuthn challenge');
	assertBytes(prfSalt, 32, 32, 'WebAuthn PRF salt');

	const credential = await provider.create({
		publicKey: {
			challenge: toArrayBuffer(challenge),
			rp: { id: rpId, name: 'AURA' },
			user: {
				id: toArrayBuffer(hexToBytes(options.accountPubkey)),
				name: options.accountPubkey,
				displayName: options.displayName
			},
			pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
			timeout: 60_000,
			attestation: 'none',
			authenticatorSelection: {
				authenticatorAttachment: 'platform',
				residentKey: 'required',
				requireResidentKey: true,
				userVerification: 'required'
			},
			extensions: {
				prf: { eval: { first: toArrayBuffer(prfSalt) } }
			} as AuthenticationExtensionsClientInputs & PrfExtensionInput
		}
	});
	if (!credential) throw new Error('WebAuthn credential creation was cancelled');
	const credentialId = new Uint8Array(credential.rawId);
	assertBytes(credentialId, 16, 1024, 'WebAuthn credential ID');
	const extensionOutput = credential.getClientExtensionResults() as unknown as PrfExtensionOutput;
	const prfOutput = extensionOutput.prf?.results?.first
		? extractPrfOutput(extensionOutput)
		: extensionOutput.prf?.enabled
			? await getPrfOutput({
					credentialId,
					prfSalt,
					rpId,
					provider,
					randomBytes: nextBytes
				})
			: (() => {
					throw new Error('WebAuthn PRF is not available for this credential');
				})();
	return {
		credentialId: Uint8Array.from(credentialId),
		prfSalt: Uint8Array.from(prfSalt),
		prfOutput
	};
}

export async function getPrfOutput(options: GetPrfOutputOptions): Promise<Uint8Array> {
	assertBytes(options.credentialId, 16, 1024, 'WebAuthn credential ID');
	assertBytes(options.prfSalt, 32, 32, 'WebAuthn PRF salt');
	const rpId = validateRpId(options.rpId);
	const nextBytes = options.randomBytes ?? randomBytes;
	const challenge = nextBytes(32);
	assertBytes(challenge, 32, 32, 'WebAuthn challenge');

	const credential = await (options.provider ?? defaultProvider()).get({
		publicKey: {
			challenge: toArrayBuffer(challenge),
			rpId,
			allowCredentials: [{ type: 'public-key', id: toArrayBuffer(options.credentialId) }],
			userVerification: 'required',
			timeout: 60_000,
			extensions: {
				prf: { eval: { first: toArrayBuffer(options.prfSalt) } }
			} as AuthenticationExtensionsClientInputs & PrfExtensionInput
		}
	});
	if (!credential) throw new Error('WebAuthn credential request was cancelled');
	if (!equalBytes(new Uint8Array(credential.rawId), options.credentialId)) {
		throw new Error('WebAuthn returned an unexpected credential');
	}
	const extensionOutput = credential.getClientExtensionResults() as unknown as PrfExtensionOutput;
	return extractPrfOutput(extensionOutput);
}

export async function hasPlatformWebAuthn(): Promise<boolean> {
	if (typeof PublicKeyCredential === 'undefined') return false;
	if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable !== 'function')
		return false;
	try {
		return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
	} catch {
		return false;
	}
}
