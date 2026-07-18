import { generateSecretKey, getPublicKey } from 'nostr-tools';
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
}

export interface CreatePersistentAccountOptions extends CommonAccountOptions {}

export interface RestorePersistentAccountOptions extends CommonAccountOptions {
	recoveryWords: string;
}

export interface UnlockPersistentAccountOptions {
	account: RegisteredAccount;
	origin: string;
	rpId: string;
	provider?: CredentialProvider;
}

export interface BootstrappedAccount {
	account: RegisteredAccount;
	session: UnlockedSession;
	recoveryWords: string;
}

function systemClock(): ClockValue {
	const milliseconds = Date.now();
	return { seconds: Math.floor(milliseconds / 1000), milliseconds };
}

async function persistSecret(
	secretKey: Uint8Array,
	options: CommonAccountOptions,
	replaceExisting = false
): Promise<BootstrappedAccount> {
	const recoveryWords = secretKeyToRecoveryWords(secretKey);
	const pubkey = getPublicKey(secretKey);
	let prfOutput: Uint8Array | undefined;
	try {
		const ceremony = await createPrfCredential({
			accountPubkey: pubkey,
			displayName: options.displayName,
			rpId: options.rpId,
			provider: options.provider
		});
		prfOutput = ceremony.prfOutput;
		const now = (options.now ?? systemClock)();
		const envelope = await createKeyEnvelope({
			secretKey,
			prfOutput: ceremony.prfOutput,
			credentialId: ceremony.credentialId,
			prfSalt: ceremony.prfSalt,
			origin: options.origin,
			createdAt: now.seconds
		});
		const accountInput = {
			pubkey,
			displayName: options.displayName,
			envelope,
			dmRelays: options.dmRelays,
			createdAt: now.milliseconds
		};
		const existing = replaceExisting ? await options.registry.accounts.get(pubkey) : undefined;
		const account = existing
			? await replaceRecoveredAccount(options.registry, accountInput)
			: await registerAccount(options.registry, accountInput);
		const session = new UnlockedSession(secretKey);
		return { account, session, recoveryWords };
	} finally {
		secretKey.fill(0);
		prfOutput?.fill(0);
	}
}

export async function createPersistentAccount(
	options: CreatePersistentAccountOptions
): Promise<BootstrappedAccount> {
	return persistSecret(generateSecretKey(), options);
}

export async function restorePersistentAccount(
	options: RestorePersistentAccountOptions
): Promise<BootstrappedAccount> {
	return persistSecret(recoveryWordsToSecretKey(options.recoveryWords), options, true);
}

export async function unlockPersistentAccount(
	options: UnlockPersistentAccountOptions
): Promise<UnlockedSession> {
	const { credentialId, prfSalt } = readKeyEnvelopeCredential(options.account.envelope);
	const prfOutput = await getPrfOutput({
		credentialId,
		prfSalt,
		rpId: options.rpId,
		provider: options.provider
	});
	let secretKey: Uint8Array | undefined;
	try {
		secretKey = await unlockKeyEnvelope({
			envelope: options.account.envelope,
			prfOutput,
			expectedOrigin: options.origin
		});
		return new UnlockedSession(secretKey);
	} finally {
		prfOutput.fill(0);
		secretKey?.fill(0);
	}
}
