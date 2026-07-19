import { getPublicKey } from 'nostr-tools';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const MAX_ORIGIN_LENGTH = 512;
const ENVELOPE_KEYS = [
	'v',
	'account_pubkey',
	'origin',
	'credential_id',
	'prf_salt',
	'nonce',
	'ciphertext',
	'created_at'
] as const;

export interface KeyEnvelopeV1 {
	v: 1;
	account_pubkey: string;
	origin: string;
	credential_id: string;
	prf_salt: string;
	nonce: string;
	ciphertext: string;
	created_at: number;
}

export interface CreateKeyEnvelopeOptions {
	secretKey: Uint8Array;
	prfOutput: Uint8Array;
	credentialId: Uint8Array;
	prfSalt: Uint8Array;
	origin: string;
	createdAt: number;
	randomBytes?: (length: number) => Uint8Array;
}

export interface UnlockKeyEnvelopeOptions {
	envelope: KeyEnvelopeV1;
	prfOutput: Uint8Array;
	expectedOrigin: string;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string, label: string, maxEncodedLength: number): Uint8Array {
	if (typeof value !== 'string' || value.length > maxEncodedLength) {
		throw new Error(`${label} exceeds the supported size`);
	}
	if (!BASE64URL.test(value) || value.length % 4 === 1) {
		throw new Error(`${label} must be canonical base64url`);
	}
	const padded = value
		.replaceAll('-', '+')
		.replaceAll('_', '/')
		.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
	let binary: string;
	try {
		binary = atob(padded);
	} catch {
		throw new Error(`${label} must be canonical base64url`);
	}
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	if (bytesToBase64Url(bytes) !== value) {
		bytes.fill(0);
		throw new Error(`${label} must be canonical base64url`);
	}
	return bytes;
}

function normalizeOrigin(value: string): string {
	if (typeof value !== 'string' || value.length > MAX_ORIGIN_LENGTH) {
		throw new Error('origin exceeds the supported size');
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('origin is invalid');
	}
	if (value !== url.origin) throw new Error('origin must not contain a path, query or fragment');
	const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
		throw new Error('origin must use https');
	}
	return url.origin;
}

function assertBytes(value: Uint8Array, length: number, label: string): void {
	if (!(value instanceof Uint8Array) || value.length !== length) {
		throw new Error(`${label} must contain exactly ${length} bytes`);
	}
}

function assertSecretKey(secretKey: Uint8Array): string {
	assertBytes(secretKey, 32, 'Nostr secret key');
	try {
		return getPublicKey(secretKey);
	} catch {
		throw new Error('Nostr secret key is not a valid secp256k1 key');
	}
}

function randomBytes(length: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(length));
}

function ownedWebCryptoCopy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
	const copy = new Uint8Array(bytes.length);
	copy.set(bytes);
	return copy;
}

function aad(envelope: Omit<KeyEnvelopeV1, 'nonce' | 'ciphertext'>): Uint8Array {
	return encoder.encode(
		[
			'AURA_KEY_ENVELOPE_V1',
			envelope.origin,
			envelope.account_pubkey,
			envelope.credential_id,
			envelope.prf_salt,
			String(envelope.created_at)
		].join('\0')
	);
}

async function deriveWrappingKey(
	prfOutput: Uint8Array,
	prfSalt: Uint8Array,
	info: Uint8Array
): Promise<CryptoKey> {
	assertBytes(prfOutput, 32, 'WebAuthn PRF output');
	assertBytes(prfSalt, 32, 'WebAuthn PRF salt');
	const prfCopy = ownedWebCryptoCopy(prfOutput);
	const saltCopy = ownedWebCryptoCopy(prfSalt);
	const infoCopy = ownedWebCryptoCopy(info);
	try {
		const material = await crypto.subtle.importKey('raw', prfCopy.buffer, 'HKDF', false, [
			'deriveKey'
		]);
		return await crypto.subtle.deriveKey(
			{
				name: 'HKDF',
				hash: 'SHA-256',
				salt: saltCopy.buffer,
				info: infoCopy.buffer
			},
			material,
			{ name: 'AES-GCM', length: 256 },
			false,
			['encrypt', 'decrypt']
		);
	} finally {
		prfCopy.fill(0);
		saltCopy.fill(0);
		infoCopy.fill(0);
	}
}

function validateEnvelope(value: KeyEnvelopeV1): {
	credentialId: Uint8Array;
	prfSalt: Uint8Array;
	nonce: Uint8Array;
	ciphertext: Uint8Array;
} {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error('key envelope must be an object');
	}
	let fieldCount = 0;
	for (const key in value) {
		if (!Object.hasOwn(value, key)) continue;
		fieldCount += 1;
		if (!(ENVELOPE_KEYS as readonly string[]).includes(key)) {
			throw new Error('unknown key envelope field');
		}
		if (fieldCount > ENVELOPE_KEYS.length) {
			throw new Error('key envelope exceeds supported fields');
		}
	}
	if (fieldCount !== ENVELOPE_KEYS.length) throw new Error('key envelope is incomplete');
	if (value.v !== 1) throw new Error('unsupported key envelope version');
	if (!/^[0-9a-f]{64}$/u.test(value.account_pubkey)) throw new Error('account pubkey is invalid');
	normalizeOrigin(value.origin);
	if (!Number.isSafeInteger(value.created_at) || value.created_at <= 0) {
		throw new Error('key envelope created_at is invalid');
	}
	const credentialId = base64UrlToBytes(value.credential_id, 'credential ID', 1_366);
	if (credentialId.length < 16 || credentialId.length > 1024) {
		throw new Error('credential ID length is invalid');
	}
	const prfSalt = base64UrlToBytes(value.prf_salt, 'PRF salt', 43);
	if (prfSalt.length !== 32) throw new Error('PRF salt must contain exactly 32 bytes');
	const nonce = base64UrlToBytes(value.nonce, 'nonce', 16);
	if (nonce.length !== 12) throw new Error('nonce must contain exactly 12 bytes');
	const ciphertext = base64UrlToBytes(value.ciphertext, 'ciphertext', 64);
	if (ciphertext.length !== 48) throw new Error('ciphertext length is invalid');
	return { credentialId, prfSalt, nonce, ciphertext };
}

export function readKeyEnvelopeCredential(envelope: KeyEnvelopeV1): {
	credentialId: Uint8Array;
	prfSalt: Uint8Array;
} {
	const { credentialId, prfSalt } = validateEnvelope(envelope);
	return {
		credentialId: Uint8Array.from(credentialId),
		prfSalt: Uint8Array.from(prfSalt)
	};
}

export async function createKeyEnvelope(options: CreateKeyEnvelopeOptions): Promise<KeyEnvelopeV1> {
	const accountPubkey = assertSecretKey(options.secretKey);
	assertBytes(options.prfOutput, 32, 'WebAuthn PRF output');
	assertBytes(options.prfSalt, 32, 'WebAuthn PRF salt');
	if (
		!(options.credentialId instanceof Uint8Array) ||
		options.credentialId.length < 16 ||
		options.credentialId.length > 1024
	) {
		throw new Error('credential ID must contain 16 to 1024 bytes');
	}
	if (!Number.isSafeInteger(options.createdAt) || options.createdAt <= 0) {
		throw new Error('createdAt must be a positive integer timestamp');
	}
	const origin = normalizeOrigin(options.origin);
	const base = {
		v: 1 as const,
		account_pubkey: accountPubkey,
		origin,
		credential_id: bytesToBase64Url(options.credentialId),
		prf_salt: bytesToBase64Url(options.prfSalt),
		created_at: options.createdAt
	};
	const nonce = (options.randomBytes ?? randomBytes)(12);
	assertBytes(nonce, 12, 'AES-GCM nonce');
	const key = await deriveWrappingKey(options.prfOutput, options.prfSalt, aad(base));
	const nonceCopy = ownedWebCryptoCopy(nonce);
	const additionalData = ownedWebCryptoCopy(aad(base));
	const secretCopy = ownedWebCryptoCopy(options.secretKey);
	let encrypted: ArrayBuffer;
	try {
		encrypted = await crypto.subtle.encrypt(
			{
				name: 'AES-GCM',
				iv: nonceCopy.buffer,
				additionalData: additionalData.buffer,
				tagLength: 128
			},
			key,
			secretCopy.buffer
		);
	} finally {
		nonceCopy.fill(0);
		additionalData.fill(0);
		secretCopy.fill(0);
	}
	return Object.freeze({
		...base,
		nonce: bytesToBase64Url(nonce),
		ciphertext: bytesToBase64Url(new Uint8Array(encrypted))
	});
}

export async function unlockKeyEnvelope(options: UnlockKeyEnvelopeOptions): Promise<Uint8Array> {
	const { prfSalt, nonce, ciphertext } = validateEnvelope(options.envelope);
	const expectedOrigin = normalizeOrigin(options.expectedOrigin);
	if (options.envelope.origin !== expectedOrigin) {
		throw new Error('key envelope origin does not match this deployment');
	}
	assertBytes(options.prfOutput, 32, 'WebAuthn PRF output');
	const base = {
		v: options.envelope.v,
		account_pubkey: options.envelope.account_pubkey,
		origin: options.envelope.origin,
		credential_id: options.envelope.credential_id,
		prf_salt: options.envelope.prf_salt,
		created_at: options.envelope.created_at
	};
	let secretKey: Uint8Array | undefined;
	try {
		const key = await deriveWrappingKey(options.prfOutput, prfSalt, aad(base));
		const nonceCopy = ownedWebCryptoCopy(nonce);
		const additionalData = ownedWebCryptoCopy(aad(base));
		const ciphertextCopy = ownedWebCryptoCopy(ciphertext);
		let decrypted: ArrayBuffer;
		try {
			decrypted = await crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: nonceCopy.buffer,
					additionalData: additionalData.buffer,
					tagLength: 128
				},
				key,
				ciphertextCopy.buffer
			);
		} finally {
			nonceCopy.fill(0);
			additionalData.fill(0);
			ciphertextCopy.fill(0);
		}
		secretKey = new Uint8Array(decrypted);
		const actualPubkey = assertSecretKey(secretKey);
		if (actualPubkey !== options.envelope.account_pubkey) throw new Error('account mismatch');
		return secretKey;
	} catch (error) {
		secretKey?.fill(0);
		if (error instanceof Error && /origin/u.test(error.message)) throw error;
		throw new Error('key envelope authentication failed; account could not be unlocked');
	}
}
