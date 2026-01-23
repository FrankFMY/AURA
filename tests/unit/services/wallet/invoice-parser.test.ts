import { describe, it, expect } from 'vitest';
import {
	parseInvoice,
	isValidInvoice,
	formatSats,
	satsToMsats,
	msatsToSats,
	getInvoiceNetwork
} from '$lib/services/wallet/invoice-parser';

// Note: Using a simplified mock invoice structure as the parser is not a full bech32 decoder.
const mockMainnetInvoice =
	'lnbc100u1p3pj257pp5e8w8cr55rrdevk06z5sh2gc2a8x3anx2a9jnxu6p5xuxgr8j3qsdq2pskjepqsw3hjq4afd3skucqzzsxqyz5vqsp5wylt9z2gjwk4qtxq88xxs822p05x2t4kj7afy7a3j28z08sdq9qyyssq8gf6ddh8qeyfeazg6qjey8k3z5atfz6p6hhdj9kswd5e23cs80m24n9z4vxt6jvev92a08v003v5u5p0ws5d625f3u4v4wzp0lq6n4n4cqqj4aqq7j';
const mockTestnetInvoice =
	'lntb100u1p3pj257pp5e8w8cr55rrdevk06z5sh2gc2a8x3anx2a9jnxu6p5xuxgr8j3qsdq2pskjepqsw3hjq4afd3skucqzzsxqyz5vqsp5wylt9z2gjwk4qtxq88xxs822p05x2t4kj7afy7a3j28z08sdq9qyyssq8gf6ddh8qeyfeazg6qjey8k3z5atfz6p6hhdj9kswd5e23cs80m24n9z4vxt6jvev92a08v003v5u5p0ws5d625f3u4v4wzp0lq6n4n4cqqj4aqq7j';

describe('invoice-parser', () => {
	describe('parseInvoice', () => {
		it('should parse a mainnet invoice with amount', () => {
			const parsed = parseInvoice(mockMainnetInvoice);
			expect(parsed.prefix).toBe('lnbc');
			expect(parsed.amountMsat).toBe(10_000_000); // 100u * 100_000_000 * 0.000001
			expect(parsed.amountSat).toBe(10000);
			expect(parsed.invoice).toBe(mockMainnetInvoice);
		});

		it('should parse a testnet invoice', () => {
			const parsed = parseInvoice(mockTestnetInvoice);
			expect(parsed.prefix).toBe('lntb');
		});
		
		it('should handle zero-amount invoices', () => {
			const zeroAmountInvoice = 'lnbc' + 'a'.repeat(150);
			const parsed = parseInvoice(zeroAmountInvoice);
			expect(parsed.amountMsat).toBeNull();
			expect(parsed.amountSat).toBeNull();
		});

		it('should throw an error for invalid prefixes', () => {
			const invalidInvoice = 'invalidprefix12345';
			expect(() => parseInvoice(invalidInvoice)).toThrow('Invalid invoice: unknown network prefix');
		});
	});

	describe('isValidInvoice', () => {
		it('should return true for a valid-looking invoice', () => {
			expect(isValidInvoice(mockMainnetInvoice)).toBe(true);
		});

		it('should return false for an invalid prefix', () => {
			expect(isValidInvoice('lnxx1...')).toBe(false);
		});

		it('should return false for invoices that are too short', () => {
			expect(isValidInvoice('lnbc123')).toBe(false);
		});

		it('should return false for invalid characters', () => {
			expect(isValidInvoice(mockMainnetInvoice + '!')).toBe(false);
		});

		it('should return false for null or empty input', () => {
			expect(isValidInvoice('')).toBe(false);
			// @ts-expect-error - testing invalid input
			expect(isValidInvoice(null)).toBe(false);
		});
	});

	describe('getInvoiceNetwork', () => {
		it('should return "mainnet" for lnbc prefix', () => {
			expect(getInvoiceNetwork(mockMainnetInvoice)).toBe('mainnet');
		});

		it('should return "testnet" for lntb prefix', () => {
			expect(getInvoiceNetwork(mockTestnetInvoice)).toBe('testnet');
		});

		it('should return null for an unknown prefix', () => {
			expect(getInvoiceNetwork('lnxx1...')).toBeNull();
		});
	});

	describe('formatSats', () => {
		it('should format numbers less than 1000', () => {
			expect(formatSats(999)).toBe('999 sats');
		});

		it('should format numbers in the thousands with "k"', () => {
			expect(formatSats(1500)).toBe('1.5k sats');
			expect(formatSats(12345)).toBe('12.3k sats');
		});

		it('should format numbers in the millions with "M"', () => {
			expect(formatSats(1_000_000)).toBe('1.00M sats');
			expect(formatSats(1_550_000)).toBe('1.55M sats');
		});
	});

	describe('satsToMsats and msatsToSats', () => {
		it('should correctly convert sats to msats', () => {
			expect(satsToMsats(100)).toBe(100000);
		});

		it('should correctly convert msats to sats', () => {
			expect(msatsToSats(100500)).toBe(101); // rounds up
			expect(msatsToSats(99499)).toBe(99); // rounds down
		});
	});
});
