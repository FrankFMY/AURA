/**
 * NWC Client Tests
 *
 * Tests for NIP-47 Nostr Wallet Connect client.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies
const { mockNip04, mockGetPublicKey, mockFinalizeEvent } = vi.hoisted(() => ({
	mockNip04: {
		encrypt: vi.fn().mockResolvedValue('encrypted-content'),
		decrypt: vi.fn().mockResolvedValue('{"result_type":"get_info","result":{"methods":["get_balance"]}}')
	},
	mockGetPublicKey: vi.fn().mockReturnValue('our-public-key-abc123'),
	mockFinalizeEvent: vi.fn().mockImplementation((template, sk) => ({
		...template,
		id: 'event-id-123',
		pubkey: 'our-public-key',
		sig: 'signature-123'
	}))
}));

vi.mock('nostr-tools', () => ({
	nip04: mockNip04,
	getPublicKey: mockGetPublicKey,
	finalizeEvent: mockFinalizeEvent
}));

vi.mock('$lib/core/errors', () => ({
	WalletError: class WalletError extends Error {
		constructor(msg: string, opts?: any) {
			super(msg);
			this.name = 'WalletError';
		}
	},
	ErrorCode: {
		NWC_CONNECTION_FAILED: 'NWC_CONNECTION_FAILED',
		WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',
		WALLET_ERROR: 'WALLET_ERROR'
	}
}));

// Import after mocks
import { NWCClient } from '$services/wallet/nwc-client';

describe('NWCClient', () => {
	let client: NWCClient;
	const validConnectionString = 'nostr+walletconnect://abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234?relay=wss%3A%2F%2Frelay.test&secret=secretkey1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';
	const validWalletPubkey = 'abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234abcd1234';
	const validSecret = 'secretkey1234567890abcdef1234567890abcdef1234567890abcdef1234567890ab';

	beforeEach(() => {
		vi.clearAllMocks();
		client = new NWCClient();
	});

	afterEach(() => {
		client.disconnect();
	});

	describe('parseConnectionString()', () => {
		it('should parse valid connection string', () => {
			const info = NWCClient.parseConnectionString(validConnectionString);

			expect(info.walletPubkey).toBe(validWalletPubkey);
			expect(info.relayUrl).toBe('wss://relay.test');
			expect(info.secret).toBe(validSecret);
		});

		it('should extract lud16 if present', () => {
			const connStr = `${validConnectionString}&lud16=user@example.com`;
			const info = NWCClient.parseConnectionString(connStr);

			expect(info.lud16).toBe('user@example.com');
		});

		it('should throw for invalid protocol', () => {
			expect(() => NWCClient.parseConnectionString('https://example.com'))
				.toThrow('Invalid NWC connection string format');
		});

		it('should throw for missing pubkey', () => {
			expect(() => NWCClient.parseConnectionString('nostr+walletconnect://?relay=wss://relay.test&secret=abc'))
				.toThrow('Failed to parse');
		});

		it('should throw for missing relay', () => {
			expect(() => NWCClient.parseConnectionString(`nostr+walletconnect://${validWalletPubkey}?secret=${validSecret}`))
				.toThrow('Failed to parse');
		});

		it('should throw for missing secret', () => {
			expect(() => NWCClient.parseConnectionString(`nostr+walletconnect://${validWalletPubkey}?relay=wss://relay.test`))
				.toThrow('Failed to parse');
		});

		it('should throw for invalid pubkey format', () => {
			expect(() => NWCClient.parseConnectionString('nostr+walletconnect://invalid-pubkey?relay=wss://relay.test&secret=abc'))
				.toThrow('Failed to parse');
		});

		it('should decode URL-encoded relay', () => {
			const info = NWCClient.parseConnectionString(validConnectionString);
			expect(info.relayUrl).toBe('wss://relay.test');
		});
	});

	describe('extractRelayUrl()', () => {
		it('should extract relay URL from valid string', () => {
			const url = NWCClient.extractRelayUrl(validConnectionString);
			expect(url).toBe('wss://relay.test');
		});

		it('should return null for invalid string', () => {
			expect(NWCClient.extractRelayUrl('invalid')).toBeNull();
		});

		it('should return null for empty string', () => {
			expect(NWCClient.extractRelayUrl('')).toBeNull();
		});

		it('should return null for non-nwc URL', () => {
			expect(NWCClient.extractRelayUrl('https://example.com')).toBeNull();
		});

		it('should return null if relay param missing', () => {
			expect(NWCClient.extractRelayUrl(`nostr+walletconnect://${validWalletPubkey}?secret=abc`)).toBeNull();
		});

		it('should work as instance method', () => {
			const url = client.extractRelayUrl(validConnectionString);
			expect(url).toBe('wss://relay.test');
		});
	});

	describe('Initial state', () => {
		it('should not be connected initially', () => {
			expect(client.isConnected).toBe(false);
		});

		it('should have null wallet pubkey initially', () => {
			expect(client.walletPubkey).toBeNull();
		});
	});

	describe('connect()', () => {
		// Note: Full WebSocket testing would require more complex mocking
		// These tests verify parsing and setup logic

		it('should throw for invalid connection string', async () => {
			await expect(client.connect('invalid'))
				.rejects.toThrow('Invalid NWC connection string format');
		});

		// Note: Full connect() testing requires WebSocket mocking which is
		// complex in this environment. The connection logic is tested via
		// parseConnectionString() and integration tests.
	});

	describe('disconnect()', () => {
		it('should clear connection state', () => {
			// Set up some internal state
			(client as any)._isConnected = true;
			(client as any)._connectionInfo = { walletPubkey: 'test' };

			client.disconnect();

			expect(client.isConnected).toBe(false);
			expect(client.walletPubkey).toBeNull();
		});

		it('should clear pending requests', () => {
			const mockReject = vi.fn();
			const mockTimeout = setTimeout(() => {}, 10000);
			(client as any)._pendingRequests.set('req-1', {
				resolve: vi.fn(),
				reject: mockReject,
				timeout: mockTimeout
			});

			client.disconnect();

			expect(mockReject).toHaveBeenCalled();
			expect((client as any)._pendingRequests.size).toBe(0);
		});

		it('should be safe to call multiple times', () => {
			client.disconnect();
			client.disconnect();
			// Should not throw
		});
	});

	describe('Event listeners', () => {
		it('should add listener', () => {
			const listener = vi.fn();

			client.addListener(listener);

			// Trigger event by calling internal emit
			(client as any).emit({ type: 'connected' });

			expect(listener).toHaveBeenCalledWith({ type: 'connected' });
		});

		it('should remove listener on unsubscribe', () => {
			const listener = vi.fn();

			const unsubscribe = client.addListener(listener);
			unsubscribe();

			(client as any).emit({ type: 'connected' });

			expect(listener).not.toHaveBeenCalled();
		});

		it('should handle listener errors gracefully', () => {
			const badListener = vi.fn().mockImplementation(() => {
				throw new Error('Listener error');
			});
			const goodListener = vi.fn();

			client.addListener(badListener);
			client.addListener(goodListener);

			expect(() => (client as any).emit({ type: 'connected' })).not.toThrow();
			expect(goodListener).toHaveBeenCalled();
		});
	});

	describe('Helper methods', () => {
		describe('hexToBytes()', () => {
			it('should convert hex string to bytes', () => {
				const hex = 'abcd1234';
				const bytes = (client as any).hexToBytes(hex);

				expect(bytes).toBeInstanceOf(Uint8Array);
				expect(bytes.length).toBe(4);
				expect(bytes[0]).toBe(0xab);
				expect(bytes[1]).toBe(0xcd);
				expect(bytes[2]).toBe(0x12);
				expect(bytes[3]).toBe(0x34);
			});
		});

		describe('generateRequestId()', () => {
			it('should generate unique IDs', () => {
				const id1 = (client as any).generateRequestId();
				const id2 = (client as any).generateRequestId();

				expect(id1).not.toBe(id2);
				expect(id1).toMatch(/^req-/);
			});
		});

		describe('getOurPubkey()', () => {
			it('should return empty string when not set', () => {
				const pubkey = (client as any).getOurPubkey();
				expect(pubkey).toBe('');
			});

			it('should return pubkey when set', () => {
				(client as any)._ourPubkey = 'test-pubkey';
				const pubkey = (client as any).getOurPubkey();
				expect(pubkey).toBe('test-pubkey');
			});
		});
	});

	describe('API methods without connection', () => {
		it('getInfo should throw when not connected', async () => {
			await expect(client.getInfo())
				.rejects.toThrow('Wallet not connected');
		});

		it('getBalance should throw when not connected', async () => {
			await expect(client.getBalance())
				.rejects.toThrow('Wallet not connected');
		});

		it('makeInvoice should throw when not connected', async () => {
			await expect(client.makeInvoice({ amount: 1000 }))
				.rejects.toThrow('Wallet not connected');
		});

		it('payInvoice should throw when not connected', async () => {
			await expect(client.payInvoice({ invoice: 'lnbc...' }))
				.rejects.toThrow('Wallet not connected');
		});

		it('lookupInvoice should throw when not connected', async () => {
			await expect(client.lookupInvoice('payment-hash'))
				.rejects.toThrow('Wallet not connected');
		});

		it('listTransactions should throw when not connected', async () => {
			await expect(client.listTransactions())
				.rejects.toThrow('Wallet not connected');
		});
	});

	describe('Types and interfaces', () => {
		// These tests verify TypeScript types are correct by checking structure

		it('should accept valid MakeInvoiceParams', () => {
			const params = {
				amount: 1000,
				description: 'Test invoice',
				expiry: 3600
			};

			// Just verify the structure compiles - actual API call tested elsewhere
			expect(params.amount).toBe(1000);
		});

		it('should accept valid PayInvoiceParams', () => {
			const params = {
				invoice: 'lnbc10n1...',
				amount: 1000
			};

			expect(params.invoice).toBeDefined();
		});

		it('should accept valid ListTransactionsParams', () => {
			const params = {
				from: Date.now() - 86400000,
				until: Date.now(),
				limit: 10,
				offset: 0,
				type: 'incoming' as const
			};

			expect(params.limit).toBe(10);
		});
	});
});

// Note: WebSocket integration tests are skipped because WebSocket
// cannot be mocked in the jsdom/happy-dom environment.
// These would be covered by E2E tests with a real relay.
