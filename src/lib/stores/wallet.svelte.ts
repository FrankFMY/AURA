/**
 * Wallet Store
 * 
 * Manages Lightning wallet connection and operations via NWC (NIP-47).
 */

import { nwcClient, NWCClient, type WalletInfo, type InvoiceResponse, formatSats, formatMsats, parseInvoice } from '$lib/services/wallet';
import { relayManager } from '$lib/services/ndk/relay-manager';
import ndkService from '$lib/services/ndk';
import { dbHelpers } from '$db';
import { ErrorHandler, WalletError, ErrorCode } from '$lib/core/errors';
import type { NDKEvent } from '@nostr-dev-kit/ndk';

/** Parse invoice details */
function parseInvoiceDetails(invoice: string) {
	return parseInvoice(invoice);
}

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

	// Store reference to listener for cleanup
	let nwcListenerRemover: (() => void) | null = null;

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

			// Set up event listeners (cleanup old one first if exists)
			if (nwcListenerRemover) {
				nwcListenerRemover();
			}
			nwcListenerRemover = nwcClient.addListener((event) => {
				if (event.type === 'disconnected') {
					status = 'disconnected';
				} else if (event.type === 'error') {
					error = event.error;
				}
			});
		} catch (e) {
			// Use normalize() instead of handle() to avoid triggering toast notifications
			// Toast notifications for wallet errors are redundant since the UI shows the error state
			const auraError = ErrorHandler.normalize(e);
			error = auraError.userMessage;
			status = 'error';
			throw e;
		} finally {
			isLoading = false;
		}
	}

	/** Disconnect wallet */
	function disconnect(): void {
		// Clean up listener
		if (nwcListenerRemover) {
			nwcListenerRemover();
			nwcListenerRemover = null;
		}

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
		if (!savedConnection) {
			return; // No saved connection, nothing to reconnect
		}

		// Pre-flight check: verify NWC relay is reachable before attempting full connect
		// This prevents long timeouts when the relay is down
		const relayUrl = NWCClient.extractRelayUrl(savedConnection);
		if (relayUrl) {
			const isHealthy = await relayManager.quickHealthCheck(relayUrl, 3000);
			if (!isHealthy) {
				console.warn(`[Wallet] NWC relay unreachable (${relayUrl}), skipping reconnect`);
				// Don't set error state - this is a graceful skip, not a failure
				// The wallet will remain disconnected and can be reconnected manually
				return;
			}
		}

		await connect(savedConnection);
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
	async function zapNote(event: NDKEvent, amountSats: number, comment?: string): Promise<void> {
		if (!isConnected) {
			throw new WalletError('Wallet not connected', { code: ErrorCode.WALLET_NOT_CONNECTED });
		}

		isLoading = true;
		try {
			// Get author's profile to find their lightning address
			const { zapService } = await import('$services/zap');
			
			let profile = await dbHelpers.getProfile(event.pubkey);
			
			// If not in cache, try to fetch
			if (!profile) {
				await ndkService.fetchProfile(event.pubkey);
				profile = await dbHelpers.getProfile(event.pubkey);
			}
			
			// Check if author has a lightning address
			const lnurl = profile?.lud16;
			if (!lnurl) {
				throw new WalletError('Recipient has no lightning address', { 
					code: ErrorCode.PAYMENT_FAILED,
					userMessage: 'This user cannot receive zaps (no lightning address)'
				});
			}

			// Send zap via zap service
			const result = await zapService.sendZap({
				recipientPubkey: event.pubkey,
				amount: amountSats * 1000, // Convert to millisats
				lnurl,
				comment,
				eventId: event.id,
				relays: ndkService.connectedRelays.slice(0, 3)
			});

			// Check if payment was successful
			if (result.paymentResult?.success) {
				// Refresh balance after payment
				await refreshBalance();
				
				// Add to transactions
				const tx: WalletTransaction = {
					id: result.paymentResult.preimage || `zap-${Date.now()}`,
					type: 'outgoing',
					amount: amountSats,
					description: `Zap to ${event.pubkey.slice(0, 8)}...`,
					timestamp: Math.floor(Date.now() / 1000),
					status: 'settled',
					invoice: result.invoice
				};
				transactions = [tx, ...transactions];
			} else if (result.paymentAttempted) {
				// Payment was attempted but failed
				throw new WalletError(result.paymentResult?.error || 'Payment failed', {
					code: ErrorCode.PAYMENT_FAILED
				});
			} else {
				// No payment method available - return the invoice
				throw new WalletError('No wallet available. Copy the invoice manually.', {
					code: ErrorCode.WALLET_NOT_CONNECTED,
					details: { invoice: result.invoice }
				});
			}
		} finally {
			isLoading = false;
		}
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

	/** Clear error */
	function clearError(): void {
		error = null;
	}

	/** Cleanup all resources */
	function destroy(): void {
		if (nwcListenerRemover) {
			nwcListenerRemover();
			nwcListenerRemover = null;
		}
		nwcClient.disconnect();
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
		clearError,
		destroy
	};
}

/** Wallet store singleton */
export const walletStore = createWalletStore();

export default walletStore;
