import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	finalizeEvent,
	generateSecretKey,
	getEventHash,
	getPublicKey,
	nip44,
	type Event,
	type UnsignedEvent
} from 'nostr-tools';
import {
	createDeviceLinkRequest,
	createDeviceLinkTransfer,
	parseAndVerifyDeviceLinkUrl,
	unwrapDeviceLinkTransfer
} from './device-link';

const NOW = 1_784_400_000;
const ORIGIN = 'https://aura.frankfmy.com';
const RELAYS = ['wss://relay.damus.io/', 'wss://nos.lol/'];

afterEach(() => vi.restoreAllMocks());

function setup() {
	const receiverSecretKey = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
	const accountSecretKey = Uint8Array.from({ length: 32 }, (_, index) => 64 - index);
	const wrapperSecretKey = new Uint8Array(32).fill(9);
	const request = createDeviceLinkRequest({
		origin: ORIGIN,
		relayHints: RELAYS,
		issuedAt: NOW,
		expiresAt: NOW + 300,
		receiverSecretKey,
		requestIdBytes: new Uint8Array(32).fill(7)
	});
	const verified = parseAndVerifyDeviceLinkUrl(`${ORIGIN}/link/#${request.token}`, {
		expectedOrigin: ORIGIN,
		now: NOW + 1
	});
	const wrap = createDeviceLinkTransfer({
		request: verified,
		accountSecretKey,
		displayName: 'Artem',
		dmRelays: RELAYS,
		createdAt: NOW + 2,
		wrapperSecretKey,
		sealCreatedAt: NOW - 7,
		wrapCreatedAt: NOW - 3
	});
	return { receiverSecretKey, accountSecretKey, wrapperSecretKey, request, verified, wrap };
}

function encryptBetween(plaintext: string, secretKey: Uint8Array, pubkey: string): string {
	const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);
	try {
		return nip44.v2.encrypt(plaintext, conversationKey);
	} finally {
		conversationKey.fill(0);
	}
}

function decryptBetween(ciphertext: string, secretKey: Uint8Array, pubkey: string): string {
	const conversationKey = nip44.v2.utils.getConversationKey(secretKey, pubkey);
	try {
		return nip44.v2.decrypt(ciphertext, conversationKey);
	} finally {
		conversationKey.fill(0);
	}
}

function rewrapSeal(
	seal: Event,
	wrapperSecretKey: Uint8Array,
	receiverPubkey: string,
	expiresAt: number
): Event {
	return finalizeEvent(
		{
			kind: 1059,
			tags: [
				['p', receiverPubkey],
				['expiration', String(expiresAt)]
			],
			created_at: NOW - 3,
			content: encryptBetween(JSON.stringify(seal), wrapperSecretKey, receiverPubkey)
		},
		wrapperSecretKey
	);
}

function eventToken(event: Event): string {
	const bytes = new TextEncoder().encode(JSON.stringify(event));
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/u, '');
}

describe('one-time device linking protocol', () => {
	it('round-trips the exact identity through a signed NIP-59 transfer', () => {
		const { receiverSecretKey, accountSecretKey, verified, wrap } = setup();
		const imported = unwrapDeviceLinkTransfer({
			wrap,
			receiverSecretKey,
			request: verified,
			now: NOW + 3
		});

		expect(imported.requestId).toBe(verified.payload.request_id);
		expect(imported.displayName).toBe('Artem');
		expect(imported.dmRelays).toEqual(RELAYS);
		expect(imported.accountSecretKey).toEqual(accountSecretKey);
		expect(getPublicKey(imported.accountSecretKey)).toBe(imported.accountPubkey);
		expect(imported.accountPubkey).toBe(getPublicKey(accountSecretKey));
	});

	it('zeroizes every NIP-44 conversation key after encryption and decryption', () => {
		const derivedKeys: Uint8Array[] = [];
		const deriveConversationKey = nip44.v2.utils.getConversationKey;
		vi.spyOn(nip44.v2.utils, 'getConversationKey').mockImplementation((secretKey, pubkey) => {
			const derived = deriveConversationKey(secretKey, pubkey);
			derivedKeys.push(derived);
			return derived;
		});

		const { receiverSecretKey, verified, wrap } = setup();
		const imported = unwrapDeviceLinkTransfer({
			wrap,
			receiverSecretKey,
			request: verified,
			now: NOW + 3
		});

		expect(derivedKeys).toHaveLength(4);
		for (const derived of derivedKeys) expect(derived).toEqual(new Uint8Array(32));
		imported.accountSecretKey.fill(0);
	});

	it('keeps identity and custody data out of the relay-visible wrapper', () => {
		const { accountSecretKey, wrap } = setup();
		const visible = JSON.stringify(wrap);
		const encodedSecret = btoa(String.fromCharCode(...accountSecretKey))
			.replaceAll('+', '-')
			.replaceAll('/', '_')
			.replace(/=+$/u, '');

		expect(visible).not.toContain(getPublicKey(accountSecretKey));
		expect(visible).not.toContain(encodedSecret);
		expect(visible).not.toContain('Artem');
		expect(visible).not.toContain('relay.damus.io');
		expect(wrap.kind).toBe(1059);
		expect(wrap.tags[0]).toEqual(['p', expect.stringMatching(/^[0-9a-f]{64}$/u)]);
	});

	it('rejects tampering, the wrong receiver and a mismatched request', () => {
		const { receiverSecretKey, verified, wrap } = setup();
		const tampered = structuredClone(wrap);
		tampered.content = `${tampered.content.slice(0, -1)}${tampered.content.endsWith('A') ? 'B' : 'A'}`;
		expect(() =>
			unwrapDeviceLinkTransfer({ wrap: tampered, receiverSecretKey, request: verified, now: NOW + 3 })
		).toThrow(/signature|event id|invalid/i);

		expect(() =>
			unwrapDeviceLinkTransfer({
				wrap,
				receiverSecretKey: generateSecretKey(),
				request: verified,
				now: NOW + 3
			})
		).toThrow();

		const other = createDeviceLinkRequest({
			origin: ORIGIN,
			relayHints: RELAYS,
			issuedAt: NOW,
			expiresAt: NOW + 300,
			receiverSecretKey,
			requestIdBytes: new Uint8Array(32).fill(8)
		});
		const otherVerified = parseAndVerifyDeviceLinkUrl(`${ORIGIN}/link#${other.token}`, {
			expectedOrigin: ORIGIN,
			now: NOW + 1
		});
		expect(() =>
			unwrapDeviceLinkTransfer({
				wrap,
				receiverSecretKey,
				request: otherVerified,
				now: NOW + 3
			})
		).toThrow(/request|recipient/i);
	});

	it('rejects independently signed request ID and exact-schema tampering', () => {
		const { receiverSecretKey, request } = setup();
		const payload = JSON.parse(request.event.content) as Record<string, unknown>;
		const extraFieldRequest = finalizeEvent(
			{
				kind: request.event.kind,
				tags: [],
				created_at: request.event.created_at,
				content: JSON.stringify({ ...payload, unexpected: true })
			},
			receiverSecretKey
		);
		expect(() =>
			parseAndVerifyDeviceLinkUrl(`${ORIGIN}/link/#${eventToken(extraFieldRequest)}`, {
				expectedOrigin: ORIGIN,
				now: NOW + 1
			})
		).toThrow(/unknown device link request field/i);

		const invalidIdRequest = { ...request.event, id: '0'.repeat(64) } as Event;
		expect(() =>
			parseAndVerifyDeviceLinkUrl(`${ORIGIN}/link/#${eventToken(invalidIdRequest)}`, {
				expectedOrigin: ORIGIN,
				now: NOW + 1
			})
		).toThrow(/signature|event id/i);
	});

	it('rejects seal signature, rumor ID and rumor schema tampering at their own layers', () => {
		const { receiverSecretKey, accountSecretKey, wrapperSecretKey, verified, wrap } = setup();
		const receiverPubkey = verified.event.pubkey;
		const seal = JSON.parse(
			decryptBetween(wrap.content, receiverSecretKey, wrap.pubkey)
		) as Event;
		const invalidSeal = {
			...seal,
			sig: `${seal.sig.slice(0, -1)}${seal.sig.endsWith('0') ? '1' : '0'}`
		};
		expect(() =>
			unwrapDeviceLinkTransfer({
				wrap: rewrapSeal(invalidSeal, wrapperSecretKey, receiverPubkey, verified.payload.expires_at),
				receiverSecretKey,
				request: verified,
				now: NOW + 3
			})
		).toThrow(/seal signature|event id/i);

		for (const [malformedSeal, expectedError] of [
			[{ ...seal, id: '0'.repeat(64) } as Event, /seal signature|event id/i],
			[{ ...seal, unexpected: true } as unknown as Event, /unknown device link seal field/i]
		] as const) {
			expect(() =>
				unwrapDeviceLinkTransfer({
					wrap: rewrapSeal(
						malformedSeal,
						wrapperSecretKey,
						receiverPubkey,
						verified.payload.expires_at
					),
					receiverSecretKey,
					request: verified,
					now: NOW + 3
				})
			).toThrow(expectedError);
		}

		const rumor = JSON.parse(
			decryptBetween(seal.content, receiverSecretKey, seal.pubkey)
		) as Record<string, unknown>;
		for (const malformedRumor of [
			{ ...rumor, id: '0'.repeat(64) },
			{ ...rumor, unexpected: true }
		]) {
			const resignedSeal = finalizeEvent(
				{
					kind: 13,
					tags: [],
					created_at: seal.created_at,
					content: encryptBetween(JSON.stringify(malformedRumor), accountSecretKey, receiverPubkey)
				},
				accountSecretKey
			);
			expect(() =>
				unwrapDeviceLinkTransfer({
					wrap: rewrapSeal(
						resignedSeal,
						wrapperSecretKey,
						receiverPubkey,
						verified.payload.expires_at
					),
					receiverSecretKey,
					request: verified,
					now: NOW + 3
				})
			).toThrow(/rumor event id|unknown device link rumor field/i);
		}
	});

	it('rejects expired, overlong, cross-origin, query and malformed requests', () => {
		const { request } = setup();
		expect(() =>
			parseAndVerifyDeviceLinkUrl(`${ORIGIN}/link#${request.token}`, {
				expectedOrigin: ORIGIN,
				now: NOW + 301
			})
		).toThrow(/expired/i);
		expect(() =>
			parseAndVerifyDeviceLinkUrl(`https://evil.example/link#${request.token}`, {
				expectedOrigin: ORIGIN,
				now: NOW
			})
		).toThrow(/origin/i);
		expect(() =>
			parseAndVerifyDeviceLinkUrl(`${ORIGIN}/link?forward=evil#${request.token}`, {
				expectedOrigin: ORIGIN,
				now: NOW
			})
		).toThrow(/query/i);
		expect(() =>
			createDeviceLinkRequest({
				origin: ORIGIN,
				relayHints: RELAYS,
				issuedAt: NOW,
				expiresAt: NOW + 301,
				receiverSecretKey: generateSecretKey()
			})
		).toThrow(/lifetime/i);
		expect(() =>
			createDeviceLinkRequest({
				origin: ORIGIN,
				relayHints: ['wss://localhost/'],
				issuedAt: NOW,
				expiresAt: NOW + 300,
				receiverSecretKey: generateSecretKey()
			})
		).toThrow(/local|private/i);
	});

	it('zeroizes and rejects an invalid transferred scalar before it can escape', () => {
		const { receiverSecretKey, accountSecretKey, verified } = setup();
		const differentSecret = new Uint8Array(32).fill(0xff);
		let invalidScalarWasZeroized = false;
		const nativeFill = Uint8Array.prototype.fill;
		vi.spyOn(Uint8Array.prototype, 'fill').mockImplementation(function (
			this: Uint8Array,
			value: number,
			start?: number,
			end?: number
		) {
			if (this.length === 32 && this.every((byte) => byte === 0xff) && value === 0) {
				invalidScalarWasZeroized = true;
			}
			return nativeFill.call(this, value, start, end);
		});
		const accountPubkey = getPublicKey(accountSecretKey);
		const receiverPubkey = verified.event.pubkey;
		const encodedDifferentSecret = btoa(String.fromCharCode(...differentSecret))
			.replaceAll('+', '-')
			.replaceAll('/', '_')
			.replace(/=+$/u, '');
		const rumorBase: UnsignedEvent = {
			kind: 24_243,
			pubkey: accountPubkey,
			created_at: NOW + 2,
			tags: [['p', receiverPubkey]],
			content: JSON.stringify({
				v: 1,
				action: 'link-device-transfer',
				request_id: verified.payload.request_id,
				receiver_pubkey: receiverPubkey,
				account_secret: encodedDifferentSecret,
				display_name: 'Artem',
				dm_relays: RELAYS,
				expires_at: verified.payload.expires_at
			})
		};
		const rumor = { ...rumorBase, id: getEventHash(rumorBase) };
		const seal = finalizeEvent(
			{
				kind: 13,
				tags: [],
				created_at: NOW - 7,
				content: encryptBetween(JSON.stringify(rumor), accountSecretKey, receiverPubkey)
			},
			accountSecretKey
		);
		const wrapperSecret = new Uint8Array(32).fill(10);
		const wrap = finalizeEvent(
			{
				kind: 1059,
				tags: [
					['p', receiverPubkey],
					['expiration', String(verified.payload.expires_at)]
				],
				created_at: NOW - 3,
				content: encryptBetween(JSON.stringify(seal), wrapperSecret, receiverPubkey)
			},
			wrapperSecret
		);
		expect(() =>
			unwrapDeviceLinkTransfer({ wrap, receiverSecretKey, request: verified, now: NOW + 3 })
		).toThrow(/identity|secret/i);
		expect(invalidScalarWasZeroized).toBe(true);
	});

	it('does not mutate borrowed source or receiver key buffers', () => {
		const { receiverSecretKey, accountSecretKey, verified } = setup();
		const receiverBefore = receiverSecretKey.slice();
		const accountBefore = accountSecretKey.slice();
		const wrap = createDeviceLinkTransfer({
			request: verified,
			accountSecretKey,
			displayName: 'Artem',
			dmRelays: RELAYS,
			createdAt: NOW + 2
		});
		unwrapDeviceLinkTransfer({ wrap, receiverSecretKey, request: verified, now: NOW + 3 });
		expect(receiverSecretKey).toEqual(receiverBefore);
		expect(accountSecretKey).toEqual(accountBefore);
	});
});
