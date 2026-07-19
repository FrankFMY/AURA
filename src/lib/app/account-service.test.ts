import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import * as recovery from '../custody/recovery';
import type { CredentialProvider } from '../custody/webauthn-prf';
import * as webauthnPrf from '../custody/webauthn-prf';
import { AccountRegistry } from '../storage/account-registry';
import {
	createPersistentAccount,
	restorePersistentAccount,
	unlockPersistentAccount
} from './account-service';

const registries: AccountRegistry[] = [];
const rawId = new Uint8Array(24).fill(8);
const output = new Uint8Array(32).fill(7);

function credential(): PublicKeyCredential {
	return {
		id: 'credential',
		type: 'public-key',
		rawId: rawId.buffer,
		response: {} as AuthenticatorResponse,
		authenticatorAttachment: 'platform',
		getClientExtensionResults: () =>
			({
				prf: { enabled: true, results: { first: output.buffer } }
			}) as AuthenticationExtensionsClientOutputs,
		toJSON: () => ({})
	} as PublicKeyCredential;
}

const provider: CredentialProvider = {
	create: async () => credential(),
	get: async () => credential()
};

function registry() {
	const value = new AccountRegistry(`service-${crypto.randomUUID()}`);
	registries.push(value);
	return value;
}

afterEach(async () => {
	vi.restoreAllMocks();
	await Promise.all(registries.splice(0).map((value) => value.delete()));
});

describe('persistent account bootstrap', () => {
	it('creates, locks and unlocks the same exact Nostr identity', async () => {
		const accounts = registry();
		const created = await createPersistentAccount({
			registry: accounts,
			displayName: 'Artem',
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider,
			now: () => ({ seconds: 1_750_000_000, milliseconds: 1_750_000_000_000 })
		});
		expect(created.recoveryWords.split(' ')).toHaveLength(24);
		const pubkey = created.session.pubkey;
		created.session.lock();
		const unlocked = await unlockPersistentAccount({
			account: created.account,
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			provider
		});
		expect(unlocked.pubkey).toBe(pubkey);
	});

	it('zeroizes an owned secret when the lifecycle is stale at persistence entry', async () => {
		const accounts = registry();
		const ownedSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
		vi.spyOn(recovery, 'recoveryWordsToSecretKey').mockReturnValue(ownedSecret);

		await expect(
			restorePersistentAccount({
				registry: accounts,
				displayName: 'Cancelled immediately',
				recoveryWords: 'controlled by test seam',
				origin: 'https://aura.frankfmy.com',
				rpId: 'aura.frankfmy.com',
				dmRelays: ['wss://relay.one/'],
				provider,
				isCurrent: () => false
			})
		).rejects.toThrow(/operation cancelled/i);
		expect(ownedSecret).toEqual(new Uint8Array(32));
		expect(await accounts.accounts.count()).toBe(0);
	});

	it('zeroizes PRF output when cancellation follows credential creation', async () => {
		const accounts = registry();
		let current = true;
		const prfOutput = new Uint8Array(32).fill(11);
		vi.spyOn(webauthnPrf, 'createPrfCredential').mockImplementation(async () => {
			current = false;
			return {
				credentialId: new Uint8Array(24).fill(8),
				prfSalt: new Uint8Array(32).fill(9),
				prfOutput
			};
		});

		await expect(
			createPersistentAccount({
				registry: accounts,
				displayName: 'Cancelled after WebAuthn',
				origin: 'https://aura.frankfmy.com',
				rpId: 'aura.frankfmy.com',
				dmRelays: ['wss://relay.one/'],
				provider,
				isCurrent: () => current
			})
		).rejects.toThrow(/operation cancelled/i);
		expect(prfOutput).toEqual(new Uint8Array(32));
		expect(await accounts.accounts.count()).toBe(0);
	});

	it('does not persist an account when its lifecycle is stale after WebAuthn', async () => {
		const accounts = registry();
		let current = true;
		const cancellingProvider: CredentialProvider = {
			create: async () => {
				current = false;
				return credential();
			},
			get: async () => credential()
		};

		await expect(
			createPersistentAccount({
				registry: accounts,
				displayName: 'Cancelled',
				origin: 'https://aura.frankfmy.com',
				rpId: 'aura.frankfmy.com',
				dmRelays: ['wss://relay.one/'],
				provider: cancellingProvider,
				isCurrent: () => current
			})
		).rejects.toThrow(/operation cancelled/i);
		expect(await accounts.accounts.count()).toBe(0);
	});

	it('replaces an unusable local credential when restoring the same identity', async () => {
		const accounts = registry();
		const created = await createPersistentAccount({
			registry: accounts,
			displayName: 'Original',
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider,
			now: () => ({ seconds: 1_750_000_000, milliseconds: 1_750_000_000_000 })
		});
		const originalEnvelope = JSON.stringify(created.account.envelope);
		created.session.lock();

		const restored = await restorePersistentAccount({
			registry: accounts,
			displayName: 'Recovered',
			recoveryWords: created.recoveryWords,
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider,
			now: () => ({ seconds: 1_750_000_100, milliseconds: 1_750_000_100_000 })
		});

		expect(await accounts.accounts.count()).toBe(1);
		expect(restored.account.pubkey).toBe(created.account.pubkey);
		expect(restored.account.displayName).toBe('Recovered');
		expect(JSON.stringify(restored.account.envelope)).not.toBe(originalEnvelope);
		expect(
			(
				await unlockPersistentAccount({
					account: restored.account,
					origin: 'https://aura.frankfmy.com',
					rpId: 'aura.frankfmy.com',
					provider
				})
			).pubkey
		).toBe(created.account.pubkey);
	});

	it('restores the exact identity into a fresh encrypted account record', async () => {
		const source = registry();
		const created = await createPersistentAccount({
			registry: source,
			displayName: 'Source',
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider
		});
		const expectedPubkey = created.session.pubkey;
		const target = registry();
		const restored = await restorePersistentAccount({
			registry: target,
			displayName: 'Restored',
			recoveryWords: created.recoveryWords,
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider
		});
		expect(restored.session.pubkey).toBe(expectedPubkey);
		expect(restored.account.pubkey).toBe(
			getPublicKey(restored.session.withSecretKey((key) => key))
		);
	});
});
