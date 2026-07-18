import { nip19 } from 'nostr-tools';

const HEX_32 = /^[0-9a-f]{64}$/u;

export function parseNostrPubkey(value: string): string {
	if (typeof value !== 'string') throw new Error('contact identifier must be text');
	const normalized = value.trim();
	if (HEX_32.test(normalized)) return normalized;
	if (!normalized.startsWith('npub1')) {
		throw new Error('contact identifier must be an npub or lowercase 64-character hex key');
	}
	try {
		const decoded = nip19.decode(normalized);
		if (decoded.type !== 'npub' || typeof decoded.data !== 'string' || !HEX_32.test(decoded.data)) {
			throw new Error('unsupported identifier');
		}
		return decoded.data;
	} catch {
		throw new Error('contact identifier is invalid');
	}
}
