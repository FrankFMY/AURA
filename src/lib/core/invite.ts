import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';

const DOMAIN_SEPARATOR = 'AURA_INVITE_V1\0';
const MAX_TOKEN_LENGTH = 4_096;
const MAX_LIFETIME_SECONDS = 7 * 24 * 60 * 60;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const HEX_32 = /^[0-9a-f]{64}$/;
const HEX_64 = /^[0-9a-f]{128}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

export interface InviteDisplayClaim {
	name?: string;
	picture?: string;
}

export interface InvitePayload {
	v: 1;
	action: 'dm';
	origin: string;
	issuer_pubkey: string;
	issued_at: number;
	expires_at: number;
	nonce: string;
	relay_hints: string[];
	display?: InviteDisplayClaim;
}

export interface InviteVerificationOptions {
	expectedOrigin: string;
	now: number;
}

export interface VerifiedInvite {
	payload: InvitePayload;
	signature: string;
	digest: string;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(value: string): Uint8Array {
	if (value.length % 2 !== 0 || !/^[0-9a-f]+$/u.test(value)) {
		throw new Error('hex value is not canonical lowercase hex');
	}
	return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

export function generateInviteNonce(
	randomBytes: (length: number) => Uint8Array = (length) => {
		const bytes = new Uint8Array(length);
		globalThis.crypto.getRandomValues(bytes);
		return bytes;
	}
): string {
	const bytes = randomBytes(16);
	if (!(bytes instanceof Uint8Array) || bytes.length !== 16) {
		throw new Error('invite nonce source must return exactly 16 bytes');
	}
	return bytesToBase64Url(Uint8Array.from(bytes));
}

function base64UrlToBytes(value: string): Uint8Array {
	if (!BASE64URL.test(value) || value.length % 4 === 1) {
		throw new Error('invite payload is not canonical base64url');
	}
	const padded = value
		.replaceAll('-', '+')
		.replaceAll('_', '/')
		.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
	let binary: string;
	try {
		binary = atob(padded);
	} catch {
		throw new Error('invite payload is not valid base64url');
	}
	const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	if (bytesToBase64Url(bytes) !== value) {
		throw new Error('invite payload is not canonical base64url');
	}
	return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	required: readonly string[],
	label: string
): void {
	const allowedSet = new Set(allowed);
	const unknown = Object.keys(value).filter((key) => !allowedSet.has(key));
	if (unknown.length > 0) {
		throw new Error(`unknown ${label} field: ${unknown.sort().join(', ')}`);
	}
	const missing = required.filter((key) => !(key in value));
	if (missing.length > 0) {
		throw new Error(`missing ${label} field: ${missing.join(', ')}`);
	}
}

function assertSafeTimestamp(value: unknown, label: string): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new Error(`${label} must be a positive integer timestamp`);
	}
}

function normalizedExpectedOrigin(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('expected origin is invalid');
	}
	if (value !== url.origin) {
		throw new Error('expected origin must not include a path, query or fragment');
	}
	const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
		throw new Error('expected origin must use https');
	}
	return url.origin;
}

function isPrivateIpv4(hostname: string): boolean {
	const parts = hostname.split('.');
	if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/u.test(part))) return false;
	const octets = parts.map(Number);
	if (octets.some((octet) => octet > 255)) return true;
	const [a, b, c] = octets;
	return (
		a === 0 ||
		a === 10 ||
		a === 127 ||
		(a === 100 && b >= 64 && b <= 127) ||
		(a === 169 && b === 254) ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 0 && c === 0) ||
		(a === 192 && b === 0 && c === 2) ||
		(a === 192 && b === 168) ||
		(a === 198 && (b === 18 || b === 19)) ||
		(a === 198 && b === 51 && c === 100) ||
		(a === 203 && b === 0 && c === 113) ||
		a >= 224
	);
}

function isPrivateOrLocalHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/gu, '');
	if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
	if (isPrivateIpv4(host)) return true;
	if (!host.includes(':')) return false;
	if (host === '::' || host === '::1') return true;
	if (/^(fc|fd)/u.test(host) || /^fe[89ab]/u.test(host) || /^ff/u.test(host)) return true;
	if (host.startsWith('::ffff:')) return isPrivateIpv4(host.slice('::ffff:'.length));
	return false;
}

function assertRelayHints(value: unknown): asserts value is string[] {
	if (!Array.isArray(value) || value.length > 4) {
		throw new Error('relay_hints must contain at most 4 entries');
	}
	const normalized = new Set<string>();
	for (const hint of value) {
		if (typeof hint !== 'string' || hint.length === 0 || hint.length > 256) {
			throw new Error('relay hint must be a non-empty string no longer than 256 characters');
		}
		let url: URL;
		try {
			url = new URL(hint);
		} catch {
			throw new Error('relay hint must be a valid wss URL');
		}
		if (url.protocol !== 'wss:') throw new Error('relay hint must use wss');
		if (url.username || url.password) throw new Error('relay hint must not contain credentials');
		if (url.hash) throw new Error('relay hint must not contain a fragment');
		if (isPrivateOrLocalHostname(url.hostname)) {
			throw new Error('relay hint must not target a local or private address');
		}
		if (normalized.has(url.href)) throw new Error('duplicate relay hint');
		normalized.add(url.href);
	}
}

function assertDisplay(value: unknown): asserts value is InviteDisplayClaim {
	if (!isRecord(value)) throw new Error('display must be an object');
	assertExactKeys(value, ['name', 'picture'], [], 'display');
	if (Object.keys(value).length === 0) throw new Error('display must not be empty');

	if ('name' in value) {
		if (
			typeof value.name !== 'string' ||
			value.name.length === 0 ||
			Array.from(value.name).length > 80 ||
			value.name !== value.name.trim()
		) {
			throw new Error('display name must be 1 to 80 trimmed characters');
		}
		if (value.name.normalize('NFC') !== value.name) {
			throw new Error('display name must be NFC normalized');
		}
	}
	if ('picture' in value) {
		if (typeof value.picture !== 'string' || value.picture.length > 2_048) {
			throw new Error('display picture must be an https URL');
		}
		let url: URL;
		try {
			url = new URL(value.picture);
		} catch {
			throw new Error('display picture must be an https URL');
		}
		if (url.protocol !== 'https:' || url.username || url.password) {
			throw new Error('display picture must be an https URL without credentials');
		}
	}
}

function validatePayload(
	value: unknown,
	options: InviteVerificationOptions
): asserts value is InvitePayload {
	if (!isRecord(value)) throw new Error('invite payload must be an object');
	assertExactKeys(
		value,
		[
			'v',
			'action',
			'origin',
			'issuer_pubkey',
			'issued_at',
			'expires_at',
			'nonce',
			'relay_hints',
			'display'
		],
		['v', 'action', 'origin', 'issuer_pubkey', 'issued_at', 'expires_at', 'nonce', 'relay_hints'],
		'invite'
	);

	if (value.v !== 1) throw new Error('unsupported invite version');
	if (value.action !== 'dm') throw new Error('unsupported invite action');
	const expectedOrigin = normalizedExpectedOrigin(options.expectedOrigin);
	if (value.origin !== expectedOrigin)
		throw new Error('invite origin does not match this deployment');
	if (typeof value.issuer_pubkey !== 'string' || !HEX_32.test(value.issuer_pubkey)) {
		throw new Error('issuer_pubkey must be canonical lowercase x-only hex');
	}

	assertSafeTimestamp(value.issued_at, 'issued_at');
	assertSafeTimestamp(value.expires_at, 'expires_at');
	if (value.expires_at <= value.issued_at) throw new Error('expires_at must be after issued_at');
	if (value.expires_at - value.issued_at > MAX_LIFETIME_SECONDS) {
		throw new Error('invite lifetime must not exceed 7 days');
	}
	if (value.issued_at > options.now + MAX_CLOCK_SKEW_SECONDS) {
		throw new Error('invite was issued too far in the future');
	}
	if (value.expires_at <= options.now) throw new Error('invite has expired');

	if (typeof value.nonce !== 'string') throw new Error('nonce must be base64url');
	let nonceBytes: Uint8Array;
	try {
		nonceBytes = base64UrlToBytes(value.nonce);
	} catch {
		throw new Error('nonce must be canonical base64url containing exactly 128 bits');
	}
	if (nonceBytes.length !== 16) throw new Error('nonce must contain exactly 128 bits');

	assertRelayHints(value.relay_hints);
	if ('display' in value) assertDisplay(value.display);
}

function canonicalize(value: unknown): string {
	if (value === null) return 'null';
	if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value))
			throw new Error('canonical invite numbers must be safe integers');
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
	if (isRecord(value)) {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
			.join(',')}}`;
	}
	throw new Error('invite contains a non-canonical value');
}

function digestPayload(payload: InvitePayload): Uint8Array {
	return sha256(encoder.encode(`${DOMAIN_SEPARATOR}${canonicalize(payload)}`));
}

function parseToken(token: string): { payload: unknown; signature: string } {
	if (typeof token !== 'string' || token.length > MAX_TOKEN_LENGTH) {
		throw new Error('invite token is too large');
	}
	const parts = token.split('.');
	if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
		throw new Error('invite token format must be payload.signature');
	}
	const [encoded, signature] = parts;
	if (!HEX_64.test(signature)) throw new Error('invite signature format is invalid');

	let json: string;
	try {
		json = decoder.decode(base64UrlToBytes(encoded));
	} catch (error) {
		if (error instanceof Error && /base64url/u.test(error.message)) throw error;
		throw new Error('invite payload is not valid UTF-8');
	}
	let payload: unknown;
	try {
		payload = JSON.parse(json);
	} catch {
		throw new Error('invite payload is not valid JSON');
	}
	return { payload, signature };
}

export function createInviteToken(payload: InvitePayload, secretKey: string): string {
	validatePayload(payload, { expectedOrigin: payload.origin, now: payload.issued_at });
	if (!HEX_32.test(secretKey)) throw new Error('secret key must be canonical lowercase hex');
	const secretKeyBytes = hexToBytes(secretKey);
	const actualPubkey = bytesToHex(schnorr.getPublicKey(secretKeyBytes));
	if (actualPubkey !== payload.issuer_pubkey) {
		throw new Error('secret key does not match issuer_pubkey');
	}
	const digest = digestPayload(payload);
	const signature = bytesToHex(schnorr.sign(digest, secretKeyBytes));
	const encoded = bytesToBase64Url(encoder.encode(canonicalize(payload)));
	const token = `${encoded}.${signature}`;
	if (token.length > MAX_TOKEN_LENGTH) throw new Error('invite token is too large');
	return token;
}

export function verifyInviteToken(
	token: string,
	options: InviteVerificationOptions
): VerifiedInvite {
	if (!Number.isSafeInteger(options.now) || options.now <= 0) {
		throw new Error('verification time must be a positive integer timestamp');
	}
	const parsed = parseToken(token);
	validatePayload(parsed.payload, options);
	const digest = digestPayload(parsed.payload);
	let valid = false;
	try {
		valid = schnorr.verify(
			hexToBytes(parsed.signature),
			digest,
			hexToBytes(parsed.payload.issuer_pubkey)
		);
	} catch {
		valid = false;
	}
	if (!valid) throw new Error('invite signature verification failed');
	return Object.freeze({
		payload: Object.freeze(parsed.payload),
		signature: parsed.signature,
		digest: bytesToHex(digest)
	});
}

export function parseAndVerifyInviteUrl(
	inviteUrl: string,
	options: InviteVerificationOptions
): VerifiedInvite {
	let url: URL;
	try {
		url = new URL(inviteUrl);
	} catch {
		throw new Error('invite URL is invalid');
	}
	const expectedOrigin = normalizedExpectedOrigin(options.expectedOrigin);
	if (url.origin !== expectedOrigin)
		throw new Error('invite URL origin does not match this deployment');
	if (url.search) throw new Error('invite URL must not contain a query');
	if (url.pathname !== '/i' && url.pathname !== '/i/') {
		throw new Error('invite URL path must be /i or /i/');
	}
	if (url.hash.length <= 1) throw new Error('invite URL token must be carried in the fragment');
	return verifyInviteToken(url.hash.slice(1), options);
}
