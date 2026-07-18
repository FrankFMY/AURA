import { getPublicKey } from 'nostr-tools';

export class UnlockedSession {
	readonly pubkey: string;
	#secretKey: Uint8Array | null;

	constructor(secretKey: Uint8Array) {
		if (!(secretKey instanceof Uint8Array) || secretKey.length !== 32) {
			throw new Error('Nostr secret key must contain exactly 32 bytes');
		}
		try {
			this.pubkey = getPublicKey(secretKey);
		} catch {
			throw new Error('Nostr secret key is invalid');
		}
		this.#secretKey = Uint8Array.from(secretKey);
	}

	get locked(): boolean {
		return this.#secretKey === null;
	}

	withSecretKey<T>(operation: (secretKey: Uint8Array) => T): T {
		if (!this.#secretKey) throw new Error('account session is locked');
		return operation(this.#secretKey);
	}

	lock(): void {
		if (!this.#secretKey) return;
		this.#secretKey.fill(0);
		this.#secretKey = null;
	}
}
