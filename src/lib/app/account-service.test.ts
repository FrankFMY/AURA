import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPublicKey } from 'nostr-tools';
import * as recovery from '../custody/recovery';
import type { CredentialProvider } from '../custody/webauthn-prf';
import * as webauthnPrf from '../custody/webauthn-prf';
import { AccountRegistry, getActiveAccount } from '../storage/account-registry';
import { createExpiringSecretLease } from './expiring-secret';
import {
	createPersistentAccount,
	importLinkedPersistentAccount,
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
				prf: { enabled: true, results: { first: Uint8Array.from(output).buffer } }
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
	it('does not commit a linked account when a delayed timer lets WebAuthn cross expiry', async () => {
		const accounts = registry();
		const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
		let clock = 0;
		let resolveCredential!: (value: PublicKeyCredential) => void;
		const credentialResult = new Promise<PublicKeyCredential>((resolve) => {
			resolveCredential = resolve;
		});
		const lease = createExpiringSecretLease({
			secret,
			expiresAt: 1_000,
			now: () => clock,
			onExpire: () => undefined
		});
		const imported = importLinkedPersistentAccount({
			registry: accounts,
			displayName: 'Expired during Passkey',
			secretKey: secret,
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider: { create: async () => credentialResult, get: async () => null },
			authorizePersistence: () => {
				lease.take();
			}
		});
		await vi.waitFor(() => expect(resolveCredential).toBeTypeOf('function'));
		clock = 1_000;
		resolveCredential(credential());

		await expect(imported).rejects.toThrow(/expired|no longer available/i);
		expect(await accounts.accounts.count()).toBe(0);
		expect(await getActiveAccount(accounts)).toBeUndefined();
		expect(secret).toEqual(new Uint8Array(32));
	});

	it('returns a usable linked account when lifecycle turns stale only after commit', async () => {
		const accounts = registry();
		const secret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
		const lease = createExpiringSecretLease({
			secret,
			expiresAt: 2_000,
			now: () => 1_000,
			onExpire: () => undefined
		});
		let current = true;
		const originalTransaction = accounts.transaction.bind(accounts) as (
			...args: unknown[]
		) => Promise<unknown>;
		vi.spyOn(accounts, 'transaction').mockImplementation(((...args: unknown[]) =>
			originalTransaction(...args).then((result) => {
				if (args.includes(accounts.accounts) && args.includes(accounts.settings)) current = false;
				return result;
			})) as never);

		const linked = await importLinkedPersistentAccount({
			registry: accounts,
			displayName: 'Committed linked profile',
			secretKey: secret,
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider,
			isCurrent: () => current,
			authorizePersistence: () => {
				lease.take();
			}
		});
		expect(linked.session.pubkey).toBe(linked.account.pubkey);
		expect((await getActiveAccount(accounts))?.pubkey).toBe(linked.account.pubkey);
		expect(secret).toEqual(new Uint8Array(32));
		linked.session.lock();
	});

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

	it('rejects a fresh unlock assertion when its lifecycle becomes stale', async () => {
		const accounts = registry();
		const created = await createPersistentAccount({
			registry: accounts,
			displayName: 'Source approval',
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider
		});
		created.session.lock();
		let current = true;
		const staleAfterAssertionProvider: CredentialProvider = {
			create: async () => credential(),
			get: async () => {
				current = false;
				return credential();
			}
		};

		await expect(
			unlockPersistentAccount({
				account: created.account,
				origin: 'https://aura.frankfmy.com',
				rpId: 'aura.frankfmy.com',
				provider: staleAfterAssertionProvider,
				isCurrent: () => current
			})
		).rejects.toThrow(/operation cancelled/i);
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

	it('imports an exact linked identity under a fresh Passkey without materializing recovery words', async () => {
		const accounts = registry();
		const transferredSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
		const expectedPubkey = getPublicKey(transferredSecret);
		const recoverySpy = vi.spyOn(recovery, 'secretKeyToRecoveryWords');
		const linked = await importLinkedPersistentAccount({
			registry: accounts,
			displayName: 'Linked Artem',
			secretKey: transferredSecret,
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider,
			authorizePersistence: () => undefined,
			now: () => ({ seconds: 1_750_000_000, milliseconds: 1_750_000_000_000 })
		});

		expect(transferredSecret).toEqual(new Uint8Array(32));
		expect(recoverySpy).not.toHaveBeenCalled();
		expect(linked.account.pubkey).toBe(expectedPubkey);
		expect(linked.account.recoveryConfirmed).toBe(true);
		expect('recoveryWords' in linked).toBe(false);
		expect(
			(
				await unlockPersistentAccount({
					account: linked.account,
					origin: 'https://aura.frankfmy.com',
					rpId: 'aura.frankfmy.com',
					provider
				})
			).pubkey
		).toBe(expectedPubkey);
		linked.session.lock();
	});

	it('zeroizes a transferred secret and leaves the existing envelope untouched on duplicate import', async () => {
		const accounts = registry();
		const firstSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
		const first = await importLinkedPersistentAccount({
			registry: accounts,
			displayName: 'First',
			secretKey: firstSecret,
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider,
			authorizePersistence: () => undefined
		});
		const originalEnvelope = JSON.stringify(first.account.envelope);
		first.session.lock();
		const duplicateSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
		await expect(
			importLinkedPersistentAccount({
				registry: accounts,
				displayName: 'Duplicate',
				secretKey: duplicateSecret,
				origin: 'https://aura.frankfmy.com',
				rpId: 'aura.frankfmy.com',
				dmRelays: ['wss://relay.two/'],
				provider,
				authorizePersistence: () => undefined
			})
		).rejects.toThrow(/already registered/i);
		expect(duplicateSecret).toEqual(new Uint8Array(32));
		expect(await accounts.accounts.count()).toBe(1);
		expect(JSON.stringify((await accounts.accounts.get(first.account.pubkey))?.envelope)).toBe(
			originalEnvelope
		);
	});

	it('reconciles a concurrent linked commit to the durable account', async () => {
		const accounts = registry();
		const racingSecret = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
		const concurrentSecret = Uint8Array.from(racingSecret);
		let resolveCredential!: (value: PublicKeyCredential) => void;
		const delayedCredential = new Promise<PublicKeyCredential>((resolve) => {
			resolveCredential = resolve;
		});
		const racing = importLinkedPersistentAccount({
			registry: accounts,
			displayName: 'Racing profile',
			secretKey: racingSecret,
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider: { create: async () => delayedCredential, get: async () => null },
			authorizePersistence: () => undefined
		});
		await vi.waitFor(() => expect(resolveCredential).toBeTypeOf('function'));
		const concurrent = await importLinkedPersistentAccount({
			registry: accounts,
			displayName: 'Committed profile',
			secretKey: concurrentSecret,
			origin: 'https://aura.frankfmy.com',
			rpId: 'aura.frankfmy.com',
			dmRelays: ['wss://relay.one/'],
			provider,
			authorizePersistence: () => undefined
		});
		resolveCredential(credential());
		const reconciled = await racing;

		expect(reconciled.account).toEqual(concurrent.account);
		expect(await accounts.accounts.count()).toBe(1);
		expect((await getActiveAccount(accounts))?.pubkey).toBe(concurrent.account.pubkey);
		reconciled.session.lock();
		concurrent.session.lock();
	});
});
