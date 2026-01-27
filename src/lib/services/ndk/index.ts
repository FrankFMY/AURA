/**
 * NDK Service - Main Entry Point
 * 
 * Exports all NDK-related services and provides a unified interface.
 */

import NDK, {
	NDKEvent,
	NDKNip07Signer,
	NDKPrivateKeySigner,
	type NDKFilter,
	type NDKSigner,
	type NDKRelay
} from '@nostr-dev-kit/ndk';
import { generateSecretKey, getPublicKey, nip19 } from 'nostr-tools';
import { relayManager, DEFAULT_RELAYS, type RelayHealth } from './relay-manager';
import { eventPublisher } from './event-publisher';
import { subscriptionManager, type SubscriptionCallbacks } from './subscription-manager';
import { db, dbHelpers } from '$db';
import { NetworkError, AuthError, ErrorCode } from '$lib/core/errors';

// Re-export sub-modules
export { relayManager, DEFAULT_RELAYS, BACKUP_RELAYS, type RelayHealth } from './relay-manager';
export { eventPublisher, type QueuedEvent } from './event-publisher';
export { subscriptionManager, type SubscriptionMeta, type SubscriptionCallbacks } from './subscription-manager';

/** Connection status */
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * NDK Service Class
 * 
 * Main service for managing Nostr connections and operations.
 * Coordinates between RelayManager, EventPublisher, and SubscriptionManager.
 */
class NDKService {
	private _ndk: NDK | null = null;
	private _signer: NDKSigner | null = null;
	private _pubkey: string | null = null;
	private _connectionStatus: ConnectionStatus = 'disconnected';

	/** Get NDK instance */
	get ndk(): NDK {
		if (!this._ndk) {
			throw new NetworkError('NDK not initialized. Call init() first.', {
				code: ErrorCode.NETWORK_ERROR
			});
		}
		return this._ndk;
	}

	/** Get current signer */
	get signer(): NDKSigner | null {
		return this._signer;
	}

	/** Get current public key */
	get pubkey(): string | null {
		return this._pubkey;
	}

	/** 
	 * Get private key if available (only for NDKPrivateKeySigner)
	 * WARNING: Handle with care! Never log or expose this value.
	 */
	get privateKey(): string | null {
		if (this._signer && 'privateKey' in this._signer) {
			return (this._signer as NDKPrivateKeySigner).privateKey || null;
		}
		return null;
	}

	/** Check if private key is available for signing */
	get hasPrivateKey(): boolean {
		return this.privateKey !== null;
	}

	/** Get connection status */
	get connectionStatus(): ConnectionStatus {
		return this._connectionStatus;
	}

	/** Get connected relays */
	get connectedRelays(): string[] {
		return relayManager.getConnectedRelays();
	}

	/** Get relay health info */
	getRelayHealth(): RelayHealth[] {
		return relayManager.getAllHealth();
	}

	/** Get publish queue status */
	getPublishQueueStatus() {
		return eventPublisher.getQueueStatus();
	}

	/** Get subscription stats */
	getSubscriptionStats() {
		return subscriptionManager.getStats();
	}

	/** Initialize NDK with optional signer */
	async init(signer?: NDKSigner): Promise<void> {
		// Clean stale relays from IndexedDB first
		try {
			const removedCount = await relayManager.cleanStaleRelays();
			if (removedCount > 0) {
				console.info(`[AURA] Cleaned ${removedCount} stale relays from storage`);
			}
		} catch (e) {
			console.warn('[AURA] Failed to clean stale relays:', e);
		}

		// Get stored relays or use defaults
		const storedRelays = await db.relays.toArray();
		const relayUrls =
			storedRelays.length > 0
				? storedRelays.filter((r) => r.read || r.write).map((r) => r.url)
				: DEFAULT_RELAYS;

		// Filter out blacklisted relays
		const activeRelays = relayUrls.filter((url) => !relayManager.isBlacklisted(url));

		this._ndk = new NDK({
			explicitRelayUrls: activeRelays,
			// Disable auto-connect to unknown relays from user's NIP-65 list
			// This prevents connection attempts to potentially dead/unknown relays
			autoConnectUserRelays: false
		});

		// Initialize sub-modules
		relayManager.setNDK(this._ndk);
		eventPublisher.setNDK(this._ndk);
		subscriptionManager.setNDK(this._ndk);

		// Start health monitoring
		relayManager.startHealthMonitoring();

		if (signer) {
			await this.setSigner(signer);
		}
	}

	/**
	 * Connect to user's preferred relays with validation
	 * Validates relay health before adding to the pool
	 */
	async connectUserRelays(relayUrls: string[]): Promise<{ connected: string[]; failed: string[] }> {
		const connected: string[] = [];
		const failed: string[] = [];

		for (const url of relayUrls) {
			// Skip if already connected or blacklisted
			if (relayManager.isBlacklisted(url)) {
				failed.push(url);
				continue;
			}

			// Quick health check before adding
			const isHealthy = await relayManager.quickHealthCheck(url, 3000);
			if (!isHealthy) {
				relayManager.blacklistRelay(url);
				failed.push(url);
				continue;
			}

			try {
				await relayManager.addRelay(url);
				connected.push(url);
			} catch {
				failed.push(url);
			}
		}

		return { connected, failed };
	}

	/** Connect to relays */
	async connect(): Promise<void> {
		if (!this._ndk) {
			await this.init();
		}

		this._connectionStatus = 'connecting';

		try {
			await this._ndk!.connect();
			this._connectionStatus = 'connected';
		} catch (error) {
			console.error('Failed to connect to relays:', error);
			this._connectionStatus = 'error';
			throw new NetworkError('Failed to connect to relays', {
				code: ErrorCode.RELAY_CONNECTION_FAILED,
				cause: error instanceof Error ? error : undefined
			});
		}
	}

	/** Set signer and extract public key */
	async setSigner(signer: NDKSigner): Promise<void> {
		this._signer = signer;
		eventPublisher.setSigner(signer);

		if (this._ndk) {
			this._ndk.signer = signer;
		}

		// Extract public key from signer
		const user = await signer.user();
		this._pubkey = user.pubkey;
	}

	/** Login with NIP-07 browser extension */
	async loginWithExtension(): Promise<string> {
		if (typeof window === 'undefined' || !window.nostr) {
			throw new AuthError('No NIP-07 extension found. Please install Alby, nos2x, or similar.', {
				code: ErrorCode.NO_EXTENSION
			});
		}

		const signer = new NDKNip07Signer();
		await this.setSigner(signer);

		if (!this._ndk) {
			await this.init(signer);
		}

		return this._pubkey!;
	}

	/** Login with private key (nsec or hex) */
	async loginWithPrivateKey(privateKey: string): Promise<string> {
		let hexKey: string;

		if (privateKey.startsWith('nsec')) {
			const decoded = nip19.decode(privateKey);
			if (decoded.type !== 'nsec') {
				throw new AuthError('Invalid nsec key', { code: ErrorCode.INVALID_KEY });
			}
			const keyBytes = decoded.data as Uint8Array;
			hexKey = Array.from(keyBytes)
				.map((b) => b.toString(16).padStart(2, '0'))
				.join('');
		} else if (/^[0-9a-fA-F]{64}$/.test(privateKey)) {
			hexKey = privateKey;
		} else {
			throw new AuthError('Invalid private key format', { code: ErrorCode.INVALID_KEY });
		}

		const signer = new NDKPrivateKeySigner(hexKey);
		await this.setSigner(signer);

		if (!this._ndk) {
			await this.init(signer);
		}

		return this._pubkey!;
	}

	/** Generate new keypair */
	generateKeypair(): { privateKey: string; publicKey: string; nsec: string; npub: string } {
		const sk = generateSecretKey();
		const pk = getPublicKey(sk);

		const skHex = Array.from(sk)
			.map((b) => b.toString(16).padStart(2, '0'))
			.join('');

		return {
			privateKey: skHex,
			publicKey: pk,
			nsec: nip19.nsecEncode(sk),
			npub: nip19.npubEncode(pk)
		};
	}

	/** Login with newly generated keypair */
	async loginWithNewKeypair(): Promise<{
		pubkey: string;
		nsec: string;
		npub: string;
	}> {
		const keypair = this.generateKeypair();
		await this.loginWithPrivateKey(keypair.privateKey);

		return {
			pubkey: keypair.publicKey,
			nsec: keypair.nsec,
			npub: keypair.npub
		};
	}

	/** Logout - clear signer and pubkey */
	logout(): void {
		this._signer = null;
		this._pubkey = null;
		eventPublisher.setSigner(null);

		if (this._ndk) {
			this._ndk.signer = undefined;
		}
	}

	/** Subscribe to events */
	subscribe(
		filter: NDKFilter | NDKFilter[],
		opts?: import('@nostr-dev-kit/ndk').NDKSubscriptionOptions,
		callbacks?: SubscriptionCallbacks,
		label?: string
	): string {
		return subscriptionManager.subscribe(filter, opts, callbacks, label);
	}

	/** Unsubscribe */
	unsubscribe(id: string): boolean {
		return subscriptionManager.unsubscribe(id);
	}

	/** Publish an event */
	async publish(event: NDKEvent): Promise<Set<NDKRelay>> {
		if (!this._signer) {
			throw new AuthError('No signer available. Please login first.', {
				code: ErrorCode.AUTH_FAILED
			});
		}

		return eventPublisher.publish(event);
	}

	/** Create and publish a text note (kind 1) */
	async publishNote(content: string, replyTo?: NDKEvent): Promise<NDKEvent> {
		const event = new NDKEvent(this.ndk);
		event.kind = 1;
		event.content = content;

		// Add client tag for brand visibility
		event.tags.push(['client', 'AURA']);

		if (replyTo) {
			event.tags.push(['e', replyTo.id, '', 'reply']);
			event.tags.push(['p', replyTo.pubkey]);

			const rootTag = replyTo.tags.find((t) => t[0] === 'e' && t[3] === 'root');
			if (rootTag) {
				event.tags.push(['e', rootTag[1], '', 'root']);
			} else {
				event.tags.push(['e', replyTo.id, '', 'root']);
			}
		}

		await this.publish(event);
		return event;
	}

	/** Fetch user profile (kind 0) */
	async fetchProfile(pubkey: string): Promise<NDKEvent | null> {
		const cached = await dbHelpers.getProfile(pubkey);
		if (cached && Date.now() - cached.updated_at < 5 * 60 * 1000) {
			return null;
		}

		const filter: NDKFilter = {
			kinds: [0],
			authors: [pubkey],
			limit: 1
		};

		const events = await this.ndk.fetchEvents(filter);
		const event = Array.from(events)[0];

		if (event) {
			try {
				// Sanitize content before parsing (remove control characters that break JSON)
				// Replace unescaped newlines/tabs with escaped versions or remove them
				let cleanContent = event.content.trim();

				// Remove BOM if present
				if (cleanContent.charCodeAt(0) === 0xFEFF) {
					cleanContent = cleanContent.slice(1);
				}

				// Replace control characters
				cleanContent = cleanContent.replace(/[\x00-\x1F\x7F-\x9F]/g, (char) => {
					switch (char) {
						case '\n': return '\\n';
						case '\r': return '\\r';
						case '\t': return '\\t';
						case '\b': return '\\b';
						case '\f': return '\\f';
						default: return ''; // Remove other control chars
					}
				});

				// Skip if not valid JSON object
				if (!cleanContent.startsWith('{')) {
					console.warn('Profile content is not a JSON object for', pubkey);
					return event;
				}

				const profile = JSON.parse(cleanContent);
				await dbHelpers.saveProfile({
					pubkey,
					...profile,
					updated_at: Date.now()
				});
			} catch (e) {
				console.warn('Failed to parse profile for', pubkey, e);
			}
		}

		return event || null;
	}

	/** React to an event (kind 7) */
	async react(targetEvent: NDKEvent, reaction: string = '+'): Promise<NDKEvent> {
		const event = new NDKEvent(this.ndk);
		event.kind = 7;
		event.content = reaction;
		event.tags = [
			['e', targetEvent.id],
			['p', targetEvent.pubkey],
			['client', 'AURA']
		];

		await this.publish(event);
		return event;
	}

	/** Repost an event (kind 6) */
	async repost(targetEvent: NDKEvent): Promise<NDKEvent> {
		const event = new NDKEvent(this.ndk);
		event.kind = 6;
		event.content = JSON.stringify(targetEvent.rawEvent());
		event.tags = [
			['e', targetEvent.id, '', 'mention'],
			['p', targetEvent.pubkey],
			['client', 'AURA']
		];

		await this.publish(event);
		return event;
	}

	/** Delete an event (kind 5) */
	async deleteEvent(eventId: string, reason?: string): Promise<NDKEvent> {
		const event = new NDKEvent(this.ndk);
		event.kind = 5;
		event.content = reason || '';
		event.tags = [['e', eventId]];

		await this.publish(event);
		return event;
	}

	/** Add a relay */
	async addRelay(url: string, read: boolean = true, write: boolean = true): Promise<void> {
		await relayManager.addRelay(url, read, write);
	}

	/** Remove a relay */
	async removeRelay(url: string): Promise<void> {
		await relayManager.removeRelay(url);
	}

	/** Close all subscriptions and disconnect */
	async disconnect(): Promise<void> {
		subscriptionManager.unsubscribeAll();
		relayManager.stopHealthMonitoring();
		this._connectionStatus = 'disconnected';
	}
}

/** Singleton instance */
export const ndkService = new NDKService();

export default ndkService;
