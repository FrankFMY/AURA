import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	finalizeEvent,
	generateSecretKey,
	getEventHash,
	getPublicKey,
	nip44,
	verifyEvent,
	type UnsignedEvent,
	type VerifiedEvent
} from 'nostr-tools';
import { createWrappedDirectMessage, unwrapDirectMessage, type Rumor } from './gift-wrap';

const NOW = 1_750_000_000;
const senderSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const recipientSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 33);
const attackerSecret = Uint8Array.from({ length: 32 }, (_, index) => 255 - index);
const senderPubkey = getPublicKey(senderSecret);
const recipientPubkey = getPublicKey(recipientSecret);

afterEach(() => vi.restoreAllMocks());

function wrapRumor(
	rumor: Omit<Rumor, 'id'> & { id?: string },
	sealSecret: Uint8Array = senderSecret,
	outerCreatedAt = NOW - 20
): VerifiedEvent {
	const sealKey = nip44.v2.utils.getConversationKey(sealSecret, recipientPubkey);
	const seal = finalizeEvent(
		{
			kind: 13,
			tags: [],
			created_at: NOW - 10,
			content: nip44.v2.encrypt(JSON.stringify(rumor), sealKey)
		},
		sealSecret
	);
	const ephemeral = generateSecretKey();
	const wrapKey = nip44.v2.utils.getConversationKey(ephemeral, recipientPubkey);
	return finalizeEvent(
		{
			kind: 1059,
			tags: [['p', recipientPubkey]],
			created_at: outerCreatedAt,
			content: nip44.v2.encrypt(JSON.stringify(seal), wrapKey)
		},
		ephemeral
	);
}

describe('NIP-17/NIP-59 direct messages', () => {
	it('zeroizes generated wrapper scalars and every derived NIP-44 key', () => {
		const ephemeralKeys = [generateSecretKey(), generateSecretKey()];
		const ownedEphemerals = [...ephemeralKeys];
		const derivedKeys: Uint8Array[] = [];
		const deriveConversationKey = nip44.v2.utils.getConversationKey;
		vi.spyOn(nip44.v2.utils, 'getConversationKey').mockImplementation((secretKey, pubkey) => {
			const derived = deriveConversationKey(secretKey, pubkey);
			derivedKeys.push(derived);
			return derived;
		});

		const result = createWrappedDirectMessage({
			content: 'Custody cleanup.',
			senderSecretKey: senderSecret,
			recipientPubkey,
			createdAt: NOW,
			generateEphemeralKey: () => ephemeralKeys.shift()!
		});
		unwrapDirectMessage({
			wrap: result.recipient.wrap,
			accountSecretKey: recipientSecret,
			now: NOW
		});

		for (const ephemeral of ownedEphemerals) expect(ephemeral).toEqual(new Uint8Array(32));
		expect(derivedKeys).toHaveLength(6);
		for (const derived of derivedKeys) expect(derived).toEqual(new Uint8Array(32));
	});

	it('builds recipient and sender copies over one rumor', () => {
		const ephemeralKeys = [generateSecretKey(), generateSecretKey()];
		const result = createWrappedDirectMessage({
			content: 'Meet me at seven.',
			senderSecretKey: senderSecret,
			recipientPubkey,
			createdAt: NOW,
			randomPastTimestamp: () => NOW - 60,
			generateEphemeralKey: () => ephemeralKeys.shift()!
		});

		expect(result.rumor.id).toBe(getEventHash(result.rumor));
		expect(result.recipient.rumorId).toBe(result.rumor.id);
		expect(result.sender.rumorId).toBe(result.rumor.id);
		expect(result.recipient.seal.id).not.toBe(result.sender.seal.id);
		expect(result.recipient.wrap.id).not.toBe(result.sender.wrap.id);
		expect(verifyEvent(result.recipient.seal)).toBe(true);
		expect(verifyEvent(result.recipient.wrap)).toBe(true);
		expect(result.recipient.seal.created_at).toBeLessThanOrEqual(NOW);
		expect(result.recipient.wrap.created_at).toBeLessThanOrEqual(NOW);
	});

	it('creates distinct rumor IDs for repeated messages in the same second', () => {
		const first = createWrappedDirectMessage({
			content: 'Repeat this.',
			senderSecretKey: senderSecret,
			recipientPubkey,
			createdAt: NOW,
			generateRumorNonce: () => '11'.repeat(16)
		});
		const second = createWrappedDirectMessage({
			content: 'Repeat this.',
			senderSecretKey: senderSecret,
			recipientPubkey,
			createdAt: NOW,
			generateRumorNonce: () => '22'.repeat(16)
		});

		expect(first.rumor.id).not.toBe(second.rumor.id);
		expect(first.recipient.rumorId).toBe(first.sender.rumorId);
		expect(second.recipient.rumorId).toBe(second.sender.rumorId);
	});

	it('unwraps both copies to the same canonical message', () => {
		const result = createWrappedDirectMessage({
			content: 'Same message, two devices.',
			senderSecretKey: senderSecret,
			recipientPubkey,
			createdAt: NOW,
			randomPastTimestamp: () => NOW - 1
		});
		const recipient = unwrapDirectMessage({
			wrap: result.recipient.wrap,
			accountSecretKey: recipientSecret,
			now: NOW
		});
		const sender = unwrapDirectMessage({
			wrap: result.sender.wrap,
			accountSecretKey: senderSecret,
			now: NOW
		});
		expect(recipient.id).toBe(result.rumor.id);
		expect(sender).toEqual(recipient);
	});

	it('rejects oversized plaintext before UTF-8 encoding', () => {
		const originalEncode = TextEncoder.prototype.encode;
		let encodedOversizedInput = false;
		vi.spyOn(TextEncoder.prototype, 'encode').mockImplementation(function (
			this: TextEncoder,
			input?: string
		) {
			if ((input?.length ?? 0) > 16 * 1024) encodedOversizedInput = true;
			return originalEncode.call(this, input);
		});
		expect(() =>
			createWrappedDirectMessage({
				content: 'x'.repeat(16 * 1024 + 1),
				senderSecretKey: senderSecret,
				recipientPubkey,
				createdAt: NOW
			})
		).toThrow(/16 KiB|supported size/i);
		expect(encodedOversizedInput).toBe(false);
	});

	it('rejects hostile outer structure before serialization or signature work', () => {
		const result = createWrappedDirectMessage({
			content: 'Bound this wrapper.',
			senderSecretKey: senderSecret,
			recipientPubkey,
			createdAt: NOW
		});
		let extraReads = 0;
		const extraProperty = { ...result.recipient.wrap } as VerifiedEvent & { extra?: unknown };
		Object.defineProperty(extraProperty, 'extra', {
			enumerable: true,
			get: () => {
				extraReads += 1;
				throw new Error('must not be serialized');
			}
		});
		expect(() =>
			unwrapDirectMessage({ wrap: extraProperty, accountSecretKey: recipientSecret, now: NOW })
		).toThrow(/supported bounds/i);
		expect(extraReads).toBe(0);

		const tagBomb = {
			...result.recipient.wrap,
			tags: Array.from({ length: 9 }, () => ['p', recipientPubkey])
		} as VerifiedEvent;
		expect(() =>
			unwrapDirectMessage({ wrap: tagBomb, accountSecretKey: recipientSecret, now: NOW })
		).toThrow(/supported bounds/i);

		const scalarBomb = { ...result.recipient.wrap, id: 'a'.repeat(65) };
		expect(() =>
			unwrapDirectMessage({ wrap: scalarBomb, accountSecretKey: recipientSecret, now: NOW })
		).toThrow(/supported bounds/i);
	});

	it('rejects a tampered outer event before trusting ciphertext', () => {
		const result = createWrappedDirectMessage({
			content: 'Authentic.',
			senderSecretKey: senderSecret,
			recipientPubkey,
			createdAt: NOW,
			randomPastTimestamp: () => NOW - 1
		});
		const first = result.recipient.wrap.sig[0] === '0' ? '1' : '0';
		const tampered = {
			...result.recipient.wrap,
			sig: `${first}${result.recipient.wrap.sig.slice(1)}`
		};
		expect(() =>
			unwrapDirectMessage({ wrap: tampered, accountSecretKey: recipientSecret, now: NOW })
		).toThrow(/outer.*signature|outer.*event/i);
	});

	it('rejects seal-to-rumor author mismatch', () => {
		const rumorBase: UnsignedEvent = {
			kind: 14,
			tags: [['p', recipientPubkey]],
			content: 'Forged author.',
			created_at: NOW,
			pubkey: senderPubkey
		};
		const rumor = { ...rumorBase, id: getEventHash(rumorBase) };
		const wrap = wrapRumor(rumor, attackerSecret);
		expect(() =>
			unwrapDirectMessage({ wrap, accountSecretKey: recipientSecret, now: NOW })
		).toThrow(/author|pubkey/i);
	});

	it('rejects missing rumor IDs and future wrappers', () => {
		const rumor = {
			kind: 14,
			tags: [['p', recipientPubkey]],
			content: 'No identity.',
			created_at: NOW,
			pubkey: senderPubkey
		};
		expect(() =>
			unwrapDirectMessage({ wrap: wrapRumor(rumor), accountSecretKey: recipientSecret, now: NOW })
		).toThrow(/rumor.*incomplete/i);

		const validRumor = { ...rumor, id: getEventHash(rumor) };
		expect(() =>
			unwrapDirectMessage({
				wrap: wrapRumor(validRumor, senderSecret, NOW + 301),
				accountSecretKey: recipientSecret,
				now: NOW
			})
		).toThrow(/future|clock/i);
	});
});
