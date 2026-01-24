/**
 * NIP-17 Private Direct Messages (Gift Wraps)
 * 
 * Implements the "matryoshka" structure for private DMs:
 * 1. Rumor (kind:14) - unsigned message
 * 2. Seal (kind:13) - rumor encrypted for recipient, signed by sender
 * 3. Gift Wrap (kind:1059) - seal encrypted with one-time key
 * 
 * https://github.com/nostr-protocol/nips/blob/master/17.md
 * https://github.com/nostr-protocol/nips/blob/master/59.md
 */

import { generateSecretKey, getPublicKey, finalizeEvent, type UnsignedEvent, type Event } from 'nostr-tools/pure';
import * as nip44 from 'nostr-tools/nip44';
import { hexToBytes, bytesToHex } from '@noble/ciphers/utils.js';

/** Event kinds for NIP-17 */
export const NIP17_KINDS = {
	RUMOR: 14,       // Chat message (unsigned)
	SEAL: 13,        // Encrypted rumor
	GIFT_WRAP: 1059  // Encrypted seal with ephemeral key
} as const;

/** Rumor event (kind:14) - unsigned chat message */
export interface Rumor {
	kind: 14;
	content: string;
	tags: string[][];
	created_at: number;
	pubkey: string;
}

/** Sealed event structure after decryption */
export interface SealedContent {
	rumor: Rumor;
	senderPubkey: string;
}

/**
 * Create a Rumor (unsigned kind:14 message)
 */
export function createRumor(
	content: string,
	senderPubkey: string,
	recipientPubkey: string,
	replyTo?: string
): Rumor {
	const tags: string[][] = [['p', recipientPubkey]];
	
	if (replyTo) {
		tags.push(['e', replyTo, '', 'reply']);
	}

	return {
		kind: NIP17_KINDS.RUMOR,
		content,
		tags,
		created_at: Math.floor(Date.now() / 1000),
		pubkey: senderPubkey
	};
}

/**
 * Create a Seal (kind:13) - encrypt rumor for recipient
 */
export function createSeal(
	rumor: Rumor,
	senderPrivkey: Uint8Array,
	recipientPubkey: string
): Event {
	const senderPubkey = getPublicKey(senderPrivkey);
	
	// Serialize rumor as JSON
	const rumorJson = JSON.stringify(rumor);
	
	// Encrypt using NIP-44
	const conversationKey = nip44.v2.utils.getConversationKey(senderPrivkey, recipientPubkey);
	const encryptedRumor = nip44.v2.encrypt(rumorJson, conversationKey);
	
	// Create seal event
	const sealEvent: UnsignedEvent = {
		kind: NIP17_KINDS.SEAL,
		content: encryptedRumor,
		tags: [],
		created_at: randomizeTimestamp(rumor.created_at),
		pubkey: senderPubkey
	};
	
	// Sign the seal
	return finalizeEvent(sealEvent, senderPrivkey);
}

/**
 * Create a Gift Wrap (kind:1059) - wrap seal with ephemeral key
 */
export function createGiftWrap(
	seal: Event,
	recipientPubkey: string
): { giftWrap: Event; ephemeralPrivkey: Uint8Array } {
	// Generate one-time ephemeral key
	const ephemeralPrivkey = generateSecretKey();
	const ephemeralPubkey = getPublicKey(ephemeralPrivkey);
	
	// Serialize seal as JSON
	const sealJson = JSON.stringify(seal);
	
	// Encrypt seal using ephemeral key -> recipient
	const conversationKey = nip44.v2.utils.getConversationKey(ephemeralPrivkey, recipientPubkey);
	const encryptedSeal = nip44.v2.encrypt(sealJson, conversationKey);
	
	// Create gift wrap event
	const giftWrapEvent: UnsignedEvent = {
		kind: NIP17_KINDS.GIFT_WRAP,
		content: encryptedSeal,
		tags: [['p', recipientPubkey]],
		created_at: randomizeTimestamp(seal.created_at),
		pubkey: ephemeralPubkey
	};
	
	// Sign with ephemeral key
	const signedGiftWrap = finalizeEvent(giftWrapEvent, ephemeralPrivkey);
	
	return {
		giftWrap: signedGiftWrap,
		ephemeralPrivkey
	};
}

/**
 * Unwrap a Gift Wrap to get the sealed content
 */
export function unwrapGiftWrap(
	giftWrap: Event,
	recipientPrivkey: Uint8Array
): Event {
	if (giftWrap.kind !== NIP17_KINDS.GIFT_WRAP) {
		throw new Error(`Expected kind ${NIP17_KINDS.GIFT_WRAP}, got ${giftWrap.kind}`);
	}
	
	// Decrypt using recipient's key and gift wrap's ephemeral pubkey
	const conversationKey = nip44.v2.utils.getConversationKey(recipientPrivkey, giftWrap.pubkey);
	const sealJson = nip44.v2.decrypt(giftWrap.content, conversationKey);
	
	// Parse seal event
	const seal = JSON.parse(sealJson) as Event;
	
	if (seal.kind !== NIP17_KINDS.SEAL) {
		throw new Error(`Expected seal kind ${NIP17_KINDS.SEAL}, got ${seal.kind}`);
	}
	
	return seal;
}

/**
 * Unseal a Seal event to get the Rumor
 */
export function unsealSeal(
	seal: Event,
	recipientPrivkey: Uint8Array
): Rumor {
	if (seal.kind !== NIP17_KINDS.SEAL) {
		throw new Error(`Expected kind ${NIP17_KINDS.SEAL}, got ${seal.kind}`);
	}
	
	// Decrypt using recipient's key and seal's sender pubkey
	const conversationKey = nip44.v2.utils.getConversationKey(recipientPrivkey, seal.pubkey);
	const rumorJson = nip44.v2.decrypt(seal.content, conversationKey);
	
	// Parse rumor
	const rumor = JSON.parse(rumorJson) as Rumor;
	
	if (rumor.kind !== NIP17_KINDS.RUMOR) {
		throw new Error(`Expected rumor kind ${NIP17_KINDS.RUMOR}, got ${rumor.kind}`);
	}
	
	return rumor;
}

/**
 * Full unwrap: Gift Wrap -> Seal -> Rumor
 */
export function unwrapMessage(
	giftWrap: Event,
	recipientPrivkey: Uint8Array
): { rumor: Rumor; senderPubkey: string } {
	// First layer: unwrap gift wrap to get seal
	const seal = unwrapGiftWrap(giftWrap, recipientPrivkey);
	
	// Second layer: unseal to get rumor
	const rumor = unsealSeal(seal, recipientPrivkey);
	
	// The sender is the seal's pubkey (not the gift wrap's ephemeral key)
	return {
		rumor,
		senderPubkey: seal.pubkey
	};
}

/**
 * Create a complete wrapped message (Rumor -> Seal -> Gift Wrap)
 */
export function wrapMessage(
	content: string,
	senderPrivkey: Uint8Array,
	recipientPubkey: string,
	replyTo?: string
): { giftWrap: Event; rumor: Rumor } {
	const senderPubkey = getPublicKey(senderPrivkey);
	
	// Create rumor
	const rumor = createRumor(content, senderPubkey, recipientPubkey, replyTo);
	
	// Create seal
	const seal = createSeal(rumor, senderPrivkey, recipientPubkey);
	
	// Create gift wrap
	const { giftWrap } = createGiftWrap(seal, recipientPubkey);
	
	return { giftWrap, rumor };
}

/**
 * Wrap a message for multiple recipients (group chat support)
 * Each recipient gets their own gift wrap
 */
export function wrapMessageForMultiple(
	content: string,
	senderPrivkey: Uint8Array,
	recipientPubkeys: string[],
	replyTo?: string
): Map<string, Event> {
	const senderPubkey = getPublicKey(senderPrivkey);
	const results = new Map<string, Event>();
	
	for (const recipientPubkey of recipientPubkeys) {
		// Create rumor with all recipients tagged
		const tags: string[][] = recipientPubkeys.map(pk => ['p', pk]);
		if (replyTo) {
			tags.push(['e', replyTo, '', 'reply']);
		}
		
		const rumor: Rumor = {
			kind: NIP17_KINDS.RUMOR,
			content,
			tags,
			created_at: Math.floor(Date.now() / 1000),
			pubkey: senderPubkey
		};
		
		// Create seal for this recipient
		const seal = createSeal(rumor, senderPrivkey, recipientPubkey);
		
		// Create gift wrap for this recipient
		const { giftWrap } = createGiftWrap(seal, recipientPubkey);
		
		results.set(recipientPubkey, giftWrap);
	}
	
	return results;
}

/**
 * Randomize timestamp to reduce metadata leakage
 * Adds/subtracts up to 48 hours randomly
 */
function randomizeTimestamp(baseTimestamp: number): number {
	// Random offset between -48h and +48h (in seconds)
	const maxOffset = 48 * 60 * 60;
	const offset = Math.floor(Math.random() * maxOffset * 2) - maxOffset;
	return baseTimestamp + offset;
}

/**
 * Check if an event is a NIP-17 Gift Wrap
 */
export function isGiftWrap(event: Event | { kind: number }): boolean {
	return event.kind === NIP17_KINDS.GIFT_WRAP;
}

/**
 * Check if an event is a NIP-17 Seal
 */
export function isSeal(event: Event | { kind: number }): boolean {
	return event.kind === NIP17_KINDS.SEAL;
}

/**
 * Get the intended recipient from a Gift Wrap event
 */
export function getGiftWrapRecipient(giftWrap: Event): string | null {
	const pTag = giftWrap.tags.find(t => t[0] === 'p');
	return pTag ? pTag[1] : null;
}

/**
 * Convert hex private key to Uint8Array
 */
export function hexToPrivkey(hex: string): Uint8Array {
	return hexToBytes(hex);
}

/**
 * Convert Uint8Array private key to hex
 */
export function privkeyToHex(privkey: Uint8Array): string {
	return bytesToHex(privkey);
}

export default {
	NIP17_KINDS,
	createRumor,
	createSeal,
	createGiftWrap,
	unwrapGiftWrap,
	unsealSeal,
	unwrapMessage,
	wrapMessage,
	wrapMessageForMultiple,
	isGiftWrap,
	isSeal,
	getGiftWrapRecipient,
	hexToPrivkey,
	privkeyToHex
};
