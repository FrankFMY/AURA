import { generateSecretKey, getPublicKey } from 'nostr-tools';
import {
	assertOperationCurrent,
	operationAlwaysCurrent,
	type OperationGuard
} from '../core/operation-guard';
import {
	createKeyEnvelope,
	readKeyEnvelopeCredential,
	unlockKeyEnvelope
} from '../custody/key-envelope';
import { recoveryWordsToSecretKey, secretKeyToRecoveryWords } from '../custody/recovery';
import { UnlockedSession } from '../custody/session';
import {
	createPrfCredential,
	getPrfOutput,
	type CredentialProvider
} from '../custody/webauthn-prf';
import {
	registerAccount,
	registerLinkedAccount,
	replaceRecoveredAccount,
	type AccountRegistry,
	type RegisteredAccount
} from '../storage/account-registry';

interface ClockValue {
	seconds: number;
	milliseconds: number;
}

interface CommonAccountOptions {
	registry: AccountRegistry;
	displayName: string;
	origin: string;
	rpId: string;
	dmRelays: readonly string[];
	provider?: CredentialProvider;
	now?: () => ClockValue;
	isCurrent?: OperationGuard;
}

export interface CreatePersistentAccountOptions extends CommonAccountOptions {}

export interface RestorePersistentAccountOptions extends CommonAccountOptions {
	recoveryWords: string;
}

export interface ImportLinkedPersistentAccountOptions extends CommonAccountOptions {
	/** Ownership is transferred; this buffer is zeroized on both success and failure. */
	secretKey: Uint8Array;
	/** Must synchronously authorize the durable handoff after Passkey protection and before commit. */
	authorizePersistence: () => void;
}

export interface UnlockPersistentAccountOptions {
	account: RegisteredAccount;
	origin: string;
	rpId: string;
	provider?: CredentialProvider;
	isCurrent?: OperationGuard;
}

export interface BootstrappedAccount {
	account: RegisteredAccount;
	session: UnlockedSession;
	recoveryWords: string;
}

export interface LinkedPersistentAccount {
	account: RegisteredAccount;
	session: UnlockedSession;
}

function systemClock(): ClockValue {
	const milliseconds = Date.now();
	return { seconds: Math.floor(milliseconds / 1000), milliseconds };
}

async function persistSecret(
	secretKey: Uint8Array,
	options: CommonAccountOptions,
	mode: 'create' | 'restore'
): Promise<BootstrappedAccount>;
async function persistSecret(
	secretKey: Uint8Array,
	options: CommonAccountOptions,
	mode: 'link'
): Promise<LinkedPersistentAccount>;
async function persistSecret(
	secretKey: Uint8Array,
	options: CommonAccountOptions,
	mode: 'create' | 'restore' | 'link'
): Promise<BootstrappedAccount | LinkedPersistentAccount> {
	const isCurrent = options.isCurrent ?? operationAlwaysCurrent;
	let prfOutput: Uint8Array | undefined;
	try {
		assertOperationCurrent(isCurrent);
		const pubkey = getPublicKey(secretKey);
		if (mode === 'link' && (await options.registry.accounts.get(pubkey))) {
			throw new Error('account is already registered');
		}
		assertOperationCurrent(isCurrent);
		const ceremony = await createPrfCredential({
			accountPubkey: pubkey,
			displayName: options.displayName,
			rpId: options.rpId,
			provider: options.provider
		});
		prfOutput = ceremony.prfOutput;
		assertOperationCurrent(isCurrent);
		const now = (options.now ?? systemClock)();
		const envelope = await createKeyEnvelope({
			secretKey,
			prfOutput: ceremony.prfOutput,
			credentialId: ceremony.credentialId,
			prfSalt: ceremony.prfSalt,
			origin: options.origin,
			createdAt: now.seconds
		});
		assertOperationCurrent(isCurrent);
		const accountInput = {
			pubkey,
			displayName: options.displayName,
			envelope,
			dmRelays: options.dmRelays,
			createdAt: now.milliseconds
		};
		const existing = mode === 'restore' ? await options.registry.accounts.get(pubkey) : undefined;
		assertOperationCurrent(isCurrent);
		if (mode === 'link') {
			(options as ImportLinkedPersistentAccountOptions).authorizePersistence();
			assertOperationCurrent(isCurrent);
		}
		let account;
		if (mode === 'link') {
			try {
				account = await registerLinkedAccount(options.registry, accountInput, isCurrent);
			} catch (cause) {
				const committedAccount = await options.registry.accounts.get(pubkey);
				if (!committedAccount) throw cause;
				account = committedAccount;
			}
		} else {
			account = existing
				? await replaceRecoveredAccount(options.registry, accountInput, isCurrent)
				: await registerAccount(options.registry, accountInput, isCurrent);
		}
		if (mode !== 'link') assertOperationCurrent(isCurrent);
		const session = new UnlockedSession(secretKey);
		return mode === 'link'
			? { account, session }
			: { account, session, recoveryWords: secretKeyToRecoveryWords(secretKey) };
	} finally {
		secretKey.fill(0);
		prfOutput?.fill(0);
	}
}

export async function createPersistentAccount(
	options: CreatePersistentAccountOptions
): Promise<BootstrappedAccount> {
	return persistSecret(generateSecretKey(), options, 'create');
}

export async function restorePersistentAccount(
	options: RestorePersistentAccountOptions
): Promise<BootstrappedAccount> {
	return persistSecret(recoveryWordsToSecretKey(options.recoveryWords), options, 'restore');
}

export async function importLinkedPersistentAccount(
	options: ImportLinkedPersistentAccountOptions
): Promise<LinkedPersistentAccount> {
	return persistSecret(options.secretKey, options, 'link');
}

export async function unlockPersistentAccount(
	options: UnlockPersistentAccountOptions
): Promise<UnlockedSession> {
	const isCurrent = options.isCurrent ?? operationAlwaysCurrent;
	assertOperationCurrent(isCurrent);
	const { credentialId, prfSalt } = readKeyEnvelopeCredential(options.account.envelope);
	const prfOutput = await getPrfOutput({
		credentialId,
		prfSalt,
		rpId: options.rpId,
		provider: options.provider
	});
	let secretKey: Uint8Array | undefined;
	try {
		assertOperationCurrent(isCurrent);
		secretKey = await unlockKeyEnvelope({
			envelope: options.account.envelope,
			prfOutput,
			expectedOrigin: options.origin
		});
		assertOperationCurrent(isCurrent);
		return new UnlockedSession(secretKey);
	} finally {
		prfOutput.fill(0);
		secretKey?.fill(0);
	}
}
