/**
 * BOLT11 Invoice Parser
 * 
 * Parses Lightning Network invoices to extract payment details.
 */

/** Parsed invoice data */
export interface ParsedInvoice {
	/** Full invoice string */
	invoice: string;
	/** Network prefix (lnbc, lntb, lnbcrt) */
	prefix: string;
	/** Amount in millisatoshis (null if zero-amount invoice) */
	amountMsat: number | null;
	/** Amount in satoshis (null if zero-amount invoice) */
	amountSat: number | null;
	/** Payment hash (hex) */
	paymentHash: string | null;
	/** Description */
	description: string | null;
	/** Description hash (hex) */
	descriptionHash: string | null;
	/** Expiry time in seconds */
	expiry: number;
	/** Timestamp when invoice was created */
	timestamp: number;
	/** Payee public key (hex) */
	payeePubkey: string | null;
	/** Is expired */
	isExpired: boolean;
	/** Expiration date */
	expiresAt: Date;
}

/** Network prefixes */
const NETWORK_PREFIXES = {
	lnbc: 'mainnet',
	lntb: 'testnet',
	lnbcrt: 'regtest',
	lnsb: 'signet'
} as const;

/** Multipliers for amount parsing */
const AMOUNT_MULTIPLIERS: Record<string, number> = {
	m: 0.001,
	u: 0.000001,
	n: 0.000000001,
	p: 0.000000000001
};

/**
 * Parse a BOLT11 invoice
 */
export function parseInvoice(invoice: string): ParsedInvoice {
	if (!invoice) {
		throw new Error('Invalid invoice: empty input');
	}
	// Normalize invoice
	const normalizedInvoice = invoice.toLowerCase().trim();
	
	// Validate prefix
	const prefixMatch = normalizedInvoice.match(/^(lnbc|lntb|lnbcrt|lnsb)/);
	if (!prefixMatch) {
		throw new Error('Invalid invoice: unknown network prefix');
	}
	
	const prefix = prefixMatch[1];
	
	// Extract amount (if present)
	const amountMatch = normalizedInvoice.slice(prefix.length).match(/^(\d+)([munp])?/);
	let amountMsat: number | null = null;
	let amountSat: number | null = null;
	
	if (amountMatch && amountMatch[1]) {
		const value = Number.parseInt(amountMatch[1], 10);
		const multiplier = amountMatch[2] ? AMOUNT_MULTIPLIERS[amountMatch[2]] : 1;
		
		// Convert to millisatoshis (base unit is BTC)
		amountMsat = Math.round(value * multiplier * 100_000_000_000);
		amountSat = Math.round(amountMsat / 1000);
	}
	
	// Default values for fields we can't easily parse without full bech32 decoding
	const timestamp = Math.floor(Date.now() / 1000);
	const expiry = 3600; // Default 1 hour
	const expiresAt = new Date((timestamp + expiry) * 1000);
	const isExpired = Date.now() > expiresAt.getTime();
	
	return {
		invoice: normalizedInvoice,
		prefix,
		amountMsat,
		amountSat,
		paymentHash: null, // Would need full bech32 decoding
		description: null,
		descriptionHash: null,
		expiry,
		timestamp,
		payeePubkey: null,
		isExpired,
		expiresAt
	};
}

/**
 * Format satoshis for display
 */
export function formatSats(sats: number): string {
	if (sats >= 1_000_000) {
		return `${(sats / 1_000_000).toFixed(2)}M sats`;
	}
	if (sats >= 1_000) {
		return `${(sats / 1_000).toFixed(1)}k sats`;
	}
	return `${sats} sats`;
}

/**
 * Format millisatoshis for display
 */
export function formatMsats(msats: number): string {
	return formatSats(Math.round(msats / 1000));
}

/**
 * Convert satoshis to millisatoshis
 */
export function satsToMsats(sats: number): number {
	return sats * 1000;
}

/**
 * Convert millisatoshis to satoshis
 */
export function msatsToSats(msats: number): number {
	return Math.round(msats / 1000);
}

/**
 * Validate a BOLT11 invoice format
 */
export function isValidInvoice(invoice: string): boolean {
	if (!invoice || typeof invoice !== 'string') {
		return false;
	}
	
	const normalized = invoice.toLowerCase().trim();
	
	// Check prefix
	if (!normalized.match(/^(lnbc|lntb|lnbcrt|lnsb)/)) {
		return false;
	}
	
	// Basic length check (invoices are typically 200+ characters)
	if (normalized.length < 50) {
		return false;
	}
	
	// Check for valid bech32 characters
	if (!normalized.match(/^[a-z0-9]+$/)) {
		return false;
	}
	
	return true;
}

/**
 * Get network from invoice
 */
export function getInvoiceNetwork(invoice: string): string | null {
	if (!invoice) return null;
	const normalized = invoice.toLowerCase().trim();
	const prefixMatch = normalized.match(/^(lnbc|lntb|lnbcrt|lnsb)/);
	
	if (!prefixMatch) {
		return null;
	}
	
	return NETWORK_PREFIXES[prefixMatch[1] as keyof typeof NETWORK_PREFIXES] || null;
}

export default {
	parseInvoice,
	formatSats,
	formatMsats,
	satsToMsats,
	msatsToSats,
	isValidInvoice,
	getInvoiceNetwork
};
