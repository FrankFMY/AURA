/**
 * NWC (Nostr Wallet Connect) Client
 * 
 * Implementation of NIP-47 for Lightning wallet integration.
 * https://github.com/nostr-protocol/nips/blob/master/47.md
 */

import { nip04, getPublicKey, finalizeEvent } from 'nostr-tools';
import { WalletError, ErrorCode } from '$lib/core/errors';

/** NWC connection info parsed from connection string */
export interface NWCConnectionInfo {
	walletPubkey: string;
	relayUrl: string;
	secret: string;
	lud16?: string;
}

/** NWC request types */
export type NWCMethod =
	| 'get_info'
	| 'get_balance'
	| 'make_invoice'
	| 'pay_invoice'
	| 'lookup_invoice'
	| 'list_transactions';

/** NWC request */
export interface NWCRequest {
	method: NWCMethod;
	params: Record<string, unknown>;
}

/** NWC response */
export interface NWCResponse<T = unknown> {
	result_type: NWCMethod;
	result?: T;
	error?: {
		code: string;
		message: string;
	};
}

/** Wallet info response */
export interface WalletInfo {
	alias?: string;
	color?: string;
	pubkey?: string;
	network?: string;
	block_height?: number;
	block_hash?: string;
	methods: NWCMethod[];
}

/** Balance response */
export interface BalanceResponse {
	balance: number; // msats
}

/** Invoice creation params */
export interface MakeInvoiceParams {
	amount: number; // msats
	description?: string;
	description_hash?: string;
	expiry?: number; // seconds
}

/** Invoice response */
export interface InvoiceResponse {
	type: 'incoming' | 'outgoing';
	invoice: string; // BOLT11
	description?: string;
	description_hash?: string;
	preimage?: string;
	payment_hash: string;
	amount: number; // msats
	fees_paid?: number; // msats
	created_at: number;
	expires_at?: number;
	settled_at?: number;
	metadata?: Record<string, unknown>;
}

/** Pay invoice params */
export interface PayInvoiceParams {
	invoice: string; // BOLT11
	amount?: number; // msats (for zero-amount invoices)
}

/** Transaction list params */
export interface ListTransactionsParams {
	from?: number; // timestamp
	until?: number; // timestamp
	limit?: number;
	offset?: number;
	unpaid?: boolean;
	type?: 'incoming' | 'outgoing';
}

/** Transaction list response */
export interface TransactionsResponse {
	transactions: InvoiceResponse[];
}

/**
 * NWC Client Class
 * 
 * Handles communication with a Lightning wallet via NIP-47.
 */
export class NWCClient {
	private _connectionInfo: NWCConnectionInfo | null = null;
	private _ourPubkey: string | null = null;
	private _secretKeyBytes: Uint8Array | null = null;
	private _ws: WebSocket | null = null;
	private _pendingRequests: Map<string, {
		resolve: (value: unknown) => void;
		reject: (error: Error) => void;
		timeout: ReturnType<typeof setTimeout>;
	}> = new Map();
	private _isConnected = false;
	private _reconnectAttempts = 0;
	private _maxReconnectAttempts = 5;
	private _reconnectDelay = 1000;
	private _eventListeners: Set<(event: NWCEvent) => void> = new Set();

	/** Check if connected */
	get isConnected(): boolean {
		return this._isConnected && this._ws?.readyState === WebSocket.OPEN;
	}

	/** Get wallet pubkey */
	get walletPubkey(): string | null {
		return this._connectionInfo?.walletPubkey || null;
	}

	/**
	 * Parse NWC connection string
	 * Format: nostr+walletconnect://<walletPubkey>?relay=<relayUrl>&secret=<secret>&lud16=<lud16>
	 */
	static parseConnectionString(connectionString: string): NWCConnectionInfo {
		if (!connectionString.startsWith('nostr+walletconnect://')) {
			throw new WalletError('Invalid NWC connection string format', {
				code: ErrorCode.NWC_CONNECTION_FAILED
			});
		}

		try {
			const url = new URL(connectionString);
			const walletPubkey = url.hostname || url.pathname.replace('//', '');
			const relayUrl = url.searchParams.get('relay');
			const secret = url.searchParams.get('secret');
			const lud16 = url.searchParams.get('lud16') || undefined;

			if (!walletPubkey || !relayUrl || !secret) {
				throw new Error('Missing required parameters');
			}

			// Validate pubkey format
			if (!/^[0-9a-fA-F]{64}$/.test(walletPubkey)) {
				throw new Error('Invalid wallet pubkey format');
			}

			return {
				walletPubkey,
				relayUrl: decodeURIComponent(relayUrl),
				secret,
				lud16
			};
		} catch (error) {
			throw new WalletError('Failed to parse NWC connection string', {
				code: ErrorCode.NWC_CONNECTION_FAILED,
				cause: error instanceof Error ? error : undefined
			});
		}
	}

	/**
	 * Connect to wallet
	 */
	async connect(connectionString: string): Promise<WalletInfo> {
		this._connectionInfo = NWCClient.parseConnectionString(connectionString);
		
		// Derive our pubkey from the secret
		try {
			this._secretKeyBytes = this.hexToBytes(this._connectionInfo.secret);
			this._ourPubkey = getPublicKey(this._secretKeyBytes);
		} catch (e) {
			throw new WalletError('Invalid NWC secret key', {
				code: ErrorCode.NWC_CONNECTION_FAILED,
				cause: e instanceof Error ? e : undefined
			});
		}
		
		return new Promise((resolve, reject) => {
			try {
				this._ws = new WebSocket(this._connectionInfo!.relayUrl);

				this._ws.onopen = async () => {
					this._isConnected = true;
					this._reconnectAttempts = 0;
					this.emit({ type: 'connected' });

					// Subscribe to responses
					this.subscribeToResponses();

					// Get wallet info
					try {
						const info = await this.getInfo();
						resolve(info);
					} catch (error) {
						reject(error);
					}
				};

				this._ws.onclose = () => {
					this._isConnected = false;
					this.emit({ type: 'disconnected' });
					this.attemptReconnect();
				};

				this._ws.onerror = (error) => {
					this.emit({ type: 'error', error: 'WebSocket error' });
					if (!this._isConnected) {
						reject(new WalletError('Failed to connect to wallet relay', {
							code: ErrorCode.NWC_CONNECTION_FAILED
						}));
					}
				};

				this._ws.onmessage = (event) => {
					this.handleMessage(event.data);
				};
			} catch (error) {
				reject(new WalletError('Failed to connect to wallet', {
					code: ErrorCode.NWC_CONNECTION_FAILED,
					cause: error instanceof Error ? error : undefined
				}));
			}
		});
	}

	/**
	 * Disconnect from wallet
	 */
	disconnect(): void {
		if (this._ws) {
			this._ws.close();
			this._ws = null;
		}
		this._isConnected = false;
		this._connectionInfo = null;
		this._pendingRequests.forEach(({ reject, timeout }) => {
			clearTimeout(timeout);
			reject(new WalletError('Disconnected', { code: ErrorCode.WALLET_NOT_CONNECTED }));
		});
		this._pendingRequests.clear();
	}

	/**
	 * Get wallet info
	 */
	async getInfo(): Promise<WalletInfo> {
		return this.sendRequest<WalletInfo>('get_info', {});
	}

	/**
	 * Get wallet balance
	 */
	async getBalance(): Promise<number> {
		const response = await this.sendRequest<BalanceResponse>('get_balance', {});
		return response.balance;
	}

	/**
	 * Create an invoice
	 */
	async makeInvoice(params: MakeInvoiceParams): Promise<InvoiceResponse> {
		return this.sendRequest<InvoiceResponse>('make_invoice', { ...params });
	}

	/**
	 * Pay an invoice
	 */
	async payInvoice(params: PayInvoiceParams): Promise<InvoiceResponse> {
		return this.sendRequest<InvoiceResponse>('pay_invoice', { ...params });
	}

	/**
	 * Lookup an invoice by payment hash
	 */
	async lookupInvoice(paymentHash: string): Promise<InvoiceResponse> {
		return this.sendRequest<InvoiceResponse>('lookup_invoice', { payment_hash: paymentHash });
	}

	/**
	 * List transactions
	 */
	async listTransactions(params: ListTransactionsParams = {}): Promise<InvoiceResponse[]> {
		const response = await this.sendRequest<TransactionsResponse>('list_transactions', { ...params });
		return response.transactions;
	}

	/**
	 * Add event listener
	 */
	addListener(listener: (event: NWCEvent) => void): () => void {
		this._eventListeners.add(listener);
		return () => this._eventListeners.delete(listener);
	}

	// Private methods

	private async sendRequest<T>(method: NWCMethod, params: Record<string, unknown>): Promise<T> {
		if (!this.isConnected || !this._connectionInfo || !this._secretKeyBytes) {
			throw new WalletError('Wallet not connected', { code: ErrorCode.WALLET_NOT_CONNECTED });
		}

		const requestId = this.generateRequestId();
		const request: NWCRequest = { method, params };

		// Encrypt the request using NIP-04
		const encryptedContent = await nip04.encrypt(
			this._connectionInfo.secret,
			this._connectionInfo.walletPubkey,
			JSON.stringify(request)
		);

		// Create and sign the request event (kind 23194)
		const eventTemplate = {
			kind: 23194,
			created_at: Math.floor(Date.now() / 1000),
			tags: [['p', this._connectionInfo.walletPubkey]],
			content: encryptedContent
		};

		// Sign the event with our secret key
		const signedEvent = finalizeEvent(eventTemplate, this._secretKeyBytes);

		// Send to relay
		const eventMessage = JSON.stringify(['EVENT', signedEvent]);
		this._ws!.send(eventMessage);

		// Wait for response
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this._pendingRequests.delete(requestId);
				reject(new WalletError('Request timed out', { code: ErrorCode.WALLET_ERROR }));
			}, 30000);

			this._pendingRequests.set(requestId, {
				resolve: resolve as (value: unknown) => void,
				reject,
				timeout
			});
		});
	}

	private subscribeToResponses(): void {
		if (!this._ws || !this._connectionInfo) return;

		// Subscribe to response events (kind 23195)
		const subId = `nwc-${Date.now()}`;
		const filter = {
			kinds: [23195],
			authors: [this._connectionInfo.walletPubkey],
			'#p': [this.getOurPubkey()],
			since: Math.floor(Date.now() / 1000) - 60
		};

		const subMessage = JSON.stringify(['REQ', subId, filter]);
		this._ws.send(subMessage);
	}

	private async handleMessage(data: string): Promise<void> {
		try {
			const message = JSON.parse(data);
			
			if (message[0] === 'EVENT' && message[2]?.kind === 23195) {
				const event = message[2];
				
				// Decrypt the response
				const decryptedContent = await nip04.decrypt(
					this._connectionInfo!.secret,
					this._connectionInfo!.walletPubkey,
					event.content
				);

				const response = JSON.parse(decryptedContent) as NWCResponse;

				// Find and resolve pending request
				// Note: In a real implementation, we'd match by request ID in tags
				const [requestId, pending] = Array.from(this._pendingRequests.entries())[0] || [];
				
				if (pending) {
					clearTimeout(pending.timeout);
					this._pendingRequests.delete(requestId);

					if (response.error) {
						pending.reject(new WalletError(response.error.message, {
							code: ErrorCode.WALLET_ERROR,
							details: { errorCode: response.error.code }
						}));
					} else {
						pending.resolve(response.result);
					}
				}

				this.emit({ type: 'response', response });
			}
		} catch (error) {
			console.error('Failed to handle NWC message:', error);
		}
	}

	private attemptReconnect(): void {
		if (this._reconnectAttempts >= this._maxReconnectAttempts) {
			this.emit({ type: 'error', error: 'Max reconnection attempts reached' });
			return;
		}

		this._reconnectAttempts++;
		const delay = this._reconnectDelay * Math.pow(2, this._reconnectAttempts - 1);

		setTimeout(() => {
			if (this._connectionInfo) {
				// Reconstruct connection string for reconnect
				const connStr = `nostr+walletconnect://${this._connectionInfo.walletPubkey}?relay=${encodeURIComponent(this._connectionInfo.relayUrl)}&secret=${this._connectionInfo.secret}`;
				this.connect(connStr).catch(console.error);
			}
		}, delay);
	}

	private getOurPubkey(): string {
		return this._ourPubkey || '';
	}

	private generateRequestId(): string {
		return `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
	}

	private hexToBytes(hex: string): Uint8Array {
		const bytes = new Uint8Array(hex.length / 2);
		for (let i = 0; i < bytes.length; i++) {
			bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
		}
		return bytes;
	}

	private emit(event: NWCEvent): void {
		this._eventListeners.forEach(listener => {
			try {
				listener(event);
			} catch {
				// Ignore listener errors
			}
		});
	}
}

/** NWC events */
export type NWCEvent =
	| { type: 'connected' }
	| { type: 'disconnected' }
	| { type: 'error'; error: string }
	| { type: 'response'; response: NWCResponse };

/** Singleton instance */
export const nwcClient = new NWCClient();

export default nwcClient;
