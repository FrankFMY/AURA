/**
 * DVM (Data Vending Machine) Store
 * 
 * Reactive state for NIP-90 AI/compute jobs.
 */

import { dvmService, DVMJobStatus, type DVMJobRequest, type DVMJobResult } from '$lib/services/dvm';
import { walletStore } from './wallet.svelte';
import { cashuStore } from './cashu.svelte';

/** Chat message */
export interface ChatMessage {
	id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	timestamp: number;
	/** If assistant, the DVM that responded */
	dvmPubkey?: string;
	/** Cost in sats */
	cost?: number;
	/** Status for assistant messages */
	status?: DVMJobStatus;
	/** Error message */
	error?: string;
}

/** Job history entry */
export interface JobHistoryEntry {
	request: DVMJobRequest;
	results: DVMJobResult[];
	status: DVMJobStatus;
}

function createDVMStore() {
	// Chat state
	let messages = $state<ChatMessage[]>([]);
	let isProcessing = $state(false);
	let currentRequestId = $state<string | null>(null);

	// Settings
	let defaultBid = $state(100); // sats
	let autoPayEnabled = $state(true);
	let selectedModel = $state<string | null>(null);

	// Job history
	let jobHistory = $state<JobHistoryEntry[]>([]);

	// Available DVMs
	let availableDVMs = $state<{
		pubkey: string;
		name?: string;
		about?: string;
		supportedKinds: number[];
	}[]>([]);

	/**
	 * Send a chat message to AI
	 */
	async function sendMessage(content: string): Promise<void> {
		if (isProcessing || !content.trim()) return;

		isProcessing = true;

		// Add user message
		const userMessage: ChatMessage = {
			id: crypto.randomUUID(),
			role: 'user',
			content: content.trim(),
			timestamp: Date.now()
		};
		messages = [...messages, userMessage];

		// Add placeholder assistant message
		const assistantId = crypto.randomUUID();
		const assistantMessage: ChatMessage = {
			id: assistantId,
			role: 'assistant',
			content: '',
			timestamp: Date.now(),
			status: DVMJobStatus.PENDING
		};
		messages = [...messages, assistantMessage];

		try {
			// Build context from recent messages
			const context = buildContext(content);

			// Submit job
			const job = await dvmService.generateText(context, {
				model: selectedModel || undefined,
				bid: defaultBid
			});

			currentRequestId = job.requestId;

			// Subscribe to results
			job.subscribe(
				(result) => handleResult(assistantId, result),
				(error) => handleError(assistantId, error)
			);

		} catch (e) {
			handleError(assistantId, e instanceof Error ? e.message : 'Failed to send message');
		}
	}

	/**
	 * Build context from chat history
	 */
	function buildContext(newMessage: string): string {
		// Include last 5 messages for context
		const recentMessages = messages.slice(-10);
		
		let context = '';
		for (const msg of recentMessages) {
			if (msg.role === 'user') {
				context += `User: ${msg.content}\n`;
			} else if (msg.role === 'assistant' && msg.status === DVMJobStatus.SUCCESS) {
				context += `Assistant: ${msg.content}\n`;
			}
		}
		
		context += `User: ${newMessage}\nAssistant:`;
		return context;
	}

	/**
	 * Handle DVM result
	 */
	function handleResult(messageId: string, result: DVMJobResult): void {
		const messageIndex = messages.findIndex(m => m.id === messageId);
		if (messageIndex === -1) return;

		if (result.status === DVMJobStatus.SUCCESS) {
			messages = messages.map((m, i) =>
				i === messageIndex
					? {
							...m,
							content: result.output || '',
							status: DVMJobStatus.SUCCESS,
							dvmPubkey: result.dvmPubkey,
							cost: result.amount
						}
					: m
			);
			isProcessing = false;
			currentRequestId = null;
		} else if (result.status === DVMJobStatus.PROCESSING) {
			messages = messages.map((m, i) =>
				i === messageIndex
					? { ...m, status: DVMJobStatus.PROCESSING }
					: m
			);
		} else if (result.status === DVMJobStatus.PAYMENT_REQUIRED) {
			// Handle payment
			if (autoPayEnabled && result.invoice && result.amount) {
				handlePayment(messageId, result);
			} else {
				messages = messages.map((m, i) =>
					i === messageIndex
						? {
								...m,
								status: DVMJobStatus.PAYMENT_REQUIRED,
								error: `Payment required: ${result.amount} sats`
							}
						: m
				);
			}
		} else if (result.status === DVMJobStatus.ERROR) {
			handleError(messageId, result.error || 'Unknown error');
		} else if (result.status === DVMJobStatus.PARTIAL) {
			// Streaming partial result
			messages = messages.map((m, i) =>
				i === messageIndex
					? {
							...m,
							content: (m.content || '') + (result.output || ''),
							status: DVMJobStatus.PARTIAL
						}
					: m
			);
		}
	}

	/**
	 * Handle payment for job
	 */
	async function handlePayment(messageId: string, result: DVMJobResult): Promise<void> {
		if (!result.invoice || !result.amount) return;

		try {
			// Try Cashu first, then Lightning
			if (cashuStore.totalBalance >= result.amount) {
				// Pay with eCash - this would require DVM to accept eCash
				// For now, fall back to Lightning
			}

			// Pay with Lightning
			await walletStore.payInvoice(result.invoice);
			
			// Update status
			messages = messages.map((m) =>
				m.id === messageId
					? { ...m, status: DVMJobStatus.PROCESSING, error: undefined }
					: m
			);
		} catch (e) {
			handleError(messageId, `Payment failed: ${e instanceof Error ? e.message : 'Unknown error'}`);
		}
	}

	/**
	 * Handle error
	 */
	function handleError(messageId: string, error: string): void {
		messages = messages.map((m) =>
			m.id === messageId
				? { ...m, status: DVMJobStatus.ERROR, error, content: error }
				: m
		);
		isProcessing = false;
		currentRequestId = null;
	}

	/**
	 * Retry last failed message
	 */
	async function retryLast(): Promise<void> {
		const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
		if (!lastUserMessage) return;

		// Remove failed assistant message
		messages = messages.filter(m => 
			!(m.role === 'assistant' && m.status === DVMJobStatus.ERROR)
		);

		// Resend
		await sendMessage(lastUserMessage.content);
	}

	/**
	 * Cancel current request
	 */
	function cancel(): void {
		if (currentRequestId) {
			dvmService.cancelJob(currentRequestId);
			
			// Mark as cancelled
			messages = messages.map(m =>
				m.status === DVMJobStatus.PENDING || m.status === DVMJobStatus.PROCESSING
					? { ...m, status: DVMJobStatus.ERROR, error: 'Cancelled' }
					: m
			);
		}
		isProcessing = false;
		currentRequestId = null;
	}

	/**
	 * Clear chat history
	 */
	function clearChat(): void {
		messages = [];
		isProcessing = false;
		currentRequestId = null;
	}

	/**
	 * Translate text
	 */
	async function translate(
		text: string,
		targetLanguage: string
	): Promise<string> {
		const job = await dvmService.translate(text, targetLanguage, {
			bid: Math.round(defaultBid / 2)
		});

		return new Promise((resolve, reject) => {
			job.subscribe(
				(result) => {
					if (result.status === DVMJobStatus.SUCCESS && result.output) {
						resolve(result.output);
					}
				},
				(error) => reject(new Error(error))
			);
		});
	}

	/**
	 * Summarize text
	 */
	async function summarize(text: string): Promise<string> {
		const job = await dvmService.summarize(text, {
			bid: Math.round(defaultBid / 2)
		});

		return new Promise((resolve, reject) => {
			job.subscribe(
				(result) => {
					if (result.status === DVMJobStatus.SUCCESS && result.output) {
						resolve(result.output);
					}
				},
				(error) => reject(new Error(error))
			);
		});
	}

	/**
	 * Generate image
	 */
	async function generateImage(
		prompt: string,
		onResult: (url: string) => void,
		onError: (error: string) => void
	): Promise<void> {
		const job = await dvmService.generateImage(prompt, {
			bid: defaultBid * 5 // Images cost more
		});

		job.subscribe(
			(result) => {
				if (result.status === DVMJobStatus.SUCCESS && result.output) {
					onResult(result.output);
				}
			},
			onError
		);
	}

	/**
	 * Discover available DVMs
	 */
	async function discoverDVMs(): Promise<void> {
		const dvms = await dvmService.discoverDVMs();
		availableDVMs = dvms;
	}

	/**
	 * Set default bid
	 */
	function setDefaultBid(bid: number): void {
		defaultBid = Math.max(1, bid);
	}

	/**
	 * Toggle auto-pay
	 */
	function setAutoPay(enabled: boolean): void {
		autoPayEnabled = enabled;
	}

	/**
	 * Set preferred model
	 */
	function setModel(model: string | null): void {
		selectedModel = model;
	}

	/**
	 * Add system message
	 */
	function addSystemMessage(content: string): void {
		messages = [...messages, {
			id: crypto.randomUUID(),
			role: 'system',
			content,
			timestamp: Date.now()
		}];
	}

	/**
	 * Cleanup
	 */
	function cleanup(): void {
		dvmService.cleanup();
		messages = [];
		isProcessing = false;
		currentRequestId = null;
	}

	return {
		// State
		get messages() { return messages; },
		get isProcessing() { return isProcessing; },
		get currentRequestId() { return currentRequestId; },
		get defaultBid() { return defaultBid; },
		get autoPayEnabled() { return autoPayEnabled; },
		get selectedModel() { return selectedModel; },
		get availableDVMs() { return availableDVMs; },
		get jobHistory() { return jobHistory; },

		// Actions
		sendMessage,
		retryLast,
		cancel,
		clearChat,
		translate,
		summarize,
		generateImage,
		discoverDVMs,
		setDefaultBid,
		setAutoPay,
		setModel,
		addSystemMessage,
		cleanup
	};
}

export const dvmStore = createDVMStore();
export default dvmStore;
