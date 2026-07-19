import { describe, expect, it } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import {
	createInviteToken,
	generateInviteNonce,
	parseAndVerifyInviteUrl,
	verifyInviteToken,
	type InvitePayload
} from './invite';

const NOW = 1_750_000_000;
const SECRET = '11'.repeat(32);
const hexToBytes = (value: string) =>
	Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
const bytesToHex = (value: Uint8Array) =>
	Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
const decodeBase64Url = (value: string) => {
	const padded = value
		.replaceAll('-', '+')
		.replaceAll('_', '/')
		.padEnd(value.length + ((4 - (value.length % 4)) % 4), '=');
	return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
};
const encodeBase64Url = (value: Uint8Array) =>
	btoa(String.fromCharCode(...value))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/u, '');
const SECRET_BYTES = hexToBytes(SECRET);
const PUBKEY = bytesToHex(schnorr.getPublicKey(SECRET_BYTES));
const ORIGIN = 'https://aura.frankfmy.com';

function payload(overrides: Partial<InvitePayload> = {}): InvitePayload {
	return {
		v: 1,
		action: 'dm',
		origin: ORIGIN,
		issuer_pubkey: PUBKEY,
		issued_at: NOW - 60,
		expires_at: NOW + 3600,
		nonce: 'AQIDBAUGBwgJCgsMDQ4PEA',
		relay_hints: ['wss://relay.one', 'wss://relay.two/path'],
		display: { name: 'Artem', picture: 'https://example.com/avatar.webp' },
		...overrides
	};
}

describe('signed invite envelope', () => {
	it('creates and verifies a real Schnorr-signed invite', () => {
		const token = createInviteToken(payload(), SECRET_BYTES);
		const verified = verifyInviteToken(token, { expectedOrigin: ORIGIN, now: NOW });

		expect(verified.payload.issuer_pubkey).toBe(PUBKEY);
		expect(verified.payload.relay_hints).toEqual(['wss://relay.one', 'wss://relay.two/path']);
		expect(verified.signature).toMatch(/^[0-9a-f]{128}$/);
		expect(verified.digest).toMatch(/^[0-9a-f]{64}$/);
	});

	it('borrows a 32-byte signing key without mutating it', () => {
		const signingKey = SECRET_BYTES.slice();
		const before = signingKey.slice();
		createInviteToken(payload(), signingKey);
		expect(signingKey).toEqual(before);
		expect(() => createInviteToken(payload(), new Uint8Array(31))).toThrow(/32 bytes/i);
	});

	it('accepts only an origin-bound /i#<token> URL', () => {
		const token = createInviteToken(payload(), SECRET_BYTES);
		const verified = parseAndVerifyInviteUrl(`${ORIGIN}/i#${token}`, {
			expectedOrigin: ORIGIN,
			now: NOW
		});
		expect(verified.payload.action).toBe('dm');
		expect(
			parseAndVerifyInviteUrl(`${ORIGIN}/i/#${token}`, {
				expectedOrigin: ORIGIN,
				now: NOW
			}).payload.action
		).toBe('dm');

		expect(() =>
			parseAndVerifyInviteUrl(`https://evil.example/i#${token}`, {
				expectedOrigin: ORIGIN,
				now: NOW
			})
		).toThrow(/origin/i);
		expect(() =>
			parseAndVerifyInviteUrl(`${ORIGIN}/other#${token}`, { expectedOrigin: ORIGIN, now: NOW })
		).toThrow(/path/i);
		expect(() =>
			parseAndVerifyInviteUrl(`${ORIGIN}/i/${token}`, { expectedOrigin: ORIGIN, now: NOW })
		).toThrow(/path|fragment/i);
	});

	it('generates a canonical 16-byte base64url nonce', () => {
		const nonce = generateInviteNonce((length) => Uint8Array.from({ length }, (_, index) => index));
		expect(decodeBase64Url(nonce)).toEqual(Uint8Array.from({ length: 16 }, (_, index) => index));
		expect(() => createInviteToken(payload({ nonce }), SECRET_BYTES)).not.toThrow();
	});

	it('rejects payload tampering', () => {
		const token = createInviteToken(payload(), SECRET_BYTES);
		const [encoded, signature] = token.split('.');
		const raw = JSON.parse(new TextDecoder().decode(decodeBase64Url(encoded)));
		raw.display.name = 'Mallory';
		const tamperedPayload = encodeBase64Url(new TextEncoder().encode(JSON.stringify(raw)));
		const tampered = `${tamperedPayload}.${signature}`;

		expect(() => verifyInviteToken(tampered, { expectedOrigin: ORIGIN, now: NOW })).toThrow(
			/signature/i
		);
	});

	it('rejects invalid origin and time bounds', () => {
		const wrongOrigin = createInviteToken(
			payload({ origin: 'https://evil.example' }),
			SECRET_BYTES
		);
		expect(() => verifyInviteToken(wrongOrigin, { expectedOrigin: ORIGIN, now: NOW })).toThrow(
			/origin/i
		);

		const expired = createInviteToken(payload({ expires_at: NOW - 1 }), SECRET_BYTES);
		expect(() => verifyInviteToken(expired, { expectedOrigin: ORIGIN, now: NOW })).toThrow(
			/expired/i
		);
		expect(() =>
			createInviteToken(payload({ expires_at: NOW + 7 * 24 * 3600 + 1 }), SECRET_BYTES)
		).toThrow(/lifetime/i);

		const future = createInviteToken(
			payload({ issued_at: NOW + 301, expires_at: NOW + 1000 }),
			SECRET_BYTES
		);
		expect(() => verifyInviteToken(future, { expectedOrigin: ORIGIN, now: NOW })).toThrow(
			/future/i
		);
	});

	it('rejects unknown fields', () => {
		const withUnknown = { ...payload(), admin: true } as InvitePayload;
		expect(() => createInviteToken(withUnknown, SECRET_BYTES)).toThrow(/invite.*unsupported/i);
		const nestedUnknown = payload({
			display: { name: 'Artem', role: 'admin' } as InvitePayload['display']
		});
		expect(() => createInviteToken(nestedUnknown, SECRET_BYTES)).toThrow(/display.*unsupported/i);
	});

	it('rejects malformed nonces and unsafe relay hints', () => {
		expect(() => createInviteToken(payload({ nonce: 'short' }), SECRET_BYTES)).toThrow(/nonce/i);
		expect(() =>
			createInviteToken(payload({ relay_hints: ['https://relay.one'] }), SECRET_BYTES)
		).toThrow(/wss/i);
		expect(() =>
			createInviteToken(payload({ relay_hints: ['wss://user:pass@relay.one'] }), SECRET_BYTES)
		).toThrow(/credentials/i);
		for (const relay of ['wss://localhost', 'wss://10.0.0.1', 'wss://[::1]']) {
			expect(() => createInviteToken(payload({ relay_hints: [relay] }), SECRET_BYTES)).toThrow(
				/local or private/i
			);
		}
		expect(() =>
			createInviteToken(
				payload({ relay_hints: ['wss://relay.one', 'wss://relay.one/'] }),
				SECRET_BYTES
			)
		).toThrow(/duplicate/i);
		expect(() =>
			createInviteToken(
				payload({
					relay_hints: ['wss://a.one', 'wss://b.one', 'wss://c.one', 'wss://d.one', 'wss://e.one']
				}),
				SECRET_BYTES
			)
		).toThrow(/at most 4/i);
	});

	it('rejects invalid display claims and malformed tokens', () => {
		expect(() =>
			createInviteToken(payload({ display: { name: 'x'.repeat(81) } }), SECRET_BYTES)
		).toThrow(/display name/i);
		expect(() =>
			createInviteToken(payload({ display: { name: 'e\u0301' } }), SECRET_BYTES)
		).toThrow(/normalized/i);
		expect(() =>
			createInviteToken(payload({ display: { picture: 'http://example.com/a.png' } }), SECRET_BYTES)
		).toThrow(/picture/i);
		expect(() => verifyInviteToken('not-a-token', { expectedOrigin: ORIGIN, now: NOW })).toThrow(
			/format/i
		);
		expect(() =>
			verifyInviteToken(`${'a'.repeat(5000)}.${'b'.repeat(128)}`, {
				expectedOrigin: ORIGIN,
				now: NOW
			})
		).toThrow(/too large/i);
	});
});
