/**
 * NIP-05 Verification Service
 *
 * Verifies NIP-05 identifiers by checking /.well-known/nostr.json
 * with caching and CORS-safe fetching.
 */

import { dbHelpers } from '$db';

/** Verification result */
export interface NIP05VerificationResult {
	/** Whether the NIP-05 is verified */
	verified: boolean;
	/** When verification was checked */
	checkedAt: number;
	/** The identifier that was verified */
	identifier: string;
	/** Error message if verification failed */
	error?: string;
}

/** Cache entry */
interface CacheEntry {
	result: NIP05VerificationResult;
	expiresAt: number;
}

/** Cache TTL: 5 minutes for successful, 1 minute for failed */
const SUCCESS_TTL = 5 * 60 * 1000; // 5 minutes
const FAILURE_TTL = 60 * 1000; // 1 minute

/** In-memory cache */
const cache = new Map<string, CacheEntry>();

/** Pending verifications (dedup) */
const pending = new Map<string, Promise<NIP05VerificationResult>>();

/**
 * Parse NIP-05 identifier into name and domain
 * @example "bob@example.com" -> { name: "bob", domain: "example.com" }
 */
function parseNIP05(identifier: string): { name: string; domain: string } | null {
	if (!identifier || !identifier.includes('@')) {
		return null;
	}

	const [name, domain] = identifier.split('@');
	if (!name || !domain) {
		return null;
	}

	// Basic domain validation
	if (!domain.includes('.') || domain.length < 4) {
		return null;
	}

	return { name: name.toLowerCase(), domain: domain.toLowerCase() };
}

/**
 * Fetch /.well-known/nostr.json from domain
 */
async function fetchNostrJson(domain: string, name: string): Promise<string | null> {
	// Build URL with name query parameter
	const url = `https://${domain}/.well-known/nostr.json?name=${encodeURIComponent(name)}`;

	try {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 5000);

		const response = await fetch(url, {
			method: 'GET',
			signal: controller.signal,
			headers: {
				'Accept': 'application/json'
			}
		});

		clearTimeout(timeout);

		if (!response.ok) {
			return null;
		}

		const data = await response.json();

		// Extract pubkey for the name
		if (data.names && typeof data.names === 'object') {
			const pubkey = data.names[name] || data.names[name.toLowerCase()];
			if (typeof pubkey === 'string' && pubkey.length === 64) {
				return pubkey;
			}
		}

		return null;
	} catch (e) {
		// CORS error, network error, or timeout
		console.warn(`[NIP-05] Failed to fetch from ${domain}:`, e);
		return null;
	}
}

/**
 * Verify a NIP-05 identifier against a pubkey
 * @param identifier NIP-05 identifier (e.g., "bob@example.com")
 * @param pubkey Expected pubkey (hex)
 * @returns Verification result
 */
export async function verifyNIP05(
	identifier: string,
	pubkey: string
): Promise<NIP05VerificationResult> {
	const cacheKey = `${identifier}:${pubkey}`;

	// Check in-memory cache
	const cached = cache.get(cacheKey);
	if (cached && cached.expiresAt > Date.now()) {
		return cached.result;
	}

	// Check if already pending
	const pendingVerification = pending.get(cacheKey);
	if (pendingVerification) {
		return pendingVerification;
	}

	// Start verification
	const verificationPromise = doVerify(identifier, pubkey);
	pending.set(cacheKey, verificationPromise);

	try {
		const result = await verificationPromise;

		// Cache result
		const ttl = result.verified ? SUCCESS_TTL : FAILURE_TTL;
		cache.set(cacheKey, {
			result,
			expiresAt: Date.now() + ttl
		});

		// Also persist to IndexedDB for offline access
		try {
			const dbKey = `nip05:${cacheKey}`;
			await dbHelpers.setSetting(dbKey, {
				...result,
				expiresAt: Date.now() + ttl
			});
		} catch (e) {
			console.warn('[NIP-05] Failed to persist verification:', e);
		}

		return result;
	} finally {
		pending.delete(cacheKey);
	}
}

/**
 * Internal verification logic
 */
async function doVerify(
	identifier: string,
	pubkey: string
): Promise<NIP05VerificationResult> {
	const parsed = parseNIP05(identifier);

	if (!parsed) {
		return {
			verified: false,
			checkedAt: Date.now(),
			identifier,
			error: 'Invalid NIP-05 format'
		};
	}

	const { name, domain } = parsed;

	try {
		const verifiedPubkey = await fetchNostrJson(domain, name);

		if (!verifiedPubkey) {
			return {
				verified: false,
				checkedAt: Date.now(),
				identifier,
				error: 'Not found in nostr.json'
			};
		}

		// Compare pubkeys (case-insensitive hex)
		const isMatch = verifiedPubkey.toLowerCase() === pubkey.toLowerCase();

		return {
			verified: isMatch,
			checkedAt: Date.now(),
			identifier,
			error: isMatch ? undefined : 'Pubkey mismatch'
		};
	} catch (e) {
		return {
			verified: false,
			checkedAt: Date.now(),
			identifier,
			error: e instanceof Error ? e.message : 'Verification failed'
		};
	}
}

/**
 * Get cached verification (sync)
 * Returns null if not in cache
 */
export function getCachedVerification(
	identifier: string,
	pubkey: string
): NIP05VerificationResult | null {
	const cacheKey = `${identifier}:${pubkey}`;
	const cached = cache.get(cacheKey);

	if (cached && cached.expiresAt > Date.now()) {
		return cached.result;
	}

	return null;
}

/**
 * Load verification from IndexedDB (for initial render)
 */
export async function loadCachedVerification(
	identifier: string,
	pubkey: string
): Promise<NIP05VerificationResult | null> {
	const cacheKey = `${identifier}:${pubkey}`;
	const dbKey = `nip05:${cacheKey}`;

	try {
		const stored = await dbHelpers.getSetting<NIP05VerificationResult & { expiresAt: number } | null>(
			dbKey,
			undefined
		) ?? null;

		if (stored && stored.expiresAt > Date.now()) {
			// Also populate in-memory cache
			cache.set(cacheKey, {
				result: stored,
				expiresAt: stored.expiresAt
			});
			return stored;
		}

		return null;
	} catch (e) {
		return null;
	}
}

/**
 * Clear all cached verifications
 */
export function clearCache(): void {
	cache.clear();
}

export default {
	verifyNIP05,
	getCachedVerification,
	loadCachedVerification,
	clearCache
};
