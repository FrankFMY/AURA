import { z } from 'zod';

/**
 * Nostr public key validation (64 char hex)
 */
export const pubkeySchema = z
	.string()
	.regex(/^[0-9a-fA-F]{64}$/, 'Invalid public key format');

/**
 * Nostr npub validation (bech32 encoded pubkey)
 */
export const npubSchema = z
	.string()
	.regex(/^npub1[a-z0-9]{58}$/i, 'Invalid npub format');

/**
 * Nostr nsec validation (bech32 encoded private key)
 */
export const nsecSchema = z
	.string()
	.regex(/^nsec1[a-z0-9]{58}$/i, 'Invalid nsec format');

/**
 * Nostr private key validation (64 char hex or nsec)
 */
export const privateKeySchema = z.union([
	z.string().regex(/^[0-9a-fA-F]{64}$/, 'Invalid hex private key'),
	nsecSchema
]);

/**
 * Nostr event ID validation
 */
export const eventIdSchema = z
	.string()
	.regex(/^[0-9a-fA-F]{64}$/, 'Invalid event ID format');

/**
 * Note ID (bech32 encoded)
 */
export const noteIdSchema = z
	.string()
	.regex(/^note1[a-z0-9]{58}$/i, 'Invalid note ID format');

/**
 * Relay URL validation
 */
export const relayUrlSchema = z
	.string()
	.url('Invalid URL format')
	.refine(
		(url) => url.startsWith('wss://') || url.startsWith('ws://'),
		'Relay URL must use WebSocket protocol (wss:// or ws://)'
	);

/**
 * NWC connection string validation
 */
export const nwcUrlSchema = z
	.string()
	.refine(
		(url) => url.startsWith('nostr+walletconnect://'),
		'NWC URL must start with nostr+walletconnect://'
	)
	.refine((url) => {
		try {
			const parsed = new URL(url);
			return (
				parsed.searchParams.has('relay') && parsed.searchParams.has('secret')
			);
		} catch {
			return false;
		}
	}, 'NWC URL must contain relay and secret parameters');

/**
 * Lightning address validation (lud16)
 */
export const lightningAddressSchema = z
	.string()
	.email('Invalid Lightning address format')
	.refine(
		(addr) => !addr.includes('+'),
		'Lightning address cannot contain + character'
	);

/**
 * BOLT11 invoice validation (basic)
 */
export const bolt11Schema = z
	.string()
	.regex(/^ln(bc|tb|tbs)[0-9a-z]+$/i, 'Invalid BOLT11 invoice format');

/**
 * NIP-05 identifier validation
 */
export const nip05Schema = z
	.string()
	.regex(
		/^[a-z0-9._-]+@[a-z0-9.-]+\.[a-z]{2,}$/i,
		'Invalid NIP-05 identifier format'
	);

/**
 * Note content validation
 */
export const noteContentSchema = z
	.string()
	.min(1, 'Note content cannot be empty')
	.max(10000, 'Note content exceeds maximum length of 10000 characters');

/**
 * Search query validation
 */
export const searchQuerySchema = z
	.string()
	.min(1, 'Search query cannot be empty')
	.max(500, 'Search query exceeds maximum length')
	.transform((s) => s.trim());

/**
 * Profile metadata validation
 */
export const profileMetadataSchema = z.object({
	name: z
		.string()
		.max(100, 'Name exceeds maximum length')
		.optional(),
	display_name: z
		.string()
		.max(100, 'Display name exceeds maximum length')
		.optional(),
	about: z
		.string()
		.max(2000, 'About exceeds maximum length')
		.optional(),
	picture: z.string().url('Invalid picture URL').optional().or(z.literal('')),
	banner: z.string().url('Invalid banner URL').optional().or(z.literal('')),
	nip05: nip05Schema.optional().or(z.literal('')),
	lud16: lightningAddressSchema.optional().or(z.literal('')),
	website: z.string().url('Invalid website URL').optional().or(z.literal(''))
});

/**
 * Zap amount validation
 */
export const zapAmountSchema = z
	.number()
	.int('Zap amount must be a whole number')
	.min(1, 'Minimum zap amount is 1 sat')
	.max(10_000_000, 'Maximum zap amount is 10M sats');

/**
 * Relay configuration validation
 */
export const relayConfigSchema = z.object({
	url: relayUrlSchema,
	read: z.boolean().default(true),
	write: z.boolean().default(true)
});

/**
 * Helper function to validate and parse with better error messages
 */
export function validate<T>(
	schema: z.ZodSchema<T>,
	data: unknown
): { success: true; data: T } | { success: false; error: string } {
	const result = schema.safeParse(data);

	if (result.success) {
		return { success: true, data: result.data };
	}

	// Format error message
	const firstError = result.error.issues[0];
	const path = firstError.path.length > 0 ? `${firstError.path.join('.')}: ` : '';
	const error = `${path}${firstError.message}`;

	return { success: false, error };
}

/**
 * Validate pubkey (hex or npub)
 */
export function validatePubkey(input: string): string | null {
	// Try hex format first
	if (pubkeySchema.safeParse(input).success) {
		return input;
	}

	// Try npub format
	if (npubSchema.safeParse(input).success) {
		try {
			const { nip19 } = require('nostr-tools');
			const decoded = nip19.decode(input);
			if (decoded.type === 'npub') {
				return decoded.data as string;
			}
		} catch {
			return null;
		}
	}

	return null;
}

/**
 * Validate private key (hex or nsec)
 */
export function validatePrivateKey(input: string): string | null {
	// Try hex format first
	if (/^[0-9a-fA-F]{64}$/.test(input)) {
		return input;
	}

	// Try nsec format
	if (nsecSchema.safeParse(input).success) {
		try {
			const { nip19 } = require('nostr-tools');
			const decoded = nip19.decode(input);
			if (decoded.type === 'nsec') {
				// Convert Uint8Array to hex
				const bytes = decoded.data as Uint8Array;
				return Array.from(bytes)
					.map((b) => b.toString(16).padStart(2, '0'))
					.join('');
			}
		} catch {
			return null;
		}
	}

	return null;
}

export default {
	pubkeySchema,
	npubSchema,
	nsecSchema,
	privateKeySchema,
	eventIdSchema,
	noteIdSchema,
	relayUrlSchema,
	nwcUrlSchema,
	lightningAddressSchema,
	bolt11Schema,
	nip05Schema,
	noteContentSchema,
	searchQuerySchema,
	profileMetadataSchema,
	zapAmountSchema,
	relayConfigSchema,
	validate,
	validatePubkey,
	validatePrivateKey
};
