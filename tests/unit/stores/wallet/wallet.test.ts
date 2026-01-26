import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test fixtures
const TEST_NWC_URI = 'nostr+walletconnect://abc123?relay=wss://relay.test&secret=secret123';
const TEST_BALANCE_MSATS = 100000; // 100 sats
const TEST_INVOICE = 'lnbc1000n1...';

// Hoist mock functions
const {
	mockConnect,
	mockDisconnect,
	mockGetBalance,
	mockMakeInvoice,
	mockPayInvoice,
	mockListTransactions,
	mockAddListener,
	mockExtractRelayUrl,
	mockQuickHealthCheck,
	mockGetSetting,
	mockSetSetting,
	mockDeleteSetting,
	mockGetProfile,
	mockFetchProfile,
	mockConnectedRelays
} = vi.hoisted(() => ({
	mockConnect: vi.fn(),
	mockDisconnect: vi.fn(),
	mockGetBalance: vi.fn(),
	mockMakeInvoice: vi.fn(),
	mockPayInvoice: vi.fn(),
	mockListTransactions: vi.fn(),
	mockAddListener: vi.fn(),
	mockExtractRelayUrl: vi.fn(),
	mockQuickHealthCheck: vi.fn(),
	mockGetSetting: vi.fn(),
	mockSetSetting: vi.fn().mockResolvedValue(undefined),
	mockDeleteSetting: vi.fn().mockResolvedValue(undefined),
	mockGetProfile: vi.fn(),
	mockFetchProfile: vi.fn(),
	mockConnectedRelays: ['wss://relay1.test', 'wss://relay2.test']
}));

// Mock NWC client
vi.mock('$lib/services/wallet', () => ({
	nwcClient: {
		connect: mockConnect,
		disconnect: mockDisconnect,
		getBalance: mockGetBalance,
		makeInvoice: mockMakeInvoice,
		payInvoice: mockPayInvoice,
		listTransactions: mockListTransactions,
		addListener: mockAddListener
	},
	NWCClient: {
		extractRelayUrl: mockExtractRelayUrl
	},
	formatSats: (sats: number) => `${sats.toLocaleString()} sats`,
	formatMsats: (msats: number) => `${Math.round(msats / 1000)} sats`,
	parseInvoice: (invoice: string) => ({
		amount: 1000,
		description: 'Test invoice',
		timestamp: Date.now()
	})
}));

// Mock relay manager
vi.mock('$lib/services/ndk/relay-manager', () => ({
	relayManager: {
		quickHealthCheck: mockQuickHealthCheck
	}
}));

// Mock NDK service
vi.mock('$services/ndk', () => ({
	default: {
		fetchProfile: mockFetchProfile,
		connectedRelays: mockConnectedRelays
	}
}));

// Mock database
vi.mock('$db', () => ({
	dbHelpers: {
		getSetting: mockGetSetting,
		setSetting: mockSetSetting,
		deleteSetting: mockDeleteSetting,
		getProfile: mockGetProfile
	}
}));

// Mock error handler
vi.mock('$lib/core/errors', () => ({
	ErrorHandler: {
		normalize: (e: Error) => ({ userMessage: e.message }),
		handle: (e: Error) => ({ userMessage: e.message })
	},
	WalletError: class WalletError extends Error {
		code?: string;
		details?: unknown;
		constructor(message: string, options?: { code?: string; userMessage?: string; details?: unknown }) {
			super(message);
			this.code = options?.code;
			this.details = options?.details;
		}
	},
	ErrorCode: {
		WALLET_NOT_CONNECTED: 'WALLET_NOT_CONNECTED',
		PAYMENT_FAILED: 'PAYMENT_FAILED',
		VALIDATION_ERROR: 'VALIDATION_ERROR'
	}
}));

// Mock zap service for zapNote tests
vi.mock('$services/zap', () => ({
	zapService: {
		sendZap: vi.fn().mockResolvedValue({
			invoice: TEST_INVOICE,
			paymentResult: { success: true, preimage: 'preimage123' },
			paymentAttempted: true
		})
	}
}));

describe('Wallet Store', () => {
	let walletStore: typeof import('$stores/wallet.svelte').walletStore;

	beforeEach(async () => {
		vi.clearAllMocks();

		// Default mock implementations
		mockConnect.mockResolvedValue({ alias: 'Test Wallet' });
		mockGetBalance.mockResolvedValue(TEST_BALANCE_MSATS);
		mockListTransactions.mockResolvedValue([]);
		mockAddListener.mockReturnValue(() => {}); // Return cleanup function
		mockExtractRelayUrl.mockReturnValue('wss://relay.test');
		mockQuickHealthCheck.mockResolvedValue(true);
		mockGetSetting.mockResolvedValue(null);
		mockGetProfile.mockResolvedValue(null);

		// Re-import store to get fresh instance
		vi.resetModules();
		const module = await import('$stores/wallet.svelte');
		walletStore = module.walletStore;
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe('Initial State', () => {
		it('should start disconnected', () => {
			expect(walletStore.status).toBe('disconnected');
			expect(walletStore.isConnected).toBe(false);
		});

		it('should have zero balance initially', () => {
			expect(walletStore.balance).toBe(0);
		});

		it('should have no transactions initially', () => {
			expect(walletStore.transactions).toEqual([]);
		});

		it('should have no error initially', () => {
			expect(walletStore.error).toBeNull();
		});
	});

	describe('connect()', () => {
		it('should connect successfully', async () => {
			await walletStore.connect(TEST_NWC_URI);

			expect(mockConnect).toHaveBeenCalledWith(TEST_NWC_URI);
			expect(walletStore.status).toBe('connected');
			expect(walletStore.isConnected).toBe(true);
		});

		it('should save connection string to database', async () => {
			await walletStore.connect(TEST_NWC_URI);

			expect(mockSetSetting).toHaveBeenCalledWith('nwc_connection', TEST_NWC_URI);
		});

		it('should fetch balance after connecting', async () => {
			await walletStore.connect(TEST_NWC_URI);

			expect(mockGetBalance).toHaveBeenCalled();
			expect(walletStore.balance).toBe(100); // 100000 msats = 100 sats
		});

		it('should fetch transactions after connecting', async () => {
			mockListTransactions.mockResolvedValue([
				{
					payment_hash: 'hash1',
					type: 'incoming',
					amount: 50000, // 50 sats in msats
					description: 'Test payment',
					created_at: Math.floor(Date.now() / 1000),
					settled_at: Math.floor(Date.now() / 1000)
				}
			]);

			await walletStore.connect(TEST_NWC_URI);

			expect(walletStore.transactions).toHaveLength(1);
			expect(walletStore.transactions[0].amount).toBe(50);
			expect(walletStore.transactions[0].type).toBe('incoming');
		});

		it('should set up event listener', async () => {
			await walletStore.connect(TEST_NWC_URI);

			expect(mockAddListener).toHaveBeenCalled();
		});

		it('should handle connection error', async () => {
			mockConnect.mockRejectedValue(new Error('Connection failed'));

			await expect(walletStore.connect(TEST_NWC_URI)).rejects.toThrow();

			expect(walletStore.status).toBe('error');
			expect(walletStore.error).toBe('Connection failed');
		});

		it('should set status to connecting while connecting', async () => {
			let statusDuringConnect: string | undefined;
			mockConnect.mockImplementation(async () => {
				statusDuringConnect = walletStore.status;
				return { alias: 'Test' };
			});

			await walletStore.connect(TEST_NWC_URI);

			expect(statusDuringConnect).toBe('connecting');
		});
	});

	describe('disconnect()', () => {
		it('should disconnect wallet', async () => {
			await walletStore.connect(TEST_NWC_URI);
			walletStore.disconnect();

			expect(mockDisconnect).toHaveBeenCalled();
			expect(walletStore.status).toBe('disconnected');
			expect(walletStore.isConnected).toBe(false);
		});

		it('should reset balance', async () => {
			await walletStore.connect(TEST_NWC_URI);
			walletStore.disconnect();

			expect(walletStore.balance).toBe(0);
		});

		it('should clear transactions', async () => {
			mockListTransactions.mockResolvedValue([
				{ payment_hash: 'hash1', type: 'incoming', amount: 1000, created_at: Date.now() }
			]);
			await walletStore.connect(TEST_NWC_URI);
			walletStore.disconnect();

			expect(walletStore.transactions).toEqual([]);
		});

		it('should delete saved connection', async () => {
			await walletStore.connect(TEST_NWC_URI);
			walletStore.disconnect();

			expect(mockDeleteSetting).toHaveBeenCalledWith('nwc_connection');
		});

		it('should clear error', async () => {
			mockConnect.mockRejectedValue(new Error('Failed'));
			try { await walletStore.connect(TEST_NWC_URI); } catch {}

			walletStore.disconnect();

			expect(walletStore.error).toBeNull();
		});
	});

	describe('reconnect()', () => {
		it('should reconnect using saved connection', async () => {
			mockGetSetting.mockResolvedValue(TEST_NWC_URI);

			await walletStore.reconnect();

			expect(mockConnect).toHaveBeenCalledWith(TEST_NWC_URI);
			expect(walletStore.isConnected).toBe(true);
		});

		it('should do nothing if no saved connection', async () => {
			mockGetSetting.mockResolvedValue(null);

			await walletStore.reconnect();

			expect(mockConnect).not.toHaveBeenCalled();
			expect(walletStore.isConnected).toBe(false);
		});

		it('should check relay health before reconnecting', async () => {
			mockGetSetting.mockResolvedValue(TEST_NWC_URI);

			await walletStore.reconnect();

			expect(mockQuickHealthCheck).toHaveBeenCalled();
		});

		it('should skip reconnect if relay is unhealthy', async () => {
			mockGetSetting.mockResolvedValue(TEST_NWC_URI);
			mockQuickHealthCheck.mockResolvedValue(false);

			await walletStore.reconnect();

			expect(mockConnect).not.toHaveBeenCalled();
			expect(walletStore.status).toBe('disconnected');
		});
	});

	describe('refreshBalance()', () => {
		it('should update balance', async () => {
			await walletStore.connect(TEST_NWC_URI);
			mockGetBalance.mockResolvedValue(200000); // 200 sats

			await walletStore.refreshBalance();

			expect(walletStore.balance).toBe(200);
		});

		it('should do nothing if not connected', async () => {
			await walletStore.refreshBalance();

			expect(mockGetBalance).not.toHaveBeenCalled();
		});

		it('should handle errors gracefully', async () => {
			await walletStore.connect(TEST_NWC_URI);
			mockGetBalance.mockRejectedValue(new Error('Failed'));

			// Should not throw
			await expect(walletStore.refreshBalance()).resolves.not.toThrow();
		});
	});

	describe('createInvoice()', () => {
		it('should create invoice', async () => {
			await walletStore.connect(TEST_NWC_URI);
			mockMakeInvoice.mockResolvedValue({ invoice: TEST_INVOICE });

			const invoice = await walletStore.createInvoice(100, 'Test payment');

			expect(mockMakeInvoice).toHaveBeenCalledWith({
				amount: 100000, // 100 sats in msats
				description: 'Test payment'
			});
			expect(invoice).toBe(TEST_INVOICE);
		});

		it('should throw if not connected', async () => {
			await expect(walletStore.createInvoice(100)).rejects.toThrow('Wallet not connected');
		});
	});

	describe('payInvoice()', () => {
		it('should pay invoice', async () => {
			await walletStore.connect(TEST_NWC_URI);
			mockPayInvoice.mockResolvedValue({
				payment_hash: 'hash123',
				amount: 100000,
				description: 'Payment',
				created_at: Math.floor(Date.now() / 1000)
			});

			const result = await walletStore.payInvoice(TEST_INVOICE);

			expect(mockPayInvoice).toHaveBeenCalledWith({
				invoice: TEST_INVOICE,
				amount: undefined
			});
			expect(result.payment_hash).toBe('hash123');
		});

		it('should pay invoice with custom amount', async () => {
			await walletStore.connect(TEST_NWC_URI);
			mockPayInvoice.mockResolvedValue({
				payment_hash: 'hash123',
				amount: 50000,
				created_at: Date.now()
			});

			await walletStore.payInvoice(TEST_INVOICE, 50);

			expect(mockPayInvoice).toHaveBeenCalledWith({
				invoice: TEST_INVOICE,
				amount: 50000 // 50 sats in msats
			});
		});

		it('should add transaction after payment', async () => {
			await walletStore.connect(TEST_NWC_URI);
			mockPayInvoice.mockResolvedValue({
				payment_hash: 'hash123',
				amount: 100000,
				description: 'Test',
				created_at: Math.floor(Date.now() / 1000)
			});

			await walletStore.payInvoice(TEST_INVOICE);

			expect(walletStore.transactions.length).toBeGreaterThan(0);
			expect(walletStore.transactions[0].type).toBe('outgoing');
		});

		it('should refresh balance after payment', async () => {
			await walletStore.connect(TEST_NWC_URI);
			mockPayInvoice.mockResolvedValue({
				payment_hash: 'hash123',
				amount: 100000,
				created_at: Date.now()
			});
			mockGetBalance.mockClear();

			await walletStore.payInvoice(TEST_INVOICE);

			// Balance should be refreshed (called once during connect, once after pay)
			expect(mockGetBalance).toHaveBeenCalled();
		});

		it('should throw if not connected', async () => {
			await expect(walletStore.payInvoice(TEST_INVOICE)).rejects.toThrow('Wallet not connected');
		});
	});

	describe('parseInvoiceDetails()', () => {
		it('should parse invoice', async () => {
			const details = walletStore.parseInvoiceDetails(TEST_INVOICE);

			expect(details).toHaveProperty('amount');
			expect(details).toHaveProperty('description');
		});
	});

	describe('clearError()', () => {
		it('should clear error', async () => {
			mockConnect.mockRejectedValue(new Error('Test error'));
			try { await walletStore.connect(TEST_NWC_URI); } catch {}
			expect(walletStore.error).not.toBeNull();

			walletStore.clearError();

			expect(walletStore.error).toBeNull();
		});
	});

	describe('destroy()', () => {
		it('should cleanup resources', async () => {
			const mockRemoveListener = vi.fn();
			mockAddListener.mockReturnValue(mockRemoveListener);

			await walletStore.connect(TEST_NWC_URI);
			walletStore.destroy();

			expect(mockRemoveListener).toHaveBeenCalled();
			expect(mockDisconnect).toHaveBeenCalled();
		});
	});

	describe('Derived State', () => {
		it('should compute isConnected correctly', async () => {
			expect(walletStore.isConnected).toBe(false);

			await walletStore.connect(TEST_NWC_URI);
			expect(walletStore.isConnected).toBe(true);

			walletStore.disconnect();
			expect(walletStore.isConnected).toBe(false);
		});

		it('should format balance correctly', async () => {
			await walletStore.connect(TEST_NWC_URI);

			expect(walletStore.formattedBalance).toContain('100');
		});
	});

	describe('Loading State', () => {
		it('should set isLoading during connect', async () => {
			let loadingDuringConnect = false;
			mockConnect.mockImplementation(async () => {
				loadingDuringConnect = walletStore.isLoading;
				return { alias: 'Test' };
			});

			await walletStore.connect(TEST_NWC_URI);

			expect(loadingDuringConnect).toBe(true);
			expect(walletStore.isLoading).toBe(false);
		});

		it('should set isLoading during payInvoice', async () => {
			await walletStore.connect(TEST_NWC_URI);

			let loadingDuringPay = false;
			mockPayInvoice.mockImplementation(async () => {
				loadingDuringPay = walletStore.isLoading;
				return { payment_hash: 'hash', amount: 1000, created_at: Date.now() };
			});

			await walletStore.payInvoice(TEST_INVOICE);

			expect(loadingDuringPay).toBe(true);
			expect(walletStore.isLoading).toBe(false);
		});
	});

	describe('Transaction Management', () => {
		it('should convert msats to sats in transactions', async () => {
			mockListTransactions.mockResolvedValue([
				{
					payment_hash: 'hash1',
					type: 'incoming',
					amount: 123456, // msats
					created_at: Math.floor(Date.now() / 1000),
					settled_at: Math.floor(Date.now() / 1000)
				}
			]);

			await walletStore.connect(TEST_NWC_URI);

			expect(walletStore.transactions[0].amount).toBe(123); // Rounded sats
		});

		it('should set correct transaction status', async () => {
			const now = Math.floor(Date.now() / 1000);
			mockListTransactions.mockResolvedValue([
				{
					payment_hash: 'settled',
					type: 'incoming',
					amount: 1000,
					created_at: now,
					settled_at: now
				},
				{
					payment_hash: 'pending',
					type: 'outgoing',
					amount: 2000,
					created_at: now,
					settled_at: null
				}
			]);

			await walletStore.connect(TEST_NWC_URI);

			const settledTx = walletStore.transactions.find(tx => tx.id === 'settled');
			const pendingTx = walletStore.transactions.find(tx => tx.id === 'pending');

			expect(settledTx?.status).toBe('settled');
			expect(pendingTx?.status).toBe('pending');
		});
	});
});
