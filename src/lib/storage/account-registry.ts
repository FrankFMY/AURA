import Dexie, { type EntityTable } from 'dexie';
import type { KeyEnvelopeV1 } from '../custody/key-envelope';
import { normalizeDmRelayUrls } from '../nostr/dm-relays';

const HEX_32 = /^[0-9a-f]{64}$/u;
const ACTIVE_ACCOUNT_KEY = 'active-account';

export interface RegisteredAccount {
	pubkey: string;
	displayName: string;
	envelope: KeyEnvelopeV1;
	dmRelays: string[];
	recoveryConfirmed: boolean;
	createdAt: number;
	updatedAt: number;
}

interface RegistrySetting {
	key: string;
	value: string;
}

export interface RegisterAccountInput {
	pubkey: string;
	displayName: string;
	envelope: KeyEnvelopeV1;
	dmRelays: readonly string[];
	createdAt: number;
}

export class AccountRegistry extends Dexie {
	accounts!: EntityTable<RegisteredAccount, 'pubkey'>;
	settings!: EntityTable<RegistrySetting, 'key'>;

	constructor(name = 'aura-r1:registry') {
		if (typeof name !== 'string' || name.length < 1 || name.length > 200) {
			throw new Error('account registry name is invalid');
		}
		super(name);
		this.version(1).stores({
			accounts: '&pubkey, updatedAt, recoveryConfirmed',
			settings: '&key'
		});
	}
}

function validateDisplayName(value: string): string {
	if (
		typeof value !== 'string' ||
		value.trim() !== value ||
		value.length < 1 ||
		Array.from(value).length > 80 ||
		value.normalize('NFC') !== value
	) {
		throw new Error('display name must be 1 to 80 trimmed NFC characters');
	}
	return value;
}

function validateTimestamp(value: number): void {
	if (!Number.isSafeInteger(value) || value < 0) throw new Error('account timestamp is invalid');
}

export async function registerAccount(
	registry: AccountRegistry,
	input: RegisterAccountInput
): Promise<RegisteredAccount> {
	if (!HEX_32.test(input.pubkey)) throw new Error('account pubkey is invalid');
	if (input.envelope.account_pubkey !== input.pubkey) {
		throw new Error('key envelope belongs to a different account');
	}
	validateTimestamp(input.createdAt);
	const account: RegisteredAccount = {
		pubkey: input.pubkey,
		displayName: validateDisplayName(input.displayName),
		envelope: input.envelope,
		dmRelays: normalizeDmRelayUrls(input.dmRelays),
		recoveryConfirmed: false,
		createdAt: input.createdAt,
		updatedAt: input.createdAt
	};
	await registry.transaction('rw', registry.accounts, async () => {
		if (await registry.accounts.get(input.pubkey)) throw new Error('account is already registered');
		await registry.accounts.add(account);
	});
	return account;
}

export async function replaceRecoveredAccount(
	registry: AccountRegistry,
	input: RegisterAccountInput
): Promise<RegisteredAccount> {
	if (!HEX_32.test(input.pubkey)) throw new Error('account pubkey is invalid');
	if (input.envelope.account_pubkey !== input.pubkey) {
		throw new Error('key envelope belongs to a different account');
	}
	validateTimestamp(input.createdAt);
	return registry.transaction('rw', registry.accounts, async () => {
		const existing = await registry.accounts.get(input.pubkey);
		if (!existing) throw new Error('account is not registered');
		const account: RegisteredAccount = {
			...existing,
			displayName: validateDisplayName(input.displayName),
			envelope: input.envelope,
			dmRelays: normalizeDmRelayUrls(input.dmRelays),
			recoveryConfirmed: true,
			updatedAt: Math.max(existing.updatedAt, input.createdAt)
		};
		await registry.accounts.put(account);
		return account;
	});
}

export async function confirmRecoveryCode(
	registry: AccountRegistry,
	pubkey: string,
	confirmedAt: number
): Promise<void> {
	validateTimestamp(confirmedAt);
	await registry.transaction('rw', registry.accounts, async () => {
		const account = await registry.accounts.get(pubkey);
		if (!account) throw new Error('account is not registered');
		await registry.accounts.put({
			...account,
			recoveryConfirmed: true,
			updatedAt: Math.max(account.updatedAt, confirmedAt)
		});
	});
}

export async function setActiveAccount(registry: AccountRegistry, pubkey: string): Promise<void> {
	if (!(await registry.accounts.get(pubkey))) throw new Error('account is not registered');
	await registry.settings.put({ key: ACTIVE_ACCOUNT_KEY, value: pubkey });
}

export async function getActiveAccount(
	registry: AccountRegistry
): Promise<RegisteredAccount | undefined> {
	const setting = await registry.settings.get(ACTIVE_ACCOUNT_KEY);
	return setting ? registry.accounts.get(setting.value) : undefined;
}

export async function removeAccount(registry: AccountRegistry, pubkey: string): Promise<void> {
	if (!HEX_32.test(pubkey)) throw new Error('account pubkey is invalid');
	await registry.transaction('rw', registry.accounts, registry.settings, async () => {
		await registry.accounts.delete(pubkey);
		const active = await registry.settings.get(ACTIVE_ACCOUNT_KEY);
		if (active?.value === pubkey) await registry.settings.delete(ACTIVE_ACCOUNT_KEY);
	});
	await Dexie.delete(`aura-r1:${pubkey}`);
}
