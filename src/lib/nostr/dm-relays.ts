import {
	finalizeEvent,
	getPublicKey,
	verifyEvent,
	type Event,
	type VerifiedEvent
} from 'nostr-tools';

const HEX_32 = /^[0-9a-f]{64}$/u;
const MAX_CLOCK_SKEW_SECONDS = 5 * 60;
const MAX_RELAYS = 3;
const MAX_RELAY_URL_LENGTH = 256;

export interface ResolvedDmRelayList {
	event: Event;
	relays: string[];
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

export function normalizeDmRelayUrls(relays: readonly string[]): string[] {
	if (!Array.isArray(relays) || relays.length < 1 || relays.length > MAX_RELAYS) {
		throw new Error('DM relay list must contain between 1 and 3 relays');
	}
	const normalized: string[] = [];
	const seen = new Set<string>();
	for (const relay of relays) {
		if (typeof relay !== 'string' || relay.length < 1 || relay.length > MAX_RELAY_URL_LENGTH) {
			throw new Error('DM relay URL has an invalid length');
		}
		let url: URL;
		try {
			url = new URL(relay);
		} catch {
			throw new Error('DM relay URL is invalid');
		}
		if (url.protocol !== 'wss:') throw new Error('DM relay URL must use wss');
		if (url.username || url.password) throw new Error('DM relay URL must not contain credentials');
		if (url.hash) throw new Error('DM relay URL must not contain a fragment');
		if (isPrivateOrLocalHostname(url.hostname)) {
			throw new Error('DM relay URL must not target a local or private address');
		}
		if (seen.has(url.href)) throw new Error('DM relay list contains a duplicate');
		seen.add(url.href);
		normalized.push(url.href);
	}
	return normalized;
}

function verifyWireEvent(event: Event): boolean {
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

function parseCandidate(event: Event, pubkey: string, now: number): ResolvedDmRelayList | null {
	if (event.kind !== 10050 || event.pubkey !== pubkey || event.content !== '') return null;
	if (!Number.isSafeInteger(event.created_at) || event.created_at <= 0) return null;
	if (event.created_at > now + MAX_CLOCK_SKEW_SECONDS) return null;
	if (!Array.isArray(event.tags) || !verifyWireEvent(event)) return null;
	if (
		event.tags.some(
			(tag) =>
				!Array.isArray(tag) || tag.length !== 2 || tag[0] !== 'relay' || typeof tag[1] !== 'string'
		)
	) {
		return null;
	}
	try {
		return { event, relays: normalizeDmRelayUrls(event.tags.map((tag) => tag[1])) };
	} catch {
		return null;
	}
}

export function createDmRelayList(
	secretKey: Uint8Array,
	relays: readonly string[],
	createdAt: number
): VerifiedEvent {
	if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
		throw new Error('secret key must contain exactly 32 bytes');
	}
	try {
		getPublicKey(secretKey);
	} catch {
		throw new Error('secret key is invalid');
	}
	if (!Number.isSafeInteger(createdAt) || createdAt <= 0) {
		throw new Error('createdAt must be a positive integer timestamp');
	}
	const normalized = normalizeDmRelayUrls(relays);
	return finalizeEvent(
		{
			kind: 10050,
			tags: normalized.map((relay) => ['relay', relay]),
			content: '',
			created_at: createdAt
		},
		secretKey
	);
}

export function resolveDmRelayList(
	events: readonly Event[],
	pubkey: string,
	now: number
): ResolvedDmRelayList | null {
	if (!HEX_32.test(pubkey)) throw new Error('pubkey must be canonical lowercase x-only hex');
	if (!Number.isSafeInteger(now) || now <= 0) throw new Error('now must be a positive timestamp');
	const candidates = events
		.map((event) => parseCandidate(event, pubkey, now))
		.filter((candidate): candidate is ResolvedDmRelayList => candidate !== null)
		.sort(
			(a, b) => b.event.created_at - a.event.created_at || a.event.id.localeCompare(b.event.id)
		);
	return candidates[0] ?? null;
}

export function requireDmRelayList(
	events: readonly Event[],
	pubkey: string,
	now: number
): ResolvedDmRelayList {
	const resolved = resolveDmRelayList(events, pubkey, now);
	if (!resolved) throw new Error('recipient_not_dm_ready: no valid kind-10050 relay list');
	return resolved;
}
