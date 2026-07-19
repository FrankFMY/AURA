import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { describe, expect, it } from 'vitest';
import {
	contactDisplayLabel,
	inviteDisplayName,
	messageStateLabel,
	shortNostrKey
} from './messenger-view';

const pubkey = getPublicKey(generateSecretKey());

describe('messenger presentation', () => {
	it('renders a bounded npub label', () => {
		const npub = nip19.npubEncode(pubkey);
		expect(shortNostrKey(pubkey)).toBe(`${npub.slice(0, 10)}…${npub.slice(-6)}`);
	});

	it('falls back safely for a malformed public key', () => {
		expect(shortNostrKey('not-a-key')).toBe('not-a-ke…-a-key');
	});

	it('treats an invite name as a self-declared display claim', () => {
		const invite = {
			v: 1 as const,
			action: 'dm' as const,
			origin: 'https://aura.example',
			issuer_pubkey: pubkey,
			issued_at: 1,
			expires_at: 2,
			nonce: 'nonce',
			relay_hints: [],
			display: { name: 'Alice' }
		};
		expect(inviteDisplayName(invite)).toBe('Alice');
		expect(contactDisplayLabel(pubkey, invite)).toBe('Alice');
		expect(contactDisplayLabel('f'.repeat(64), invite)).toBe(shortNostrKey('f'.repeat(64)));
	});

	it('labels message evidence without calling relay acceptance delivery', () => {
		expect(messageStateLabel('network_accepted')).toBe('Sent');
		expect(messageStateLabel('publishing')).toBe('Preparing');
		expect(messageStateLabel('retry_wait')).toBe('Retrying');
		expect(messageStateLabel('network_rejected')).toBe('Not sent');
		expect(messageStateLabel('permanent_failure')).toBe('Not sent');
		expect(messageStateLabel('received')).toBe('Received');
	});
});
