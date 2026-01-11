import Dexie, { type EntityTable } from 'dexie';
import { keyManager } from '$lib/services/crypto/key-manager';

/** Database version for migrations */
const DB_VERSION = 2;

/** Nostr event stored in local database */
export interface StoredEvent {
	id: string;
	pubkey: string;
	kind: number;
	created_at: number;
	content: string;
	tags: string[][];
	sig: string;
	/** When we received/cached this event */
	cached_at: number;
}

/** User profile metadata (kind:0) */
export interface UserProfile {
	pubkey: string;
	name?: string;
	display_name?: string;
	about?: string;
	picture?: string;
	banner?: string;
	nip05?: string;
	lud16?: string;
	website?: string;
	/** When we last fetched this profile */
	updated_at: number;
}

/** Conversation metadata for DMs */
export interface Conversation {
	/** The other party's pubkey */
	pubkey: string;
	/** Last message timestamp */
	last_message_at: number;
	/** Unread message count */
	unread_count: number;
	/** Last message preview */
	last_message_preview?: string;
}

/** Relay configuration */
export interface RelayConfig {
	url: string;
	read: boolean;
	write: boolean;
	/** Connection status */
	connected: boolean;
	/** Last successful connection */
	last_connected_at?: number;
}

/** App settings */
export interface AppSettings {
	key: string;
	value: string;
}

/** Draft posts */
export interface Draft {
	id: string;
	content: string;
	reply_to?: string;
	created_at: number;
	updated_at: number;
}

/** Contact list entry (NIP-02) */
export interface Contact {
	pubkey: string;
	relay?: string;
	petname?: string;
	added_at: number;
}

/** Mute list entry */
export interface MuteEntry {
	pubkey: string;
	reason?: string;
	muted_at: number;
}

/** Pending outbox event for offline support */
export interface OutboxEvent {
	id: string;
	event_json: string;
	created_at: number;
	retries: number;
	last_attempt?: number;
	error?: string;
}

/** AURA Database Schema */
class AuraDatabase extends Dexie {
	events!: EntityTable<StoredEvent, 'id'>;
	profiles!: EntityTable<UserProfile, 'pubkey'>;
	conversations!: EntityTable<Conversation, 'pubkey'>;
	relays!: EntityTable<RelayConfig, 'url'>;
	settings!: EntityTable<AppSettings, 'key'>;
	drafts!: EntityTable<Draft, 'id'>;
	contacts!: EntityTable<Contact, 'pubkey'>;
	mutes!: EntityTable<MuteEntry, 'pubkey'>;
	outbox!: EntityTable<OutboxEvent, 'id'>;

	constructor() {
		super('AuraDB');

		// Version 1: Initial schema
		this.version(1).stores({
			events: 'id, pubkey, kind, created_at, [kind+pubkey], [kind+created_at]',
			profiles: 'pubkey, name, nip05, updated_at',
			conversations: 'pubkey, last_message_at',
			relays: 'url',
			settings: 'key',
			drafts: 'id, updated_at'
		});

		// Version 2: Add contacts, mutes, and outbox
		this.version(2).stores({
			events: 'id, pubkey, kind, created_at, cached_at, [kind+pubkey], [kind+created_at]',
			profiles: 'pubkey, name, nip05, updated_at',
			conversations: 'pubkey, last_message_at',
			relays: 'url',
			settings: 'key',
			drafts: 'id, updated_at',
			contacts: 'pubkey, added_at',
			mutes: 'pubkey, muted_at',
			outbox: 'id, created_at, retries'
		}).upgrade(async (trans) => {
			// Migration: Add cached_at to existing events if missing
			const events = await trans.table('events').toArray();
			const now = Date.now();
			for (const event of events) {
				if (!event.cached_at) {
					await trans.table('events').update(event.id, { cached_at: now });
				}
			}
		});
	}
}

/** Database singleton */
export const db = new AuraDatabase();

/** Export data format */
export interface ExportData {
	version: number;
	exportedAt: number;
	data: {
		events?: StoredEvent[];
		profiles?: UserProfile[];
		conversations?: Conversation[];
		relays?: RelayConfig[];
		settings?: AppSettings[];
		drafts?: Draft[];
		contacts?: Contact[];
		mutes?: MuteEntry[];
	};
}

/** Database helper functions */
export const dbHelpers = {
	/** Save or update an event */
	async saveEvent(event: Omit<StoredEvent, 'cached_at'>): Promise<void> {
		await db.events.put({
			...event,
			cached_at: Date.now()
		});
	},

	/** Save multiple events */
	async saveEvents(events: Omit<StoredEvent, 'cached_at'>[]): Promise<void> {
		const withTimestamp = events.map((e) => ({
			...e,
			cached_at: Date.now()
		}));
		await db.events.bulkPut(withTimestamp);
	},

	/** Get events by kind */
	async getEventsByKind(kind: number, limit: number = 50): Promise<StoredEvent[]> {
		return db.events
			.where('kind')
			.equals(kind)
			.reverse()
			.sortBy('created_at')
			.then((events) => events.slice(0, limit));
	},

	/** Get events by pubkey and kind */
	async getEventsByPubkeyAndKind(
		pubkey: string,
		kind: number,
		limit: number = 50
	): Promise<StoredEvent[]> {
		return db.events
			.where('[kind+pubkey]')
			.equals([kind, pubkey])
			.reverse()
			.sortBy('created_at')
			.then((events) => events.slice(0, limit));
	},

	/** Save or update a profile */
	async saveProfile(profile: UserProfile): Promise<void> {
		await db.profiles.put({
			...profile,
			updated_at: Date.now()
		});
	},

	/** Get profile by pubkey */
	async getProfile(pubkey: string): Promise<UserProfile | undefined> {
		return db.profiles.get(pubkey);
	},

	/** Save conversation */
	async saveConversation(conversation: Conversation): Promise<void> {
		await db.conversations.put(conversation);
	},

	/** Get all conversations sorted by last message */
	async getConversations(): Promise<Conversation[]> {
		return db.conversations.orderBy('last_message_at').reverse().toArray();
	},

	/** Increment unread count */
	async incrementUnread(pubkey: string): Promise<void> {
		const conv = await db.conversations.get(pubkey);
		if (conv) {
			await db.conversations.update(pubkey, { unread_count: conv.unread_count + 1 });
		}
	},

	/** Clear unread count */
	async clearUnread(pubkey: string): Promise<void> {
		await db.conversations.update(pubkey, { unread_count: 0 });
	},

	/** Get setting */
	async getSetting<T>(key: string, defaultValue?: T): Promise<T | undefined> {
		const setting = await db.settings.get(key);
		if (!setting) return defaultValue;
		try {
			return JSON.parse(setting.value) as T;
		} catch {
			return setting.value as unknown as T;
		}
	},

	/** Set setting */
	async setSetting<T>(key: string, value: T): Promise<void> {
		await db.settings.put({
			key,
			value: typeof value === 'string' ? value : JSON.stringify(value)
		});
	},

	/** Delete setting */
	async deleteSetting(key: string): Promise<void> {
		await db.settings.delete(key);
	},

	// Contact management (NIP-02)
	/** Add contact */
	async addContact(contact: Omit<Contact, 'added_at'>): Promise<void> {
		await db.contacts.put({
			...contact,
			added_at: Date.now()
		});
	},

	/** Remove contact */
	async removeContact(pubkey: string): Promise<void> {
		await db.contacts.delete(pubkey);
	},

	/** Get all contacts */
	async getContacts(): Promise<Contact[]> {
		return db.contacts.toArray();
	},

	/** Check if following */
	async isFollowing(pubkey: string): Promise<boolean> {
		const contact = await db.contacts.get(pubkey);
		return !!contact;
	},

	// Mute management
	/** Mute user */
	async muteUser(pubkey: string, reason?: string): Promise<void> {
		await db.mutes.put({
			pubkey,
			reason,
			muted_at: Date.now()
		});
	},

	/** Unmute user */
	async unmuteUser(pubkey: string): Promise<void> {
		await db.mutes.delete(pubkey);
	},

	/** Get muted users */
	async getMutedUsers(): Promise<MuteEntry[]> {
		return db.mutes.toArray();
	},

	/** Check if muted */
	async isMuted(pubkey: string): Promise<boolean> {
		const mute = await db.mutes.get(pubkey);
		return !!mute;
	},

	// Outbox for offline support
	/** Add event to outbox */
	async addToOutbox(eventJson: string): Promise<string> {
		const id = `outbox-${Date.now()}-${Math.random().toString(36).slice(2)}`;
		await db.outbox.put({
			id,
			event_json: eventJson,
			created_at: Date.now(),
			retries: 0
		});
		return id;
	},

	/** Get pending outbox events */
	async getOutboxEvents(): Promise<OutboxEvent[]> {
		return db.outbox.orderBy('created_at').toArray();
	},

	/** Update outbox event after retry */
	async updateOutboxEvent(id: string, error?: string): Promise<void> {
		const event = await db.outbox.get(id);
		if (event) {
			await db.outbox.update(id, {
				retries: event.retries + 1,
				last_attempt: Date.now(),
				error
			});
		}
	},

	/** Remove from outbox */
	async removeFromOutbox(id: string): Promise<void> {
		await db.outbox.delete(id);
	},

	// Cleanup
	/** Clear old cached events (keep last N days) */
	async cleanupOldEvents(daysToKeep: number = 7): Promise<number> {
		const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
		return db.events.where('cached_at').below(cutoff).delete();
	},

	/** Clear all data */
	async clearAll(): Promise<void> {
		await Promise.all([
			db.events.clear(),
			db.profiles.clear(),
			db.conversations.clear(),
			db.drafts.clear(),
			db.contacts.clear(),
			db.mutes.clear(),
			db.outbox.clear()
		]);
	},

	// Export/Import
	/** Export all data */
	async exportData(options: {
		includeEvents?: boolean;
		includeProfiles?: boolean;
		includeConversations?: boolean;
		includeRelays?: boolean;
		includeSettings?: boolean;
		includeDrafts?: boolean;
		includeContacts?: boolean;
		includeMutes?: boolean;
	} = {}): Promise<ExportData> {
		const {
			includeEvents = true,
			includeProfiles = true,
			includeConversations = true,
			includeRelays = true,
			includeSettings = true,
			includeDrafts = true,
			includeContacts = true,
			includeMutes = true
		} = options;

		const data: ExportData['data'] = {};

		if (includeEvents) data.events = await db.events.toArray();
		if (includeProfiles) data.profiles = await db.profiles.toArray();
		if (includeConversations) data.conversations = await db.conversations.toArray();
		if (includeRelays) data.relays = await db.relays.toArray();
		if (includeSettings) data.settings = await db.settings.toArray();
		if (includeDrafts) data.drafts = await db.drafts.toArray();
		if (includeContacts) data.contacts = await db.contacts.toArray();
		if (includeMutes) data.mutes = await db.mutes.toArray();

		return {
			version: DB_VERSION,
			exportedAt: Date.now(),
			data
		};
	},

	/** Export data as encrypted JSON */
	async exportEncrypted(password: string): Promise<string> {
		const data = await this.exportData();
		const json = JSON.stringify(data);
		const encrypted = await keyManager.encrypt(json, password);
		return JSON.stringify(encrypted);
	},

	/** Import data from export */
	async importData(exportData: ExportData, options: {
		merge?: boolean;
		skipEvents?: boolean;
	} = {}): Promise<{ imported: number; skipped: number }> {
		const { merge = true, skipEvents = false } = options;
		let imported = 0;
		let skipped = 0;

		// Clear if not merging
		if (!merge) {
			await this.clearAll();
		}

		const { data } = exportData;

		// Import events
		if (data.events && !skipEvents) {
			for (const event of data.events) {
				try {
					await db.events.put(event);
					imported++;
				} catch {
					skipped++;
				}
			}
		}

		// Import profiles
		if (data.profiles) {
			for (const profile of data.profiles) {
				try {
					if (merge) {
						const existing = await db.profiles.get(profile.pubkey);
						if (!existing || existing.updated_at < profile.updated_at) {
							await db.profiles.put(profile);
							imported++;
						} else {
							skipped++;
						}
					} else {
						await db.profiles.put(profile);
						imported++;
					}
				} catch {
					skipped++;
				}
			}
		}

		// Import conversations
		if (data.conversations) {
			for (const conv of data.conversations) {
				try {
					await db.conversations.put(conv);
					imported++;
				} catch {
					skipped++;
				}
			}
		}

		// Import relays
		if (data.relays) {
			for (const relay of data.relays) {
				try {
					await db.relays.put(relay);
					imported++;
				} catch {
					skipped++;
				}
			}
		}

		// Import settings
		if (data.settings) {
			for (const setting of data.settings) {
				try {
					await db.settings.put(setting);
					imported++;
				} catch {
					skipped++;
				}
			}
		}

		// Import drafts
		if (data.drafts) {
			for (const draft of data.drafts) {
				try {
					await db.drafts.put(draft);
					imported++;
				} catch {
					skipped++;
				}
			}
		}

		// Import contacts
		if (data.contacts) {
			for (const contact of data.contacts) {
				try {
					await db.contacts.put(contact);
					imported++;
				} catch {
					skipped++;
				}
			}
		}

		// Import mutes
		if (data.mutes) {
			for (const mute of data.mutes) {
				try {
					await db.mutes.put(mute);
					imported++;
				} catch {
					skipped++;
				}
			}
		}

		return { imported, skipped };
	},

	/** Import encrypted data */
	async importEncrypted(encryptedJson: string, password: string): Promise<{ imported: number; skipped: number }> {
		const encrypted = JSON.parse(encryptedJson);
		const decrypted = await keyManager.decrypt(encrypted, password);
		const data = JSON.parse(decrypted) as ExportData;
		return this.importData(data);
	},

	// Stats
	/** Get database stats */
	async getStats(): Promise<{
		events: number;
		profiles: number;
		conversations: number;
		contacts: number;
		mutes: number;
		outbox: number;
		estimatedSize: string;
	}> {
		const [events, profiles, conversations, contacts, mutes, outbox] = await Promise.all([
			db.events.count(),
			db.profiles.count(),
			db.conversations.count(),
			db.contacts.count(),
			db.mutes.count(),
			db.outbox.count()
		]);

		// Estimate storage size
		let estimatedBytes = 0;
		estimatedBytes += events * 500; // ~500 bytes per event average
		estimatedBytes += profiles * 200; // ~200 bytes per profile
		estimatedBytes += conversations * 100;
		estimatedBytes += contacts * 50;
		estimatedBytes += mutes * 50;
		estimatedBytes += outbox * 500;

		const estimatedSize = formatBytes(estimatedBytes);

		return { events, profiles, conversations, contacts, mutes, outbox, estimatedSize };
	}
};

/** Format bytes to human readable */
function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default db;
