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
import { normalizeDmRelayUrls } from '../nostr/dm-relays';

export const DEVICE_LINK_REQUEST_KIND = 24_242;
export const DEVICE_LINK_TRANSFER_KIND = 24_243;
const MAX_LIFETIME_SECONDS = 5 * 60;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const MAX_TOKEN_LENGTH = 4_096;
const MAX_WIRE_BYTES = 32 * 1024;
const BASE64URL = /^[A-Za-z0-9_-]+$/u;
const HEX_32 = /^[0-9a-f]{64}$/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export interface DeviceLinkRequestPayload {
	v: 1;
	action: 'link-device';
	origin: string;
	request_id: string;
	issued_at: number;
	expires_at: number;
	relay_hints: string[];
}

export interface VerifiedDeviceLinkRequest {
	event: Readonly<Event>;
	payload: Readonly<DeviceLinkRequestPayload>;
	token: string;
	verificationCode: string;
}

export interface CreateDeviceLinkRequestOptions {
	origin: string;
	relayHints: readonly string[];
	issuedAt: number;
	expiresAt: number;
	receiverSecretKey?: Uint8Array;
	requestIdBytes?: Uint8Array;
}

export interface CreatedDeviceLinkRequest extends VerifiedDeviceLinkRequest {
	receiverSecretKey: Uint8Array;
}

export interface CreateDeviceLinkTransferOptions {
	request: VerifiedDeviceLinkRequest;
	accountSecretKey: Uint8Array;
	displayName: string;
	dmRelays: readonly string[];
	createdAt: number;
	wrapperSecretKey?: Uint8Array;
	sealCreatedAt?: number;
	wrapCreatedAt?: number;
}

export interface UnwrapDeviceLinkTransferOptions {
	wrap: Event;
	receiverSecretKey: Uint8Array;
	request: VerifiedDeviceLinkRequest;
	now: number;
}

export interface ImportedDeviceLinkProfile {
	requestId: string;
	accountPubkey: string;
	accountSecretKey: Uint8Array;
	displayName: string;
	dmRelays: string[];
}

interface DeviceLinkTransferPayload {
	v: 1;
	action: 'link-device-transfer';
	request_id: string;
	receiver_pubkey: string;
	account_secret: string;
	display_name: string;
	dm_relays: string[];
	expires_at: number;
}

function randomBytes(length: number): Uint8Array {
	return crypto.getRandomValues(new Uint8Array(length));
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value: string, label: string): Uint8Array {
	if (typeof value !== 'string' || !BASE64URL.test(value) || value.length % 4 === 1) {
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
	if (bytesToBase64Url(bytes) !== value) throw new Error(`${label} must be canonical base64url`);
	return bytes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(
	value: Record<string, unknown>,
	allowed: readonly string[],
	label: string
): void {
	const allowedSet = new Set(allowed);
	const actual = Object.keys(value);
	const unknown = actual.filter((key) => !allowedSet.has(key));
	if (unknown.length > 0) throw new Error(`unknown ${label} field: ${unknown.sort().join(', ')}`);
	const missing = allowed.filter((key) => !(key in value));
	if (missing.length > 0) throw new Error(`missing ${label} field: ${missing.join(', ')}`);
}

function assertTimestamp(value: unknown, label: string): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) <= 0) {
		throw new Error(`${label} must be a positive integer timestamp`);
	}
}

function normalizeOrigin(value: string): string {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('device link origin is invalid');
	}
	if (value !== url.origin) throw new Error('device link origin must not contain a path, query or fragment');
	const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
	if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
		throw new Error('device link origin must use https');
	}
	return url.origin;
}

function assertSecretKey(value: Uint8Array, label: string): string {
	if (!(value instanceof Uint8Array) || value.length !== 32) {
		throw new Error(`${label} must contain exactly 32 bytes`);
	}
	try {
		return getPublicKey(value);
	} catch {
		throw new Error(`${label} is not a valid secp256k1 key`);
	}
}

function assertDisplayName(value: unknown): asserts value is string {
	if (
		typeof value !== 'string' ||
		value.trim() !== value ||
		value.length < 1 ||
		Array.from(value).length > 80 ||
		value.normalize('NFC') !== value
	) {
		throw new Error('device link display name must be 1 to 80 trimmed NFC characters');
	}
}

function boundedJsonParse(value: string, label: string): unknown {
	if (typeof value !== 'string' || encoder.encode(value).length > MAX_WIRE_BYTES) {
		throw new Error(`${label} exceeds the supported size`);
	}
	try {
		return JSON.parse(value);
	} catch {
		throw new Error(`${label} is not valid JSON`);
	}
}

function eventCopy(value: Event): Event {
	return {
		id: value.id,
		pubkey: value.pubkey,
		created_at: value.created_at,
		kind: value.kind,
		tags: value.tags.map((tag) => [...tag]),
		content: value.content,
		sig: value.sig
	};
}

function assertEvent(value: unknown, label: string): asserts value is Event {
	if (!isRecord(value)) throw new Error(`${label} must be an event object`);
	assertExactKeys(value, ['id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig'], label);
	if (
		typeof value.id !== 'string' ||
		typeof value.pubkey !== 'string' ||
		typeof value.content !== 'string' ||
		typeof value.sig !== 'string' ||
		!Number.isSafeInteger(value.created_at) ||
		!Number.isSafeInteger(value.kind) ||
		!Array.isArray(value.tags)
	) {
		throw new Error(`${label} shape is invalid`);
	}
	for (const tag of value.tags) {
		if (!Array.isArray(tag) || tag.some((entry) => typeof entry !== 'string')) {
			throw new Error(`${label} tags are invalid`);
		}
	}
}

function verificationCode(eventId: string): string {
	return (Number.parseInt(eventId.slice(0, 8), 16) % 1_000_000).toString().padStart(6, '0');
}

function validateRequestPayload(
	value: unknown,
	event: Event,
	expectedOrigin: string,
	now: number
): DeviceLinkRequestPayload {
	if (!isRecord(value)) throw new Error('device link request payload must be an object');
	assertExactKeys(
		value,
		['v', 'action', 'origin', 'request_id', 'issued_at', 'expires_at', 'relay_hints'],
		'device link request'
	);
	if (value.v !== 1 || value.action !== 'link-device') {
		throw new Error('unsupported device link request version or action');
	}
	if (value.origin !== normalizeOrigin(expectedOrigin)) {
		throw new Error('device link origin does not match this deployment');
	}
	assertTimestamp(value.issued_at, 'device link issued_at');
	assertTimestamp(value.expires_at, 'device link expires_at');
	if (value.issued_at !== event.created_at) throw new Error('device link request timestamp mismatch');
	if (value.issued_at > now + MAX_CLOCK_SKEW_SECONDS) {
		throw new Error('device link request was issued too far in the future');
	}
	if (value.expires_at <= now) throw new Error('device link request has expired');
	if (value.expires_at <= value.issued_at || value.expires_at - value.issued_at > MAX_LIFETIME_SECONDS) {
		throw new Error('device link request lifetime exceeds five minutes');
	}
	if (typeof value.request_id !== 'string') throw new Error('device link request id is invalid');
	if (base64UrlToBytes(value.request_id, 'device link request id').length !== 32) {
		throw new Error('device link request id must contain exactly 32 bytes');
	}
	const relayHints = normalizeDmRelayUrls(value.relay_hints as string[]);
	return {
		v: 1,
		action: 'link-device',
		origin: value.origin,
		request_id: value.request_id,
		issued_at: value.issued_at,
		expires_at: value.expires_at,
		relay_hints: relayHints
	};
}

function parseRequestEvent(token: string): Event {
	if (typeof token !== 'string' || token.length < 1 || token.length > MAX_TOKEN_LENGTH) {
		throw new Error('device link token has an invalid length');
	}
	let decoded: string;
	try {
		decoded = decoder.decode(base64UrlToBytes(token, 'device link token'));
	} catch (error) {
		if (error instanceof Error && /canonical base64url/u.test(error.message)) throw error;
		throw new Error('device link token is not valid UTF-8');
	}
	const value = boundedJsonParse(decoded, 'device link token');
	assertEvent(value, 'device link request event');
	if (value.kind !== DEVICE_LINK_REQUEST_KIND || value.tags.length !== 0) {
		throw new Error('device link request event kind or tags are invalid');
	}
	if (!HEX_32.test(value.pubkey) || !verifyEvent(eventCopy(value))) {
		throw new Error('device link request signature or event ID is invalid');
	}
	return value;
}

function validateVerifiedRequest(
	request: VerifiedDeviceLinkRequest,
	now: number
): DeviceLinkRequestPayload {
	const event = parseRequestEvent(request.token);
	if (event.id !== request.event.id || event.pubkey !== request.event.pubkey) {
		throw new Error('device link request object does not match its token');
	}
	return validateRequestPayload(
		boundedJsonParse(event.content, 'device link request content'),
		event,
		request.payload.origin,
		now
	);
}

export function createDeviceLinkRequest(
	options: CreateDeviceLinkRequestOptions
): CreatedDeviceLinkRequest {
	assertTimestamp(options.issuedAt, 'device link issuedAt');
	assertTimestamp(options.expiresAt, 'device link expiresAt');
	const origin = normalizeOrigin(options.origin);
	const relayHints = normalizeDmRelayUrls(options.relayHints);
	if (
		options.expiresAt <= options.issuedAt ||
		options.expiresAt - options.issuedAt > MAX_LIFETIME_SECONDS
	) {
		throw new Error('device link request lifetime exceeds five minutes');
	}
	const receiverSecretKey = options.receiverSecretKey
		? Uint8Array.from(options.receiverSecretKey)
		: generateSecretKey();
	assertSecretKey(receiverSecretKey, 'device link receiver secret key');
	const requestIdBytes = options.requestIdBytes
		? Uint8Array.from(options.requestIdBytes)
		: randomBytes(32);
	if (requestIdBytes.length !== 32) throw new Error('device link request id must contain 32 bytes');
	const payload: DeviceLinkRequestPayload = {
		v: 1,
		action: 'link-device',
		origin,
		request_id: bytesToBase64Url(requestIdBytes),
		issued_at: options.issuedAt,
		expires_at: options.expiresAt,
		relay_hints: relayHints
	};
	const event = finalizeEvent(
		{
			kind: DEVICE_LINK_REQUEST_KIND,
			tags: [],
			content: JSON.stringify(payload),
			created_at: options.issuedAt
		},
		receiverSecretKey
	);
	const token = bytesToBase64Url(encoder.encode(JSON.stringify(event)));
	if (token.length > MAX_TOKEN_LENGTH) throw new Error('device link token is too large');
	return {
		event: Object.freeze(eventCopy(event)),
		payload: Object.freeze({ ...payload, relay_hints: Object.freeze([...relayHints]) }) as Readonly<DeviceLinkRequestPayload>,
		token,
		verificationCode: verificationCode(event.id),
		receiverSecretKey
	};
}

export function parseAndVerifyDeviceLinkUrl(
	value: string,
	options: { expectedOrigin: string; now: number }
): VerifiedDeviceLinkRequest {
	assertTimestamp(options.now, 'device link verification time');
	const expectedOrigin = normalizeOrigin(options.expectedOrigin);
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error('device link URL is invalid');
	}
	if (url.origin !== expectedOrigin) throw new Error('device link URL origin does not match');
	if (url.pathname !== '/link' && url.pathname !== '/link/') {
		throw new Error('device link URL path is invalid');
	}
	if (url.search) throw new Error('device link URL must not contain a query');
	if (!url.hash || url.hash === '#') throw new Error('device link URL fragment is missing');
	const token = url.hash.slice(1);
	const event = parseRequestEvent(token);
	const payload = validateRequestPayload(
		boundedJsonParse(event.content, 'device link request content'),
		event,
		expectedOrigin,
		options.now
	);
	return {
		event: Object.freeze(eventCopy(event)),
		payload: Object.freeze({ ...payload, relay_hints: Object.freeze([...payload.relay_hints]) }) as Readonly<DeviceLinkRequestPayload>,
		token,
		verificationCode: verificationCode(event.id)
	};
}

function randomPastTimestamp(now: number): number {
	const random = crypto.getRandomValues(new Uint32Array(1));
	return now - (random[0] % (MAX_CLOCK_SKEW_SECONDS + 1));
}

export function createDeviceLinkTransfer(
	options: CreateDeviceLinkTransferOptions
): VerifiedEvent {
	assertTimestamp(options.createdAt, 'device link transfer createdAt');
	const requestPayload = validateVerifiedRequest(options.request, options.createdAt);
	const accountPubkey = assertSecretKey(options.accountSecretKey, 'account secret key');
	assertDisplayName(options.displayName);
	const dmRelays = normalizeDmRelayUrls(options.dmRelays);
	const receiverPubkey = options.request.event.pubkey;
	const transfer: DeviceLinkTransferPayload = {
		v: 1,
		action: 'link-device-transfer',
		request_id: requestPayload.request_id,
		receiver_pubkey: receiverPubkey,
		account_secret: bytesToBase64Url(options.accountSecretKey),
		display_name: options.displayName,
		dm_relays: dmRelays,
		expires_at: requestPayload.expires_at
	};
	const rumorBase: UnsignedEvent = {
		kind: DEVICE_LINK_TRANSFER_KIND,
		pubkey: accountPubkey,
		created_at: options.createdAt,
		tags: [['p', receiverPubkey]],
		content: JSON.stringify(transfer)
	};
	const rumor = { ...rumorBase, id: getEventHash(rumorBase) };
	const sealCreatedAt = options.sealCreatedAt ?? randomPastTimestamp(options.createdAt);
	const wrapCreatedAt = options.wrapCreatedAt ?? randomPastTimestamp(options.createdAt);
	for (const [timestamp, label] of [
		[sealCreatedAt, 'seal'],
		[wrapCreatedAt, 'wrapper']
	] as const) {
		assertTimestamp(timestamp, `device link ${label} timestamp`);
		if (timestamp > options.createdAt || timestamp < options.createdAt - MAX_CLOCK_SKEW_SECONDS) {
			throw new Error(`device link ${label} timestamp is outside the allowed window`);
		}
	}
	const sealConversationKey = nip44.v2.utils.getConversationKey(
		options.accountSecretKey,
		receiverPubkey
	);
	let seal: VerifiedEvent;
	try {
		seal = finalizeEvent(
			{
				kind: 13,
				tags: [],
				created_at: sealCreatedAt,
				content: nip44.v2.encrypt(JSON.stringify(rumor), sealConversationKey)
			},
			options.accountSecretKey
		);
	} finally {
		sealConversationKey.fill(0);
	}
	const wrapperSecretKey = options.wrapperSecretKey
		? Uint8Array.from(options.wrapperSecretKey)
		: generateSecretKey();
	let wrapConversationKey: Uint8Array | undefined;
	try {
		assertSecretKey(wrapperSecretKey, 'device link wrapper secret key');
		wrapConversationKey = nip44.v2.utils.getConversationKey(wrapperSecretKey, receiverPubkey);
		return finalizeEvent(
			{
				kind: 1059,
				tags: [
					['p', receiverPubkey],
					['expiration', String(requestPayload.expires_at)]
				],
				created_at: wrapCreatedAt,
				content: nip44.v2.encrypt(JSON.stringify(seal), wrapConversationKey)
			},
			wrapperSecretKey
		);
	} finally {
		wrapConversationKey?.fill(0);
		wrapperSecretKey.fill(0);
	}
}

function parseTransferPayload(
	value: unknown,
	request: VerifiedDeviceLinkRequest,
	accountPubkey: string
): ImportedDeviceLinkProfile {
	if (!isRecord(value)) throw new Error('device link transfer payload must be an object');
	assertExactKeys(
		value,
		[
			'v',
			'action',
			'request_id',
			'receiver_pubkey',
			'account_secret',
			'display_name',
			'dm_relays',
			'expires_at'
		],
		'device link transfer'
	);
	if (value.v !== 1 || value.action !== 'link-device-transfer') {
		throw new Error('unsupported device link transfer version or action');
	}
	if (value.request_id !== request.payload.request_id) {
		throw new Error('device link transfer request mismatch');
	}
	if (value.receiver_pubkey !== request.event.pubkey) {
		throw new Error('device link transfer recipient mismatch');
	}
	if (value.expires_at !== request.payload.expires_at) {
		throw new Error('device link transfer expiry mismatch');
	}
	assertDisplayName(value.display_name);
	const dmRelays = normalizeDmRelayUrls(value.dm_relays as string[]);
	if (typeof value.account_secret !== 'string') throw new Error('transferred account secret is invalid');
	const accountSecretKey = base64UrlToBytes(value.account_secret, 'transferred account secret');
	try {
		if (accountSecretKey.length !== 32) throw new Error('transferred account secret has an invalid length');
		const transferredPubkey = assertSecretKey(accountSecretKey, 'transferred account secret');
		if (transferredPubkey !== accountPubkey) {
			throw new Error('transferred account secret does not match the signed identity');
		}
		return {
			requestId: request.payload.request_id,
			accountPubkey,
			accountSecretKey,
			displayName: value.display_name,
			dmRelays
		};
	} catch (error) {
		accountSecretKey.fill(0);
		throw error;
	}
}

export function unwrapDeviceLinkTransfer(
	options: UnwrapDeviceLinkTransferOptions
): ImportedDeviceLinkProfile {
	assertTimestamp(options.now, 'device link transfer verification time');
	const requestPayload = validateVerifiedRequest(options.request, options.now);
	assertSecretKey(options.receiverSecretKey, 'device link receiver secret key');
	assertEvent(options.wrap, 'device link wrapper event');
	const receiverPubkey = options.request.event.pubkey;
	if (
		options.wrap.kind !== 1059 ||
		options.wrap.tags.length !== 2 ||
		options.wrap.tags[0]?.length !== 2 ||
		options.wrap.tags[0]?.[0] !== 'p' ||
		options.wrap.tags[0]?.[1] !== receiverPubkey ||
		options.wrap.tags[1]?.length !== 2 ||
		options.wrap.tags[1]?.[0] !== 'expiration' ||
		options.wrap.tags[1]?.[1] !== String(requestPayload.expires_at)
	) {
		throw new Error('device link wrapper routing tags are invalid');
	}
	if (options.wrap.created_at > options.now + MAX_CLOCK_SKEW_SECONDS) {
		throw new Error('device link wrapper timestamp is too far in the future');
	}
	if (!verifyEvent(eventCopy(options.wrap))) {
		throw new Error('device link wrapper signature or event ID is invalid');
	}
	let sealValue: unknown;
	try {
		const wrapConversationKey = nip44.v2.utils.getConversationKey(
			options.receiverSecretKey,
			options.wrap.pubkey
		);
		try {
			sealValue = boundedJsonParse(
				nip44.v2.decrypt(options.wrap.content, wrapConversationKey),
				'device link seal'
			);
		} finally {
			wrapConversationKey.fill(0);
		}
	} catch {
		throw new Error('device link wrapper could not be authenticated or decrypted');
	}
	assertEvent(sealValue, 'device link seal');
	const seal = sealValue;
	if (seal.kind !== 13 || seal.tags.length !== 0 || !verifyEvent(eventCopy(seal))) {
		throw new Error('device link seal signature, event ID, kind or tags are invalid');
	}
	if (seal.created_at > options.now + MAX_CLOCK_SKEW_SECONDS) {
		throw new Error('device link seal timestamp is too far in the future');
	}
	let rumorValue: unknown;
	try {
		const sealConversationKey = nip44.v2.utils.getConversationKey(
			options.receiverSecretKey,
			seal.pubkey
		);
		try {
			rumorValue = boundedJsonParse(
				nip44.v2.decrypt(seal.content, sealConversationKey),
				'device link rumor'
			);
		} finally {
			sealConversationKey.fill(0);
		}
	} catch {
		throw new Error('device link seal could not be authenticated or decrypted');
	}
	if (!isRecord(rumorValue)) throw new Error('device link rumor must be an object');
	assertExactKeys(
		rumorValue,
		['id', 'pubkey', 'created_at', 'kind', 'tags', 'content'],
		'device link rumor'
	);
	if (
		typeof rumorValue.id !== 'string' ||
		typeof rumorValue.pubkey !== 'string' ||
		typeof rumorValue.content !== 'string' ||
		!Number.isSafeInteger(rumorValue.created_at) ||
		!Number.isSafeInteger(rumorValue.kind) ||
		!Array.isArray(rumorValue.tags)
	) {
		throw new Error('device link rumor shape is invalid');
	}
	const rumor = rumorValue as unknown as UnsignedEvent & { id: string };
	if (
		rumor.kind !== DEVICE_LINK_TRANSFER_KIND ||
		rumor.pubkey !== seal.pubkey ||
		rumor.tags.length !== 1 ||
		rumor.tags[0]?.length !== 2 ||
		rumor.tags[0]?.[0] !== 'p' ||
		rumor.tags[0]?.[1] !== receiverPubkey
	) {
		throw new Error('device link rumor identity, kind or recipient is invalid');
	}
	const rumorBase: UnsignedEvent = {
		kind: rumor.kind,
		pubkey: rumor.pubkey,
		created_at: rumor.created_at,
		tags: rumor.tags.map((tag) => [...tag]),
		content: rumor.content
	};
	if (rumor.id !== getEventHash(rumorBase)) throw new Error('device link rumor event ID is invalid');
	if (!HEX_32.test(rumor.pubkey)) throw new Error('device link rumor identity is invalid');
	return parseTransferPayload(
		boundedJsonParse(rumor.content, 'device link transfer content'),
		options.request,
		rumor.pubkey
	);
}
