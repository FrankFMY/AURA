/**
 * Cashu eCash Service
 * 
 * Implementation of Cashu protocol for anonymous payments.
 * https://github.com/cashubtc/cashu-ts
 * 
 * CRITICAL: Proofs (tokens) are money! Loss of proofs = loss of funds.
 * All proofs must be persisted in IndexedDB immediately.
 */

import {
	Mint,
	Wallet,
	getEncodedTokenV4,
	getDecodedToken,
	MintQuoteState,
	type Token
} from '@cashu/cashu-ts';

/** Proof type from Cashu */
interface Proof {
	amount: number;
	secret: string;
	C: string;
	id: string; // keyset ID
}
import { db, dbHelpers, type CashuProof, type CashuMint as DBCashuMint, type CashuTransaction } from '$db';
import { WalletError, ErrorCode } from '$lib/core/errors';

/** Default public mints (user should choose their own) */
export const DEFAULT_MINTS = [
	{
		url: 'https://mint.minibits.cash/Bitcoin',
		name: 'Minibits',
		description: 'Popular Cashu mint by Minibits'
	},
	{
		url: 'https://mint.coinos.io',
		name: 'Coinos',
		description: 'Cashu mint by Coinos'
	},
	{
		url: 'https://8333.space:3338',
		name: '8333.space',
		description: 'Reliable Cashu mint'
	}
];

/** Token send result */
export interface SendResult {
	/** Encoded token string (base64) to share */
	token: string;
	/** Amount sent in satoshis */
	amount: number;
	/** Proofs to keep (change) */
	change: Proof[];
}

/** Token receive result */
export interface ReceiveResult {
	/** Amount received in satoshis */
	amount: number;
	/** Number of proofs received */
	proofsCount: number;
	/** Mint URL the proofs came from */
	mintUrl: string;
}

/** Mint quote result */
export interface MintQuoteResult {
	quote: string;
	request: string; // Lightning invoice to pay
	state: MintQuoteState;
	expiry?: number;
}

/** Melt quote result */
export interface MeltQuoteResult {
	quote: string;
	amount: number; // Amount in sats
	fee: number; // Fee in sats
	state: string;
}

/**
 * Cashu Service Class
 * 
 * Handles all Cashu eCash operations including:
 * - Minting tokens (Lightning -> eCash)
 * - Melting tokens (eCash -> Lightning)
 * - Sending tokens (P2P)
 * - Receiving tokens (P2P)
 */
class CashuService {
	private readonly wallets: Map<string, Wallet> = new Map();
	private readonly mints: Map<string, Mint> = new Map();

	/**
	 * Get or create a wallet for a mint
	 */
	async getWallet(mintUrl: string): Promise<Wallet> {
		// Return cached wallet if exists
		if (this.wallets.has(mintUrl)) {
			return this.wallets.get(mintUrl)!;
		}

		// Create new mint and wallet
		const mint = new Mint(mintUrl);
		const wallet = new Wallet(mint);

		// Load mint info and keysets
		await wallet.loadMint();

		// Cache for reuse
		this.mints.set(mintUrl, mint);
		this.wallets.set(mintUrl, wallet);

		// Save mint to DB
		const mintInfo = await mint.getInfo();
		await dbHelpers.saveCashuMint({
			url: mintUrl,
			name: mintInfo.name,
			description: mintInfo.description,
			trusted: false, // User must explicitly trust
			last_connected_at: Date.now(),
			pubkey: mintInfo.pubkey
		});

		return wallet;
	}

	/**
	 * Get balance for a specific mint
	 */
	async getBalance(mintUrl: string): Promise<number> {
		const proofs = await dbHelpers.getUnspentProofs(mintUrl);
		return proofs.reduce((sum, p) => sum + p.amount, 0);
	}

	/**
	 * Get total balance across all mints
	 */
	async getTotalBalance(): Promise<number> {
		return dbHelpers.getCashuBalance();
	}

	/**
	 * Get balance breakdown by mint
	 */
	async getBalanceByMint(): Promise<Map<string, number>> {
		return dbHelpers.getCashuBalanceByMint();
	}

	/**
	 * Request a mint quote (get Lightning invoice to pay)
	 */
	async requestMintQuote(mintUrl: string, amount: number): Promise<MintQuoteResult> {
		const wallet = await this.getWallet(mintUrl);
		const quote = await wallet.createMintQuote(amount);

		// Save transaction as pending
		await dbHelpers.saveCashuTransaction({
			type: 'mint',
			amount,
			mint_url: mintUrl,
			status: 'pending',
			memo: `Minting ${amount} sats`
		});

		return {
			quote: quote.quote,
			request: quote.request,
			state: quote.state,
			expiry: quote.expiry
		};
	}

	/**
	 * Check mint quote status and mint tokens if paid
	 */
	async checkMintQuote(mintUrl: string, quote: string, amount: number): Promise<Proof[] | null> {
		const wallet = await this.getWallet(mintUrl);
		
		// Check quote status
		const quoteStatus = await wallet.checkMintQuote(quote);
		
		if (quoteStatus.state === MintQuoteState.PAID) {
			// Mint the proofs
			const proofs = await wallet.mintProofs(amount, quote);
			
			// Save proofs to DB immediately - CRITICAL!
			await this.saveProofs(mintUrl, proofs);
			
			// Update transaction status
			const transactions = await dbHelpers.getCashuTransactions(10);
			const pendingMint = transactions.find(
				(t) => t.type === 'mint' && t.status === 'pending' && t.mint_url === mintUrl
			);
			if (pendingMint) {
				await dbHelpers.updateCashuTransactionStatus(pendingMint.id, 'completed');
			}
			
			return proofs;
		}
		
		return null;
	}

	/**
	 * Melt tokens (send to Lightning invoice)
	 */
	async melt(mintUrl: string, invoice: string): Promise<MeltQuoteResult> {
		const wallet = await this.getWallet(mintUrl);
		
		// Get melt quote
		const meltQuote = await wallet.createMeltQuote(invoice);
		const totalNeeded = meltQuote.amount + meltQuote.fee_reserve;
		
		// Get proofs from DB
		const dbProofs = await dbHelpers.getUnspentProofs(mintUrl);
		const proofs = this.dbProofsToProofs(dbProofs);
		
		// Check if we have enough balance
		const balance = proofs.reduce((sum, p) => sum + p.amount, 0);
		if (balance < totalNeeded) {
			throw new WalletError(
				`Insufficient balance. Need ${totalNeeded} sats, have ${balance} sats`,
				{ code: ErrorCode.INSUFFICIENT_BALANCE }
			);
		}
		
		// Select proofs for melting
		const { keep, send } = await wallet.send(totalNeeded, proofs, { includeFees: true });
		
		// Execute melt
		const meltResponse = await wallet.meltProofs(meltQuote, send);
		
		// Mark sent proofs as spent
		const spentIds = send.map((p: Proof) => this.proofToId(p));
		await dbHelpers.markProofsSpent(spentIds);
		
		// Save change proofs if any
		if (keep.length > 0) {
			await this.saveProofs(mintUrl, keep as Proof[]);
		}
		
		// Save change from melt response if any
		if (meltResponse.change && meltResponse.change.length > 0) {
			await this.saveProofs(mintUrl, meltResponse.change as Proof[]);
		}
		
		// Save transaction
		await dbHelpers.saveCashuTransaction({
			type: 'melt',
			amount: meltQuote.amount,
			mint_url: mintUrl,
			status: 'completed',
			memo: `Paid Lightning invoice`
		});
		
		return {
			quote: meltQuote.quote,
			amount: meltQuote.amount,
			fee: meltQuote.fee_reserve,
			state: 'paid'
		};
	}

	/**
	 * Create a token to send to someone
	 */
	async send(mintUrl: string, amount: number, memo?: string): Promise<SendResult> {
		const wallet = await this.getWallet(mintUrl);
		
		// Get proofs from DB
		const dbProofs = await dbHelpers.getUnspentProofs(mintUrl);
		const proofs = this.dbProofsToProofs(dbProofs);
		
		// Check balance
		const balance = proofs.reduce((sum, p) => sum + p.amount, 0);
		if (balance < amount) {
			throw new WalletError(
				`Insufficient balance. Need ${amount} sats, have ${balance} sats`,
				{ code: ErrorCode.INSUFFICIENT_BALANCE }
			);
		}
		
		// Select proofs to send
		const { keep, send } = await wallet.send(amount, proofs);
		
		// Mark sent proofs as spent
		const spentIds = (send as Proof[]).map((p: Proof) => this.proofToId(p));
		await dbHelpers.markProofsSpent(spentIds);
		
		// Save change proofs
		if (keep.length > 0) {
			// Check if these are actually new proofs (from swap) or existing ones
			for (const proof of keep as Proof[]) {
				const existingProof = dbProofs.find((p) => p.secret === proof.secret);
				if (!existingProof) {
					// New proof from swap, save it
					await this.saveProofs(mintUrl, [proof]);
				}
			}
		}
		
		// Encode token for sharing
		const token = getEncodedTokenV4({
			mint: mintUrl,
			proofs: send,
			memo
		});
		
		// Save transaction
		await dbHelpers.saveCashuTransaction({
			type: 'send',
			amount,
			mint_url: mintUrl,
			status: 'completed',
			memo: memo || `Sent ${amount} sats`,
			token
		});
		
		return {
			token,
			amount,
			change: keep as Proof[]
		};
	}

	/**
	 * Receive a token from someone
	 */
	async receive(tokenString: string, senderPubkey?: string): Promise<ReceiveResult> {
		// Decode the token
		let decodedToken: Token;
		try {
			decodedToken = getDecodedToken(tokenString);
		} catch (e) {
			throw new WalletError('Invalid Cashu token', {
				code: ErrorCode.VALIDATION_ERROR,
				cause: e instanceof Error ? e : undefined
			});
		}
		
		const mintUrl = decodedToken.mint;
		const wallet = await this.getWallet(mintUrl);
		
		// Receive the proofs (this swaps them for new ones at the mint)
		const receivedProofs = await wallet.receive(tokenString) as Proof[];
		
		// Calculate amount
		const amount = receivedProofs.reduce((sum: number, p: Proof) => sum + p.amount, 0);
		
		// Save proofs to DB - CRITICAL!
		await this.saveProofs(mintUrl, receivedProofs, senderPubkey);
		
		// Save transaction
		await dbHelpers.saveCashuTransaction({
			type: 'receive',
			amount,
			mint_url: mintUrl,
			status: 'completed',
			counterparty_pubkey: senderPubkey,
			memo: decodedToken.memo || `Received ${amount} sats`
		});
		
		return {
			amount,
			proofsCount: receivedProofs.length,
			mintUrl
		};
	}

	/**
	 * Check if proofs are still valid (not spent)
	 */
	async checkProofsSpent(mintUrl: string, proofs: Proof[]): Promise<boolean[]> {
		const wallet = await this.getWallet(mintUrl);
		// In cashu-ts v3, method is checkProofsStates
		const states = await wallet.checkProofsStates(proofs);
		// States contain spent/pending status
		return states.map((s: { state: string }) => s.state === 'SPENT');
	}

	/**
	 * Validate a token without receiving it
	 */
	async validateToken(tokenString: string): Promise<{
		valid: boolean;
		amount: number;
		mint: string;
		memo?: string;
		error?: string;
	}> {
		try {
			const decoded = getDecodedToken(tokenString);
			const amount = decoded.proofs.reduce((sum: number, p: Proof) => sum + p.amount, 0);
			
			return {
				valid: true,
				amount,
				mint: decoded.mint,
				memo: decoded.memo
			};
		} catch (e) {
			return {
				valid: false,
				amount: 0,
				mint: '',
				error: e instanceof Error ? e.message : 'Invalid token'
			};
		}
	}

	/**
	 * Get all trusted mints
	 */
	async getTrustedMints(): Promise<DBCashuMint[]> {
		return dbHelpers.getTrustedMints();
	}

	/**
	 * Get all mints
	 */
	async getAllMints(): Promise<DBCashuMint[]> {
		return dbHelpers.getAllMints();
	}

	/**
	 * Add a new mint
	 */
	async addMint(mintUrl: string, trusted: boolean = false): Promise<DBCashuMint> {
		// Validate mint by connecting to it
		const wallet = await this.getWallet(mintUrl);
		const mint = this.mints.get(mintUrl)!;
		const mintInfo = await mint.getInfo();
		
		const dbMint: DBCashuMint = {
			url: mintUrl,
			name: mintInfo.name,
			description: mintInfo.description,
			trusted,
			last_connected_at: Date.now(),
			pubkey: mintInfo.pubkey,
			added_at: Date.now()
		};
		
		await dbHelpers.saveCashuMint(dbMint);
		return dbMint;
	}

	/**
	 * Set mint trust status
	 */
	async setMintTrusted(mintUrl: string, trusted: boolean): Promise<void> {
		const mint = await db.cashuMints.get(mintUrl);
		if (mint) {
			await db.cashuMints.update(mintUrl, { trusted });
		}
	}

	/**
	 * Get transaction history
	 */
	async getTransactions(limit: number = 50): Promise<CashuTransaction[]> {
		return dbHelpers.getCashuTransactions(limit);
	}

	/**
	 * Format amount for display
	 */
	formatAmount(sats: number): string {
		if (sats >= 1_000_000) {
			return `${(sats / 1_000_000).toFixed(2)}M sats`;
		}
		if (sats >= 1_000) {
			return `${(sats / 1_000).toFixed(1)}k sats`;
		}
		return `${sats} sats`;
	}

	// Private helpers

	/**
	 * Save proofs to database
	 */
	private async saveProofs(mintUrl: string, proofs: Proof[], receivedFrom?: string): Promise<void> {
		const dbProofs: Omit<CashuProof, 'created_at' | 'spent'>[] = proofs.map((p) => ({
			id: this.proofToId(p),
			amount: p.amount,
			secret: p.secret,
			C: p.C,
			keyset_id: p.id, // The 'id' field in Proof is the keyset ID
			mint_url: mintUrl,
			received_from: receivedFrom
		}));
		
		await dbHelpers.saveCashuProofs(dbProofs);
	}

	/**
	 * Generate unique ID for a proof
	 */
	private proofToId(proof: Proof): string {
		// Use secret as unique identifier (it's unique per proof)
		return `proof-${proof.secret.slice(0, 16)}`;
	}

	/**
	 * Convert DB proofs to Cashu Proof format
	 */
	private dbProofsToProofs(dbProofs: CashuProof[]): Proof[] {
		return dbProofs.map((p) => ({
			amount: p.amount,
			secret: p.secret,
			C: p.C,
			id: p.keyset_id // Cashu uses 'id' for keyset ID
		}));
	}
}

/** Singleton instance */
export const cashuService = new CashuService();

export default cashuService;
