/**
 * Contacts Service
 * 
 * Manages NIP-02 contact lists (following/followers).
 */

import { NDKEvent, type NDKFilter } from '@nostr-dev-kit/ndk';
import ndkService from '$services/ndk';
import { dbHelpers, type Contact } from '$db';

/** Contact with profile info */
export interface ContactWithProfile extends Contact {
	displayName?: string;
	picture?: string;
	nip05?: string;
}

/**
 * Contacts Service Class
 */
class ContactsService {
	private _contacts: Map<string, Contact> = new Map();
	private _lastFetch: number = 0;
	private _cacheTimeout = 5 * 60 * 1000; // 5 minutes

	/** Get all contacts */
	get contacts(): Contact[] {
		return Array.from(this._contacts.values());
	}

	/** Get contact count */
	get count(): number {
		return this._contacts.size;
	}

	/**
	 * Fetch contact list from relays (kind:3)
	 */
	async fetchContacts(pubkey: string): Promise<Contact[]> {
		// Check cache
		if (Date.now() - this._lastFetch < this._cacheTimeout && this._contacts.size > 0) {
			return this.contacts;
		}

		// First load from local DB
		const localContacts = await dbHelpers.getContacts();
		for (const contact of localContacts) {
			this._contacts.set(contact.pubkey, contact);
		}

		// Fetch from relays
		const filter: NDKFilter = {
			kinds: [3],
			authors: [pubkey],
			limit: 1
		};

		try {
			const events = await ndkService.ndk.fetchEvents(filter);
			const latestEvent = Array.from(events)
				.sort((a, b) => (b.created_at || 0) - (a.created_at || 0))[0];

			if (latestEvent) {
				await this.parseContactList(latestEvent);
			}

			this._lastFetch = Date.now();
		} catch (error) {
			console.error('Failed to fetch contacts:', error);
		}

		return this.contacts;
	}

	/**
	 * Parse contact list from kind:3 event
	 */
	private async parseContactList(event: NDKEvent): Promise<void> {
		const newContacts: Contact[] = [];

		for (const tag of event.tags) {
			if (tag[0] === 'p' && tag[1]) {
				const contact: Contact = {
					pubkey: tag[1],
					relay: tag[2] || undefined,
					petname: tag[3] || undefined,
					added_at: (event.created_at || 0) * 1000
				};
				newContacts.push(contact);
				this._contacts.set(contact.pubkey, contact);
			}
		}

		// Sync to local DB
		for (const contact of newContacts) {
			await dbHelpers.addContact(contact);
		}
	}

	/**
	 * Follow a user
	 */
	async follow(pubkey: string, relay?: string, petname?: string): Promise<void> {
		// Add to local state
		const contact: Contact = {
			pubkey,
			relay,
			petname,
			added_at: Date.now()
		};
		this._contacts.set(pubkey, contact);

		// Add to local DB
		await dbHelpers.addContact(contact);

		// Publish updated contact list
		await this.publishContactList();
	}

	/**
	 * Unfollow a user
	 */
	async unfollow(pubkey: string): Promise<void> {
		// Remove from local state
		this._contacts.delete(pubkey);

		// Remove from local DB
		await dbHelpers.removeContact(pubkey);

		// Publish updated contact list
		await this.publishContactList();
	}

	/**
	 * Check if following a user
	 */
	isFollowing(pubkey: string): boolean {
		return this._contacts.has(pubkey);
	}

	/**
	 * Publish contact list to relays (kind:3)
	 */
	async publishContactList(): Promise<void> {
		const event = new NDKEvent(ndkService.ndk);
		event.kind = 3;
		event.content = ''; // Can contain relay list JSON

		// Build tags from contacts
		event.tags = Array.from(this._contacts.values()).map((contact) => {
			const tag = ['p', contact.pubkey];
			if (contact.relay) tag.push(contact.relay);
			if (contact.petname) {
				if (!contact.relay) tag.push(''); // Empty relay if petname exists
				tag.push(contact.petname);
			}
			return tag;
		});

		await ndkService.publish(event);
	}

	/**
	 * Get contacts with profile info
	 */
	async getContactsWithProfiles(): Promise<ContactWithProfile[]> {
		const contactsWithProfiles: ContactWithProfile[] = [];

		for (const contact of this._contacts.values()) {
			const profile = await dbHelpers.getProfile(contact.pubkey);
			contactsWithProfiles.push({
				...contact,
				displayName: profile?.display_name || profile?.name,
				picture: profile?.picture,
				nip05: profile?.nip05
			});
		}

		return contactsWithProfiles;
	}

	/**
	 * Get pubkeys of all contacts (for feed filtering)
	 */
	getContactPubkeys(): string[] {
		return Array.from(this._contacts.keys());
	}

	/**
	 * Clear contacts cache
	 */
	clearCache(): void {
		this._contacts.clear();
		this._lastFetch = 0;
	}
}

/** Singleton instance */
export const contactsService = new ContactsService();

export default contactsService;
