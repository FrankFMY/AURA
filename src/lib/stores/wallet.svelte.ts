/**
 * Wallet Store
 * 
 * Manages Lightning wallet connection and operations via NWC (NIP-47).
 */

import { nwcClient, type WalletInfo, type InvoiceResponse, formatSats, formatMsats, parseInvoice } from '$lib/services/wallet';
import { dbHelpers } from '$db';
import { ErrorHandler, WalletError, ErrorCode } from '$lib/core/errors';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

/** Wallet connection status */
export type WalletStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Transaction for display */
export interface WalletTransaction {
	id: string;
	type: 'incoming' | 'outgoing';
	amount: number; // sats
	description?: string;
	timestamp: number;
	status: 'pending' | 'settled' | 'failed';
	invoice?: string;
}

/** Create wallet store */
function createWalletStore() {
	// State
	let status = $state<WalletStatus>('disconnected');
	let balance = $state<number>(0); // sats
	let walletInfo = $state<WalletInfo | null>(null);
	let transactions = $state<WalletTransaction[]>([]);
	let error = $state<string | null>(null);
	let isLoading = $state(false);

	// Derived
	const isConnected = $derived(status === 'connected');
	const formattedBalance = $derived(formatSats(balance));

	/** Connect to wallet via NWC */
	async function connect(connectionString: string): Promise<void> {
		status = 'connecting';
		error = null;
		isLoading = true;

		try {
			const info = await nwcClient.connect(connectionString);
			walletInfo = info;
			status = 'connected';

			// Save connection string (encrypted would be better)
			await dbHelpers.setSetting('nwc_connection', connectionString);

			// Fetch initial balance
			await refreshBalance();

			// Fetch recent transactions
			await refreshTransactions();

			// Set up event listeners
			nwcClient.addListener((event) => {
				if (event.type === 'disconnected') {
					status = 'disconnected';
				} else if (event.type === 'error') {
					error = event.error;
				}
			});
		} catch (e) {
			const auraError = ErrorHandler.handle(e);
			error = auraError.userMessage;
			status = 'error';
			throw e;
		} finally {
			isLoading = false;
		}
	}

	/** Disconnect wallet */
	function disconnect(): void {
		nwcClient.disconnect();
		status = 'disconnected';
		balance = 0;
		walletInfo = null;
		transactions = [];
		error = null;

		// Clear saved connection
		dbHelpers.deleteSetting('nwc_connection');
	}

	/** Reconnect using saved connection */
	async function reconnect(): Promise<void> {
		const savedConnection = await dbHelpers.getSetting<string>('nwc_connection');
		if (savedConnection) {
			await connect(savedConnection);
		}
	}

	/** Refresh balance */
	async function refreshBalance(): Promise<void> {
		if (!isConnected) return;

		try {
			const balanceMsats = await nwcClient.getBalance();
			balance = Math.round(balanceMsats / 1000); // Convert to sats
		} catch (e) {
			console.error('Failed to fetch balance:', e);
		}
	}

	/** Refresh transactions */
	async function refreshTransactions(): Promise<void> {
		if (!isConnected) return;

		try {
			const txs = await nwcClient.listTransactions({ limit: 50 });
			transactions = txs.map((tx) => ({
				id: tx.payment_hash,
				type: tx.type,
				amount: Math.round(tx.amount / 1000), // Convert to sats
				description: tx.description,
				timestamp: tx.created_at,
				status: tx.settled_at ? 'settled' : 'pending',
				invoice: tx.invoice
			}));
		} catch (e) {
			console.error('Failed to fetch transactions:', e);
		}
	}

	/** Create an invoice */
	async function createInvoice(amountSats: number, description?: string): Promise<string> {
		if (!isConnected) {
			throw new WalletError('Wallet not connected', { code: ErrorCode.WALLET_NOT_CONNECTED });
		}

		isLoading = true;
		try {
			const response = await nwcClient.makeInvoice({
				amount: amountSats * 1000, // Convert to msats
				description
			});
			return response.invoice;
		} finally {
			isLoading = false;
		}
	}

	/** Pay an invoice */
	async function payInvoice(invoice: string, amountSats?: number): Promise<InvoiceResponse> {
		if (!isConnected) {
			throw new WalletError('Wallet not connected', { code: ErrorCode.WALLET_NOT_CONNECTED });
		}

		isLoading = true;
		try {
			const response = await nwcClient.payInvoice({
				invoice,
				amount: amountSats ? amountSats * 1000 : undefined
			});

			// Refresh balance after payment
			await refreshBalance();

			// Add to transactions
			const tx: WalletTransaction = {
				id: response.payment_hash,
				type: 'outgoing',
				amount: Math.round(response.amount / 1000),
				description: response.description,
				timestamp: response.created_at,
				status: 'settled',
				invoice
			};
			transactions = [tx, ...transactions];

			return response;
		} finally {
			isLoading = false;
		}
	}

	/** Zap a note (send sats to note author) */
	async function zapNote(event: NDKEvent, amountSats: number): Promise<void> {
		if (!isConnected) {
			throw new WalletError('Wallet not connected', { code: ErrorCode.WALLET_NOT_CONNECTED });
		}

		// Get author's lightning address from their profile
		// This is a simplified version - real implementation would:
		// 1. Fetch author's kind:0 profile
		// 2. Get lud16 (lightning address)
		// 3. Fetch LNURL callback
		// 4. Create zap request (kind:9734)
		// 5. Get invoice from LNURL
		// 6. Pay invoice
		// 7. Publish zap receipt (kind:9735)

		throw new WalletError('Zaps not yet implemented', { code: ErrorCode.NOT_IMPLEMENTED });
	}

	/** Send sats to a lightning address */
	async function sendToAddress(address: string, amountSats: number, comment?: string): Promise<void> {
		if (!isConnected) {
			throw new WalletError('Wallet not connected', { code: ErrorCode.WALLET_NOT_CONNECTED });
		}

		isLoading = true;
		try {
			// Parse lightning address
			const [name, domain] = address.split('@');
			if (!name || !domain) {
				throw new WalletError('Invalid lightning address', { code: ErrorCode.VALIDATION_ERROR });
			}

			// Fetch LNURL
			const lnurlResponse = await fetch(`https://${domain}/.well-known/lnurlp/${name}`);
			if (!lnurlResponse.ok) {
				throw new WalletError('Failed to fetch LNURL', { code: ErrorCode.PAYMENT_FAILED });
			}

			const lnurlData = await lnurlResponse.json();

			// Validate amount
			const amountMsats = amountSats * 1000;
			if (amountMsats < lnurlData.minSendable || amountMsats > lnurlData.maxSendable) {
				throw new WalletError(
					`Amount must be between ${formatMsats(lnurlData.minSendable)} and ${formatMsats(lnurlData.maxSendable)}`,
					{ code: ErrorCode.VALIDATION_ERROR }
				);
			}

			// Get invoice
			const callbackUrl = new URL(lnurlData.callback);
			callbackUrl.searchParams.set('amount', String(amountMsats));
			if (comment && lnurlData.commentAllowed) {
				callbackUrl.searchParams.set('comment', comment.slice(0, lnurlData.commentAllowed));
			}

			const invoiceResponse = await fetch(callbackUrl.toString());
			if (!invoiceResponse.ok) {
				throw new WalletError('Failed to get invoice', { code: ErrorCode.PAYMENT_FAILED });
			}

			const invoiceData = await invoiceResponse.json();
			if (invoiceData.status === 'ERROR') {
				throw new WalletError(invoiceData.reason || 'Failed to get invoice', {
					code: ErrorCode.PAYMENT_FAILED
				});
			}

			// Pay the invoice
			await payInvoice(invoiceData.pr);
		} finally {
			isLoading = false;
		}
	}

	/** Parse invoice details */
	function parseInvoiceDetails(invoice: string) {
		return parseInvoice(invoice);
	}

	/** Clear error */
	function clearError(): void {
		error = null;
	}

	return {
		// State (readonly)
		get status() { return status; },
		get balance() { return balance; },
		get formattedBalance() { return formattedBalance; },
		get walletInfo() { return walletInfo; },
		get transactions() { return transactions; },
		get error() { return error; },
		get isLoading() { return isLoading; },
		get isConnected() { return isConnected; },

		// Actions
		connect,
		disconnect,
		reconnect,
		init: reconnect, // Alias for backward compatibility
		refreshBalance,
		fetchBalance: refreshBalance, // Alias for backward compatibility
		refreshTransactions,
		createInvoice,
		payInvoice,
		zapNote,
		sendToAddress,
		parseInvoiceDetails,
		formatSats, // Export utility function
		clearError
	};
}

/** Wallet store singleton */
export const walletStore = createWalletStore();

export default walletStore;
