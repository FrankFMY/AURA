/**
 * Cashu eCash Store
 * 
 * Manages eCash state using Svelte 5 runes.
 * Provides reactive access to balances, transactions, and mints.
 */

import { cashuService, DEFAULT_MINTS, type SendResult, type ReceiveResult, type MintQuoteResult } from '$lib/services/wallet';
import { type CashuMint, type CashuTransaction } from '$db';
import { ErrorHandler, WalletError, ErrorCode } from '$lib/core/errors';

/** Cashu connection status */
export type CashuStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** Pending mint quote for UI */
export interface PendingMintQuote {
	quote: string;
	invoice: string;
	amount: number;
	mintUrl: string;
	createdAt: number;
	expiresAt?: number;
}

/** Create Cashu store */
function createCashuStore() {
	// State
	let status = $state<CashuStatus>('disconnected');
	let totalBalance = $state<number>(0);
	let balanceByMint = $state<Map<string, number>>(new Map());
	let mints = $state<CashuMint[]>([]);
	let transactions = $state<CashuTransaction[]>([]);
	let activeMint = $state<string | null>(null);
	let pendingQuote = $state<PendingMintQuote | null>(null);
	let isLoading = $state(false);
	let error = $state<string | null>(null);

	// Derived
	const isConnected = $derived(status === 'connected');
	const formattedBalance = $derived(cashuService.formatAmount(totalBalance));
	const trustedMints = $derived(mints.filter((m) => m.trusted));

	/**
	 * Initialize the store - load mints and balances
	 */
	async function init(): Promise<void> {
		status = 'connecting';
		error = null;
		isLoading = true;

		try {
			// Load mints from DB
			mints = await cashuService.getAllMints();

			// If no mints, add defaults (but don't trust them automatically)
			if (mints.length === 0) {
				for (const defaultMint of DEFAULT_MINTS) {
					try {
						await cashuService.addMint(defaultMint.url, false);
					} catch (e) {
						console.warn(`Failed to add default mint ${defaultMint.url}:`, e);
					}
				}
				mints = await cashuService.getAllMints();
			}

			// Set first trusted mint as active, or first mint if none trusted
			const trusted = mints.find((m) => m.trusted);
			activeMint = trusted?.url || mints[0]?.url || null;

			// Load balances
			await refreshBalance();

			// Load transactions
			await refreshTransactions();

			status = 'connected';
		} catch (e) {
			// Use normalize() instead of handle() to avoid toast during init
			// Cashu is a non-critical service, errors shown in UI only
			const auraError = ErrorHandler.normalize(e);
			error = auraError.userMessage;
			status = 'error';
			console.error('Failed to initialize Cashu store:', e);
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Refresh balance from all mints
	 */
	async function refreshBalance(): Promise<void> {
		try {
			totalBalance = await cashuService.getTotalBalance();
			balanceByMint = await cashuService.getBalanceByMint();
		} catch (e) {
			console.error('Failed to refresh balance:', e);
		}
	}

	/**
	 * Refresh transaction history
	 */
	async function refreshTransactions(): Promise<void> {
		try {
			transactions = await cashuService.getTransactions(50);
		} catch (e) {
			console.error('Failed to refresh transactions:', e);
		}
	}

	/**
	 * Add a new mint
	 */
	async function addMint(mintUrl: string, trusted: boolean = false): Promise<void> {
		isLoading = true;
		error = null;

		try {
			const mint = await cashuService.addMint(mintUrl, trusted);
			mints = [...mints, mint];

			// Set as active if it's the first or if trusted
			if (!activeMint || trusted) {
				activeMint = mintUrl;
			}
		} catch (e) {
			const auraError = ErrorHandler.handle(e);
			error = auraError.userMessage;
			throw e;
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Set mint trust status
	 */
	async function setMintTrusted(mintUrl: string, trusted: boolean): Promise<void> {
		try {
			await cashuService.setMintTrusted(mintUrl, trusted);
			mints = mints.map((m) =>
				m.url === mintUrl ? { ...m, trusted } : m
			);
		} catch (e) {
			console.error('Failed to update mint trust status:', e);
		}
	}

	/**
	 * Set active mint
	 */
	function setActiveMint(mintUrl: string): void {
		if (mints.some((m) => m.url === mintUrl)) {
			activeMint = mintUrl;
		}
	}

	/**
	 * Request a mint quote (get Lightning invoice to pay)
	 */
	async function requestMint(amount: number, mintUrl?: string): Promise<MintQuoteResult> {
		const targetMint = mintUrl || activeMint;
		if (!targetMint) {
			throw new WalletError('No mint selected', { code: ErrorCode.WALLET_NOT_CONNECTED });
		}

		isLoading = true;
		error = null;

		try {
			const quote = await cashuService.requestMintQuote(targetMint, amount);

			// Store pending quote
			pendingQuote = {
				quote: quote.quote,
				invoice: quote.request,
				amount,
				mintUrl: targetMint,
				createdAt: Date.now(),
				expiresAt: quote.expiry ? quote.expiry * 1000 : undefined
			};

			return quote;
		} catch (e) {
			const auraError = ErrorHandler.handle(e);
			error = auraError.userMessage;
			throw e;
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Check if pending mint quote is paid and claim tokens
	 */
	async function checkAndClaimMint(): Promise<boolean> {
		if (!pendingQuote) {
			return false;
		}

		isLoading = true;
		error = null;

		try {
			const proofs = await cashuService.checkMintQuote(
				pendingQuote.mintUrl,
				pendingQuote.quote,
				pendingQuote.amount
			);

			if (proofs) {
				// Successfully minted!
				pendingQuote = null;
				await refreshBalance();
				await refreshTransactions();
				return true;
			}

			return false;
		} catch (e) {
			const auraError = ErrorHandler.handle(e);
			error = auraError.userMessage;
			return false;
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Cancel pending mint quote
	 */
	function cancelMintQuote(): void {
		pendingQuote = null;
	}

	/**
	 * Melt tokens to pay a Lightning invoice
	 */
	async function melt(invoice: string, mintUrl?: string): Promise<void> {
		const targetMint = mintUrl || activeMint;
		if (!targetMint) {
			throw new WalletError('No mint selected', { code: ErrorCode.WALLET_NOT_CONNECTED });
		}

		isLoading = true;
		error = null;

		try {
			await cashuService.melt(targetMint, invoice);
			await refreshBalance();
			await refreshTransactions();
		} catch (e) {
			const auraError = ErrorHandler.handle(e);
			error = auraError.userMessage;
			throw e;
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Send eCash tokens (for sharing in chat)
	 */
	async function send(amount: number, memo?: string, mintUrl?: string): Promise<SendResult> {
		const targetMint = mintUrl || activeMint;
		if (!targetMint) {
			throw new WalletError('No mint selected', { code: ErrorCode.WALLET_NOT_CONNECTED });
		}

		isLoading = true;
		error = null;

		try {
			const result = await cashuService.send(targetMint, amount, memo);
			await refreshBalance();
			await refreshTransactions();
			return result;
		} catch (e) {
			const auraError = ErrorHandler.handle(e);
			error = auraError.userMessage;
			throw e;
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Receive eCash tokens (from chat)
	 */
	async function receive(token: string, senderPubkey?: string): Promise<ReceiveResult> {
		isLoading = true;
		error = null;

		try {
			const result = await cashuService.receive(token, senderPubkey);
			await refreshBalance();
			await refreshTransactions();
			return result;
		} catch (e) {
			const auraError = ErrorHandler.handle(e);
			error = auraError.userMessage;
			throw e;
		} finally {
			isLoading = false;
		}
	}

	/**
	 * Validate a token without receiving it
	 */
	async function validateToken(token: string): Promise<{
		valid: boolean;
		amount: number;
		mint: string;
		memo?: string;
		error?: string;
	}> {
		return cashuService.validateToken(token);
	}

	/**
	 * Get balance for specific mint
	 */
	function getMintBalance(mintUrl: string): number {
		return balanceByMint.get(mintUrl) || 0;
	}

	/**
	 * Check if a string looks like a Cashu token
	 */
	function looksLikeCashuToken(text: string | null | undefined): boolean {
		if (!text) return false;
		// Cashu v4 tokens start with "cashuB" (base64url encoded)
		// or "cashuA" for v3 tokens
		const trimmed = text.trim();
		return trimmed.startsWith('cashuA') || trimmed.startsWith('cashuB');
	}

	/**
	 * Extract Cashu token from text if present
	 */
	function extractToken(text: string | null | undefined): string | null {
		if (!text) return null;
		// Match cashuA... or cashuB... tokens
		const match = text.match(/cashu[AB][A-Za-z0-9_-]+/);
		return match ? match[0] : null;
	}

	return {
		// State (readonly)
		get status() { return status; },
		get totalBalance() { return totalBalance; },
		get balanceByMint() { return balanceByMint; },
		get mints() { return mints; },
		get transactions() { return transactions; },
		get activeMint() { return activeMint; },
		get pendingQuote() { return pendingQuote; },
		get isLoading() { return isLoading; },
		get error() { return error; },

		// Derived (readonly)
		get isConnected() { return isConnected; },
		get formattedBalance() { return formattedBalance; },
		get trustedMints() { return trustedMints; },

		// Actions
		init,
		refreshBalance,
		refreshTransactions,
		addMint,
		setMintTrusted,
		setActiveMint,
		requestMint,
		checkAndClaimMint,
		cancelMintQuote,
		melt,
		send,
		receive,
		validateToken,
		getMintBalance,
		looksLikeCashuToken,
		extractToken,

		// Utility
		formatAmount: cashuService.formatAmount.bind(cashuService)
	};
}

/** Cashu store singleton */
export const cashuStore = createCashuStore();

export default cashuStore;
