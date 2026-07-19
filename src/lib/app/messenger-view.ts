import { nip19 } from 'nostr-tools';
import type { InvitePayload } from '../core/invite';
import type { MessageRecord } from '../storage/account-database';

export function shortNostrKey(pubkey: string): string {
	try {
		const npub = nip19.npubEncode(pubkey);
		return `${npub.slice(0, 10)}…${npub.slice(-6)}`;
	} catch {
		return `${pubkey.slice(0, 8)}…${pubkey.slice(-6)}`;
	}
}

export function inviteDisplayName(payload: InvitePayload): string {
	return payload.display?.name?.trim() || 'Someone';
}

export function contactDisplayLabel(pubkey: string, invite?: InvitePayload): string {
	return invite?.issuer_pubkey === pubkey ? inviteDisplayName(invite) : shortNostrKey(pubkey);
}

export function messageStateLabel(state: MessageRecord['state']): string {
	switch (state) {
		case 'network_accepted':
			return 'Sent';
		case 'recipient_confirmed':
			return 'Confirmed';
		case 'retry_wait':
			return 'Retrying';
		case 'network_rejected':
		case 'permanent_failure':
			return 'Not sent';
		case 'received':
			return 'Received';
		case 'restored':
			return 'Restored';
		default:
			return 'Preparing';
	}
}
