import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { generateSecretKey, getPublicKey } from 'nostr-tools';
import { createKeyEnvelope } from '../custody/key-envelope';
import { AccountDatabase } from './account-database';
import {
	AccountRegistry,
	confirmRecoveryCode,
	getActiveAccount,
	registerAccount,
	removeAccount,
	setActiveAccount
} from './account-registry';

const registries: AccountRegistry[] = [];

async function fixture() {
	const secretKey = generateSecretKey();
	const pubkey = getPublicKey(secretKey);
	const envelope = await createKeyEnvelope({
		secretKey,
		prfOutput: new Uint8Array(32).fill(7),
		credentialId: new Uint8Array(24).fill(8),
		prfSalt: new Uint8Array(32).fill(9),
		origin: 'https://aura.frankfmy.com',
		createdAt: 1_750_000_000,
		randomBytes: (length) => new Uint8Array(length).fill(10)
	});
	const registry = new AccountRegistry(`registry-${crypto.randomUUID()}`);
	registries.push(registry);
	return { secretKey, pubkey, envelope, registry };
}

afterEach(async () => {
	await Promise.all(registries.splice(0).map((registry) => registry.delete()));
});

describe('encrypted account registry', () => {
	it('stores only public metadata and the authenticated envelope', async () => {
		const { secretKey, pubkey, envelope, registry } = await fixture();
		await registerAccount(registry, {
			pubkey,
			displayName: 'Artem',
			envelope,
			dmRelays: ['wss://relay.one/'],
			createdAt: 1_750_000_000_000
		});
		const stored = await registry.accounts.get(pubkey);
		expect(stored?.recoveryConfirmed).toBe(false);
		expect(stored?.displayName).toBe('Artem');
		const serialized = JSON.stringify(stored);
		const secretHex = Array.from(secretKey, (byte) => byte.toString(16).padStart(2, '0')).join('');
		expect(serialized).not.toContain(secretHex);
	});

	it('requires explicit recovery confirmation before marking an account ready', async () => {
		const { pubkey, envelope, registry } = await fixture();
		await registerAccount(registry, {
			pubkey,
			displayName: 'Artem',
			envelope,
			dmRelays: ['wss://relay.one/'],
			createdAt: 1_750_000_000_000
		});
		await confirmRecoveryCode(registry, pubkey, 1_750_000_001_000);
		await setActiveAccount(registry, pubkey);
		expect((await getActiveAccount(registry))?.recoveryConfirmed).toBe(true);
	});

	it('removes registry metadata and the physical account database', async () => {
		const { pubkey, envelope, registry } = await fixture();
		await registerAccount(registry, {
			pubkey,
			displayName: 'Artem',
			envelope,
			dmRelays: ['wss://relay.one/'],
			createdAt: 1_750_000_000_000
		});
		const account = new AccountDatabase(pubkey);
		await account.open();
		expect(await Dexie.exists(account.name)).toBe(true);
		account.close();
		await removeAccount(registry, pubkey);
		expect(await registry.accounts.get(pubkey)).toBeUndefined();
		expect(await Dexie.exists(account.name)).toBe(false);
	});
});
