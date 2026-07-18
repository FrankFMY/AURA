import { describe, expect, it } from 'vitest';
import { finalizeEvent, getPublicKey } from 'nostr-tools';
import { createDmRelayList, requireDmRelayList, resolveDmRelayList } from './dm-relays';

const NOW = 1_750_000_000;
const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const pubkey = getPublicKey(secret);

function event(relays: string[], createdAt: number) {
	return finalizeEvent(
		{
			kind: 10050,
			tags: relays.map((relay) => ['relay', relay]),
			content: '',
			created_at: createdAt
		},
		secret
	);
}

describe('kind-10050 DM relay policy', () => {
	it('creates and resolves a signed bounded relay list', () => {
		const signed = createDmRelayList(secret, ['wss://relay.one', 'wss://relay.two/path'], NOW);
		const resolved = requireDmRelayList([signed], pubkey, NOW);
		expect(resolved.event.id).toBe(signed.id);
		expect(resolved.relays).toEqual(['wss://relay.one/', 'wss://relay.two/path']);
	});

	it('selects the newest valid replacement and lowest id on timestamp ties', () => {
		const old = event(['wss://old.example'], NOW - 20);
		const tiedA = event(['wss://a.example'], NOW - 10);
		const tiedB = event(['wss://b.example'], NOW - 10);
		const expected = [tiedA, tiedB].sort((a, b) => a.id.localeCompare(b.id))[0];
		const resolved = requireDmRelayList([old, tiedB, tiedA], pubkey, NOW);
		expect(resolved.event.id).toBe(expected.id);
	});

	it('does not let future or tampered events replace the latest valid list', () => {
		const valid = event(['wss://valid.example'], NOW - 10);
		const future = event(['wss://future.example'], NOW + 301);
		const signed = event(['wss://tampered.example'], NOW);
		const first = signed.sig[0] === '0' ? '1' : '0';
		const tampered = { ...signed, sig: `${first}${signed.sig.slice(1)}` };
		const resolved = requireDmRelayList([future, tampered, valid], pubkey, NOW);
		expect(resolved.event.id).toBe(valid.id);
	});

	it('rejects unsafe, duplicate and excessive relay lists', () => {
		for (const relays of [
			['ws://relay.example'],
			['wss://user:pass@relay.example'],
			['wss://localhost'],
			['wss://10.0.0.1'],
			['wss://relay.example', 'wss://relay.example/'],
			['wss://a.example', 'wss://b.example', 'wss://c.example', 'wss://d.example']
		]) {
			expect(resolveDmRelayList([event(relays, NOW)], pubkey, NOW)).toBeNull();
		}
	});

	it('fails closed when no valid recipient list exists', () => {
		expect(resolveDmRelayList([], pubkey, NOW)).toBeNull();
		expect(() => requireDmRelayList([], pubkey, NOW)).toThrow(/recipient_not_dm_ready/i);
	});
});
