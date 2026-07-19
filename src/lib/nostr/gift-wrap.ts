import {
	finalizeEvent,
	generateSecretKey,
	getEventHash,
	getPublicKey,
	nip44,
	verifyEvent,
	type Event,
	type UnsignedEvent,
	type VerifiedEvent
} from 'nostr-tools';

const HEX_32 = /^[0-9a-f]{64}$/u;
const HEX_16 = /^[0-9a-f]{32}$/u;
const HEX_SIG = /^[0-9a-f]{128}$/u;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const MAX_MESSAGE_BYTES = 16 * 1024;
const MAX_WRAPPED_EVENT_BYTES = 128 * 1024;
const MAX_WIRE_TAGS = 8;
const MAX_WIRE_TAG_ITEMS = 8;
const MAX_WIRE_TAG_ITEM_LENGTH = 1_024;
const TWO_DAYS_SECONDS = 2 * 24 * 60 * 60;
const encoder = new TextEncoder();

export interface Rumor extends UnsignedEvent {
	id: string;
}

export interface WireCopy {
	audience: 'recipient' | 'sender';
	audiencePubkey: string;
	rumorId: string;
	seal: VerifiedEvent;
	wrap: VerifiedEvent;
}

export interface WrappedDirectMessage {
	rumor: Readonly<Rumor>;
	recipient: Readonly<WireCopy>;
	sender: Readonly<WireCopy>;
}

export interface CreateWrappedDirectMessageOptions {
	content: string;
	senderSecretKey: Uint8Array;
	recipientPubkey: string;
	createdAt: number;
	randomPastTimestamp?: () => number;
	generateEphemeralKey?: () => Uint8Array;
	generateRumorNonce?: () => string;
}

export interface UnwrapDirectMessageOptions {
	wrap: Event;
	accountSecretKey: Uint8Array;
	now: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertTimestamp(value: number, label: string): void {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer timestamp`);
	}
}

function assertSecretKey(secretKey: Uint8Array): string {
	if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
		throw new Error('secret key must contain exactly 32 bytes');
	}
	try {
		return getPublicKey(secretKey);
	} catch {
		throw new Error('secret key is not a valid secp256k1 key');
	}
}

function assertPubkey(pubkey: string, label: string): void {
	if (typeof pubkey !== 'string' || !HEX_32.test(pubkey)) {
		throw new Error(`${label} must be a canonical lowercase x-only pubkey`);
	}
}

function assertMessageContent(content: unknown): asserts content is string {
	if (typeof content !== 'string') throw new Error('message content must be text');
	if (content.length > MAX_MESSAGE_BYTES) {
		throw new Error('message content must contain between 1 byte and 16 KiB of UTF-8 text');
	}
	const size = encoder.encode(content).length;
	if (size < 1 || size > MAX_MESSAGE_BYTES) {
		throw new Error('message content must contain between 1 byte and 16 KiB of UTF-8 text');
	}
}

function randomPastTimestamp(now: number): number {
	const random = new Uint32Array(1);
	crypto.getRandomValues(random);
	return now - (random[0] % (TWO_DAYS_SECONDS + 1));
}

function randomRumorNonce(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(16));
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function assertPastTimestamp(timestamp: number, now: number, label: string): void {
	assertTimestamp(timestamp, label);
	if (timestamp > now) throw new Error(`${label} must not be in the future`);
	if (timestamp < now - TWO_DAYS_SECONDS) {
		throw new Error(`${label} must be within the previous two days`);
	}
}

function boundedJsonParse(value: string, label: string): unknown {
	if (
		typeof value !== 'string' ||
		value.length > MAX_WRAPPED_EVENT_BYTES ||
		encoder.encode(value).length > MAX_WRAPPED_EVENT_BYTES
	) {
		throw new Error(`${label} exceeds the supported size`);
	}
	try {
		return JSON.parse(value);
	} catch {
		throw new Error(`${label} is not valid JSON`);
	}
}

function assertEventShape(value: unknown, label: string): asserts value is Event {
	if (!isRecord(value)) throw new Error(`${label} must be an event object`);
	const eventKeys = new Set(['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig']);
	let ownKeyCount = 0;
	for (const key in value) {
		if (!Object.hasOwn(value, key)) continue;
		ownKeyCount += 1;
		if (!eventKeys.has(key)) throw new Error(`${label} exceeds supported bounds`);
	}
	if (ownKeyCount !== eventKeys.size) throw new Error(`${label} exceeds supported bounds`);
	if (
		typeof value.id !== 'string' ||
		!HEX_32.test(value.id) ||
		typeof value.pubkey !== 'string' ||
		!HEX_32.test(value.pubkey) ||
		typeof value.sig !== 'string' ||
		!HEX_SIG.test(value.sig) ||
		typeof value.content !== 'string' ||
		value.content.length > MAX_WRAPPED_EVENT_BYTES
	) {
		throw new Error(`${label} exceeds supported bounds`);
	}
	if (!Number.isSafeInteger(value.kind) || !Number.isSafeInteger(value.created_at)) {
		throw new Error(`${label} kind or timestamp is invalid`);
	}
	if (!Array.isArray(value.tags) || value.tags.length > MAX_WIRE_TAGS) {
		throw new Error(`${label} exceeds supported bounds`);
	}
	for (const tag of value.tags) {
		if (
			!Array.isArray(tag) ||
			tag.length > MAX_WIRE_TAG_ITEMS ||
			tag.some((item) => typeof item !== 'string' || item.length > MAX_WIRE_TAG_ITEM_LENGTH)
		) {
			throw new Error(`${label} exceeds supported bounds`);
		}
	}
}

function verifyWireEvent(event: Event): boolean {
	// nostr-tools caches successful verification on a symbol. Reconstruct wire fields so
	// mutated or deserialized boundary objects are always re-hashed and re-verified.
	const uncached: Event = {
		id: event.id,
		pubkey: event.pubkey,
		created_at: event.created_at,
		kind: event.kind,
		tags: event.tags.map((tag) => [...tag]),
		content: event.content,
		sig: event.sig
	};
	return verifyEvent(uncached);
}

function createCopy(
	rumor: Rumor,
	senderSecretKey: Uint8Array,
	audience: WireCopy['audience'],
	audiencePubkey: string,
	nextTimestamp: () => number,
	nextEphemeralKey: () => Uint8Array,
	now: number
): Readonly<WireCopy> {
	const sealCreatedAt = nextTimestamp();
	assertPastTimestamp(sealCreatedAt, now, 'seal timestamp');
	const sealConversationKey = nip44.v2.utils.getConversationKey(senderSecretKey, audiencePubkey);
	let seal: VerifiedEvent;
	try {
		seal = finalizeEvent(
			{
				kind: 13,
				tags: [],
				created_at: sealCreatedAt,
				content: nip44.v2.encrypt(JSON.stringify(rumor), sealConversationKey)
			},
			senderSecretKey
		);
	} finally {
		sealConversationKey.fill(0);
	}

	const ephemeralKey = nextEphemeralKey();
	let wrapConversationKey: Uint8Array | undefined;
	try {
		assertSecretKey(ephemeralKey);
		const wrapCreatedAt = nextTimestamp();
		assertPastTimestamp(wrapCreatedAt, now, 'gift wrap timestamp');
		wrapConversationKey = nip44.v2.utils.getConversationKey(ephemeralKey, audiencePubkey);
		const wrap = finalizeEvent(
			{
				kind: 1059,
				tags: [['p', audiencePubkey]],
				created_at: wrapCreatedAt,
				content: nip44.v2.encrypt(JSON.stringify(seal), wrapConversationKey)
			},
			ephemeralKey
		);
		return Object.freeze({ audience, audiencePubkey, rumorId: rumor.id, seal, wrap });
	} finally {
		wrapConversationKey?.fill(0);
		ephemeralKey.fill(0);
	}
}

export function createWrappedDirectMessage(
	options: CreateWrappedDirectMessageOptions
): WrappedDirectMessage {
	const senderPubkey = assertSecretKey(options.senderSecretKey);
	assertPubkey(options.recipientPubkey, 'recipient pubkey');
	if (senderPubkey === options.recipientPubkey)
		throw new Error('sender and recipient must be different');
	assertTimestamp(options.createdAt, 'message created_at');
	assertMessageContent(options.content);
	const rumorNonce = (options.generateRumorNonce ?? randomRumorNonce)();
	if (!HEX_16.test(rumorNonce)) throw new Error('rumor nonce must contain 16 canonical bytes');

	const rumorBase: UnsignedEvent = {
		kind: 14,
		tags: [
			['p', options.recipientPubkey],
			['nonce', rumorNonce]
		],
		content: options.content,
		created_at: options.createdAt,
		pubkey: senderPubkey
	};
	const rumor: Rumor = Object.freeze({ ...rumorBase, id: getEventHash(rumorBase) });
	const nextTimestamp =
		options.randomPastTimestamp ?? (() => randomPastTimestamp(options.createdAt));
	const nextEphemeralKey = options.generateEphemeralKey ?? generateSecretKey;

	const recipient = createCopy(
		rumor,
		options.senderSecretKey,
		'recipient',
		options.recipientPubkey,
		nextTimestamp,
		nextEphemeralKey,
		options.createdAt
	);
	const sender = createCopy(
		rumor,
		options.senderSecretKey,
		'sender',
		senderPubkey,
		nextTimestamp,
		nextEphemeralKey,
		options.createdAt
	);

	return Object.freeze({ rumor, recipient, sender });
}

function validateOuterEvent(wrap: Event, accountPubkey: string, now: number): void {
	let encoded: string;
	try {
		encoded = JSON.stringify(wrap);
	} catch {
		throw new Error('outer event cannot be serialized');
	}
	if (encoder.encode(encoded).length > MAX_WRAPPED_EVENT_BYTES) {
		throw new Error('outer event exceeds the supported size');
	}
	if (wrap.kind !== 1059) throw new Error('outer event kind must be 1059');
	if (wrap.created_at > now + MAX_CLOCK_SKEW_SECONDS) {
		throw new Error('outer event timestamp is too far in the future; check the device clock');
	}
	if (wrap.tags.length !== 1 || wrap.tags[0]?.[0] !== 'p' || wrap.tags[0]?.[1] !== accountPubkey) {
		throw new Error('outer event must contain exactly one matching recipient tag');
	}
	if (!verifyWireEvent(wrap)) throw new Error('outer event signature or event ID is invalid');
}

function parseSeal(value: unknown, now: number): Event {
	assertEventShape(value, 'seal');
	if (value.kind !== 13) throw new Error('seal kind must be 13');
	if (value.tags.length !== 0) throw new Error('seal tags must be empty');
	if (value.created_at > now + MAX_CLOCK_SKEW_SECONDS) {
		throw new Error('seal timestamp is too far in the future; check the device clock');
	}
	if (!verifyWireEvent(value)) throw new Error('seal signature or event ID is invalid');
	return value;
}

function parseRumor(value: unknown, sealPubkey: string, accountPubkey: string): Rumor {
	if (!isRecord(value)) throw new Error('rumor must be an event object');
	const allowed = new Set(['id', 'pubkey', 'created_at', 'kind', 'tags', 'content']);
	let ownKeyCount = 0;
	for (const key in value) {
		if (!Object.hasOwn(value, key)) continue;
		ownKeyCount += 1;
		if (!allowed.has(key)) throw new Error('rumor contains unsupported fields');
	}
	if (ownKeyCount !== allowed.size) throw new Error('rumor fields are incomplete');
	if (typeof value.id !== 'string' || !HEX_32.test(value.id))
		throw new Error('rumor id is missing or invalid');
	if (typeof value.pubkey !== 'string' || !HEX_32.test(value.pubkey)) {
		throw new Error('rumor pubkey is invalid');
	}
	if (value.pubkey !== sealPubkey)
		throw new Error('seal author pubkey does not match rumor author');
	if (value.kind !== 14) throw new Error('rumor kind must be 14');
	if (!Number.isSafeInteger(value.created_at) || (value.created_at as number) <= 0) {
		throw new Error('rumor timestamp is invalid');
	}
	if (!Array.isArray(value.tags) || value.tags.length < 1 || value.tags.length > 64) {
		throw new Error('rumor tags are invalid');
	}
	for (const tag of value.tags) {
		if (
			!Array.isArray(tag) ||
			tag.length < 2 ||
			tag.length > 8 ||
			tag.some((item) => typeof item !== 'string' || encoder.encode(item).length > 1024)
		) {
			throw new Error('rumor tag is invalid');
		}
	}
	const pTags = value.tags.filter(
		(tag): tag is string[] => Array.isArray(tag) && tag[0] === 'p' && typeof tag[1] === 'string'
	);
	if (pTags.length !== 1) {
		throw new Error('rumor must contain exactly one recipient tag');
	}
	const recipientPubkey = pTags[0][1];
	assertPubkey(recipientPubkey, 'rumor recipient pubkey');
	if (recipientPubkey === value.pubkey)
		throw new Error('rumor sender and recipient must be different');
	if (accountPubkey !== value.pubkey && accountPubkey !== recipientPubkey) {
		throw new Error('active account is not a participant in the rumor');
	}
	assertMessageContent(value.content);

	const rumor = value as unknown as Rumor;
	if (getEventHash(rumor) !== rumor.id) throw new Error('rumor id does not match its content');
	return Object.freeze({ ...rumor, tags: rumor.tags.map((tag) => [...tag]) });
}

export function unwrapDirectMessage(options: UnwrapDirectMessageOptions): Readonly<Rumor> {
	const accountPubkey = assertSecretKey(options.accountSecretKey);
	assertTimestamp(options.now, 'verification time');
	assertEventShape(options.wrap, 'outer event');
	validateOuterEvent(options.wrap, accountPubkey, options.now);

	let sealJson: string;
	let outerKey: Uint8Array | undefined;
	try {
		outerKey = nip44.v2.utils.getConversationKey(options.accountSecretKey, options.wrap.pubkey);
		sealJson = nip44.v2.decrypt(options.wrap.content, outerKey);
	} catch {
		throw new Error('outer event ciphertext could not be decrypted');
	} finally {
		outerKey?.fill(0);
	}
	const seal = parseSeal(boundedJsonParse(sealJson, 'seal'), options.now);

	let rumorJson: string;
	let sealKey: Uint8Array | undefined;
	try {
		sealKey = nip44.v2.utils.getConversationKey(options.accountSecretKey, seal.pubkey);
		rumorJson = nip44.v2.decrypt(seal.content, sealKey);
	} catch {
		throw new Error('seal ciphertext could not be decrypted');
	} finally {
		sealKey?.fill(0);
	}
	return parseRumor(boundedJsonParse(rumorJson, 'rumor'), seal.pubkey, accountPubkey);
}
