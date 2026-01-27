/**
 * Zap Service
 * 
 * Implementation of NIP-57 for Lightning zaps.
 * https://github.com/nostr-protocol/nips/blob/master/57.md
 */

import { NDKEvent } from '@nostr-dev-kit/ndk';
import { bech32 } from '@scure/base';
import ndkService from '$services/ndk';
import { nwcClient } from '$services/wallet/nwc-client';
import { WalletError, ErrorCode } from '$lib/core/errors';

/** LNURL callback response */
export interface LnurlPayResponse {
	callback: string;
	maxSendable: number;
	minSendable: number;
	metadata: string;
	allowsNostr?: boolean;
	nostrPubkey?: string;
	commentAllowed?: number;
	tag: 'payRequest';
}

/** Invoice response from LNURL callback */
export interface LnurlInvoiceResponse {
	pr: string; // BOLT11 invoice
	routes?: string[];
	successAction?: {
		tag: string;
		message?: string;
		url?: string;
	};
}

/** Zap request parameters */
export interface ZapRequestParams {
	/** Recipient pubkey */
	recipientPubkey: string;
	/** Amount in millisats */
	amount: number;
	/** Lightning address or LNURL */
	lnurl: string;
	/** Optional comment */
	comment?: string;
	/** Optional event ID being zapped */
	eventId?: string;
	/** Relays to publish zap receipt to */
	relays?: string[];
}

/** Zap result */
export interface ZapResult {
	/** BOLT11 invoice to pay */
	invoice: string;
	/** Zap request event */
	zapRequest: NDKEvent;
	/** Whether payment was attempted */
	paymentAttempted: boolean;
	/** Payment result if attempted */
	paymentResult?: {
		success: boolean;
		preimage?: string;
		error?: string;
	};
}

/**
 * Zap Service Class
 */
class ZapService {
	/** Lightning address regex */
	private static readonly LN_ADDRESS_REGEX = /^([^@]+)@([^@]+)$/;

	/** Parse Lightning address to LNURL */
	parseLightningAddress(address: string): string | null {
		// Check if it's already an LNURL
		if (address.toLowerCase().startsWith('lnurl')) {
			return address;
		}

		// Parse Lightning address (user@domain.com)
		const match = ZapService.LN_ADDRESS_REGEX.exec(address);
		if (!match) {
			return null;
		}

		const [, username, domain] = match;
		return `https://${domain}/.well-known/lnurlp/${username}`;
	}

	/** Decode LNURL to URL */
	decodeLnurl(lnurl: string): string {
		if (lnurl.startsWith('http')) {
			return lnurl;
		}

		try {
			// Remove lnurl prefix and decode bech32
			const { words } = bech32.decode(lnurl.toLowerCase() as `${string}1${string}`, 2000);
			const bytes = bech32.fromWords(words);
			return new TextDecoder().decode(new Uint8Array(bytes));
		} catch (e) {
			throw new WalletError('Invalid LNURL format', {
				code: ErrorCode.WALLET_ERROR,
				cause: e instanceof Error ? e : undefined
			});
		}
	}

	/** Fetch LNURL pay endpoint */
	async fetchLnurlPayEndpoint(lnurlOrAddress: string): Promise<LnurlPayResponse> {
		let url: string;

		// Parse Lightning address if needed
		const parsed = this.parseLightningAddress(lnurlOrAddress);
		if (parsed?.startsWith('http')) {
			url = parsed;
		} else if (parsed) {
			url = this.decodeLnurl(parsed);
		} else {
			url = this.decodeLnurl(lnurlOrAddress);
		}

		const response = await fetch(url);
		if (!response.ok) {
			throw new WalletError(`LNURL request failed: ${response.statusText}`, {
				code: ErrorCode.WALLET_ERROR
			});
		}

		const data = await response.json();
		
		if (data.status === 'ERROR') {
			throw new WalletError(data.reason || 'LNURL error', {
				code: ErrorCode.WALLET_ERROR
			});
		}

		if (data.tag !== 'payRequest') {
			throw new WalletError('Invalid LNURL-pay response', {
				code: ErrorCode.WALLET_ERROR
			});
		}

		return data as LnurlPayResponse;
	}

	/** Check if a user can receive zaps */
	async canReceiveZaps(lnurlOrAddress: string): Promise<{
		canZap: boolean;
		lnurlPay?: LnurlPayResponse;
		error?: string;
	}> {
		try {
			const lnurlPay = await this.fetchLnurlPayEndpoint(lnurlOrAddress);
			return {
				canZap: lnurlPay.allowsNostr === true && !!lnurlPay.nostrPubkey,
				lnurlPay
			};
		} catch (e) {
			return {
				canZap: false,
				error: e instanceof Error ? e.message : 'Failed to check zap capability'
			};
		}
	}

	/** Create a zap request event (kind:9734) */
	async createZapRequest(params: ZapRequestParams): Promise<NDKEvent> {
		if (!ndkService.signer) {
			throw new WalletError('No signer available', {
				code: ErrorCode.AUTH_FAILED
			});
		}

		if (!ndkService.ndk) {
			throw new WalletError('NDK not initialized', {
				code: ErrorCode.WALLET_ERROR
			});
		}

		const event = new NDKEvent(ndkService.ndk);
		event.kind = 9734;
		event.content = params.comment || '';
		
		// Build tags
		event.tags = [
			['p', params.recipientPubkey],
			['amount', params.amount.toString()],
			['relays', ...(params.relays || ndkService.connectedRelays.slice(0, 3))]
		];

		// Add event reference if zapping a note
		if (params.eventId) {
			event.tags.push(['e', params.eventId]);
		}

		// Add lnurl tag
		const lnurlUrl = this.parseLightningAddress(params.lnurl);
		if (lnurlUrl) {
			event.tags.push(['lnurl', lnurlUrl]);
		}

		return event;
	}

	/** Request an invoice from LNURL-pay endpoint with zap request */
	async requestInvoice(
		lnurlPay: LnurlPayResponse,
		amountMsats: number,
		zapRequest?: NDKEvent,
		comment?: string
	): Promise<string> {
		const url = new URL(lnurlPay.callback);
		url.searchParams.set('amount', amountMsats.toString());

		if (comment && lnurlPay.commentAllowed && comment.length <= lnurlPay.commentAllowed) {
			url.searchParams.set('comment', comment);
		}

		if (zapRequest && lnurlPay.allowsNostr && lnurlPay.nostrPubkey) {
			// Sign the zap request
			await zapRequest.sign(ndkService.signer!);
			const zapRequestJson = JSON.stringify(zapRequest.rawEvent());
			url.searchParams.set('nostr', zapRequestJson);
		}

		const response = await fetch(url.toString());
		if (!response.ok) {
			throw new WalletError(`Invoice request failed: ${response.statusText}`, {
				code: ErrorCode.WALLET_ERROR
			});
		}

		const data = await response.json() as LnurlInvoiceResponse;
		
		if (!data.pr) {
			throw new WalletError('No invoice returned', {
				code: ErrorCode.WALLET_ERROR
			});
		}

		return data.pr;
	}

	/** Validate zap amount against LNURL limits */
	private validateZapAmount(amount: number, lnurlPay: LnurlPayResponse): void {
		if (amount < lnurlPay.minSendable) {
			throw new WalletError(`Minimum amount is ${lnurlPay.minSendable / 1000} sats`, {
				code: ErrorCode.WALLET_ERROR
			});
		}
		if (amount > lnurlPay.maxSendable) {
			throw new WalletError(`Maximum amount is ${lnurlPay.maxSendable / 1000} sats`, {
				code: ErrorCode.WALLET_ERROR
			});
		}
	}

	/** Try to pay invoice with NWC */
	private async tryPayWithNWC(invoice: string): Promise<{ success: boolean; preimage?: string; error?: string }> {
		try {
			const payResult = await nwcClient.payInvoice({ invoice });
			return { success: true, preimage: payResult.preimage };
		} catch (e) {
			return { success: false, error: e instanceof Error ? e.message : 'Payment failed' };
		}
	}

	/** Try to pay invoice with WebLN */
	private async tryPayWithWebLN(invoice: string): Promise<{ success: boolean; preimage?: string; error?: string }> {
		const webln = globalThis.window?.webln;
		if (!webln) {
			return { success: false, error: 'WebLN not available' };
		}
		try {
			await webln.enable();
			const payResult = await webln.sendPayment(invoice);
			return { success: true, preimage: payResult.preimage };
		} catch (e) {
			return { success: false, error: e instanceof Error ? e.message : 'Payment failed' };
		}
	}

	/** Send a zap */
	async sendZap(params: ZapRequestParams): Promise<ZapResult> {
		// Fetch LNURL pay endpoint
		const lnurlPay = await this.fetchLnurlPayEndpoint(params.lnurl);

		// Validate amount
		this.validateZapAmount(params.amount, lnurlPay);

		// Create zap request if supported
		let zapRequest: NDKEvent | undefined;
		if (lnurlPay.allowsNostr && lnurlPay.nostrPubkey) {
			zapRequest = await this.createZapRequest(params);
		}

		// Request invoice
		const invoice = await this.requestInvoice(
			lnurlPay,
			params.amount,
			zapRequest,
			params.comment
		);

		const result: ZapResult = {
			invoice,
			zapRequest: zapRequest || new NDKEvent(ndkService.ndk),
			paymentAttempted: false
		};

		// Try to pay with NWC if connected
		if (nwcClient.isConnected) {
			result.paymentAttempted = true;
			result.paymentResult = await this.tryPayWithNWC(invoice);
		}
		// Try WebLN if available
		else if (globalThis.window?.webln) {
			result.paymentAttempted = true;
			result.paymentResult = await this.tryPayWithWebLN(invoice);
		}

		return result;
	}

	/** Format sats for display */
	formatSats(msats: number): string {
		const sats = Math.floor(msats / 1000);
		if (sats >= 1000000) {
			return `${(sats / 1000000).toFixed(1)}M`;
		}
		if (sats >= 1000) {
			return `${(sats / 1000).toFixed(1)}k`;
		}
		return sats.toString();
	}

	/** Convert sats to msats */
	satsToMsats(sats: number): number {
		return sats * 1000;
	}

	/** Convert msats to sats */
	msatsToSats(msats: number): number {
		return Math.floor(msats / 1000);
	}
}

// Extend window type for WebLN
declare global {
	interface Window {
		webln?: {
			enable: () => Promise<void>;
			sendPayment: (invoice: string) => Promise<{ preimage: string }>;
			makeInvoice: (args: { amount: number; defaultMemo?: string }) => Promise<{ paymentRequest: string }>;
		};
	}
}

/** Singleton instance */
export const zapService = new ZapService();

export default zapService;
