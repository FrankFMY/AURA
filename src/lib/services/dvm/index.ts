/**
 * NIP-90 Data Vending Machine (DVM) Service
 * 
 * Implements decentralized AI/compute services over Nostr.
 * Users send Job Requests, DVMs process them and return results.
 * 
 * NIP-90 Event Kinds:
 * - 5000-5999: Job Requests
 * - 6000-6999: Job Results
 * - 7000: Job Feedback/Status
 * 
 * Common Job Types:
 * - 5000: Text Generation (AI chat)
 * - 5001: Text-to-Image
 * - 5002: Image-to-Text (OCR)
 * - 5003: Translation
 * - 5004: Summarization
 * - 5100-5199: Image processing
 * - 5200-5299: Video processing
 * - 5300-5399: Audio processing
 */

import type { NDKFilter, NDKEvent, NDKSubscription } from '@nostr-dev-kit/ndk';
import { NDKEvent as NDKEventClass } from '@nostr-dev-kit/ndk';
import ndkService, { eventPublisher } from '$services/ndk';
import { authStore } from '$stores/auth.svelte';

/** DVM Job Types */
export enum DVMJobKind {
	TEXT_GENERATION = 5000,
	TEXT_TO_IMAGE = 5001,
	IMAGE_TO_TEXT = 5002,
	TRANSLATION = 5003,
	SUMMARIZATION = 5004,
	TEXT_EXTRACTION = 5005,
	CONTENT_DISCOVERY = 5300,
	PEOPLE_DISCOVERY = 5301,
}

/** DVM Result Kind = Job Kind + 1000 */
export const getResultKind = (jobKind: DVMJobKind): number => jobKind + 1000;

/** DVM Feedback Kind */
export const DVM_FEEDBACK_KIND = 7000;

/** Job Status */
export enum DVMJobStatus {
	PENDING = 'pending',
	PROCESSING = 'processing',
	SUCCESS = 'success',
	ERROR = 'error',
	PARTIAL = 'partial',
	PAYMENT_REQUIRED = 'payment-required',
}

/** Job Request */
export interface DVMJobRequest {
	id: string;
	kind: DVMJobKind;
	input: string;
	inputType?: string; // 'text', 'url', 'event', 'job'
	outputType?: string; // 'text', 'image'
	params?: Record<string, string>;
	/** Max millisats to pay */
	bid?: number;
	/** Specific DVM pubkey to use */
	targetDvm?: string;
	createdAt: number;
}

/** Job Result */
export interface DVMJobResult {
	id: string;
	requestId: string;
	dvmPubkey: string;
	status: DVMJobStatus;
	output?: string;
	/** Amount paid in millisats */
	amount?: number;
	/** Invoice if payment required */
	invoice?: string;
	/** Error message */
	error?: string;
	createdAt: number;
}

/** Active job subscription */
interface ActiveJob {
	request: DVMJobRequest;
	subscription: NDKSubscription | null;
	results: DVMJobResult[];
	onResult: (result: DVMJobResult) => void;
	onError: (error: string) => void;
}

/**
 * DVM Service
 */
class DVMService {
	private activeJobs: Map<string, ActiveJob> = new Map();
	
	// Default relay for DVM discovery
	private dvmRelays: string[] = [
		'wss://relay.damus.io',
		'wss://relay.nostr.band',
		'wss://nos.lol'
	];

	/**
	 * Create and submit a job request
	 */
	async submitJob(
		kind: DVMJobKind,
		input: string,
		options: {
			inputType?: string;
			outputType?: string;
			params?: Record<string, string>;
			bid?: number;
			targetDvm?: string;
		} = {}
	): Promise<{
		requestId: string;
		subscribe: (
			onResult: (result: DVMJobResult) => void,
			onError: (error: string) => void
		) => void;
	}> {
		if (!authStore.isAuthenticated) {
			throw new Error('Not authenticated');
		}

		// Create job request event
		const event = new NDKEventClass(ndkService.ndk);
		event.kind = kind;
		event.content = '';
		
		// Add input tag
		const inputType = options.inputType || 'text';
		event.tags.push(['i', input, inputType]);

		// Add output type if specified
		if (options.outputType) {
			event.tags.push(['output', options.outputType]);
		}

		// Add params
		if (options.params) {
			for (const [key, value] of Object.entries(options.params)) {
				event.tags.push(['param', key, value]);
			}
		}

		// Add bid (max sats to pay)
		if (options.bid) {
			event.tags.push(['bid', String(options.bid * 1000)]); // Convert to millisats
		}

		// Target specific DVM
		if (options.targetDvm) {
			event.tags.push(['p', options.targetDvm]);
		}

		// Sign and publish
		await eventPublisher.publish(event);

		const requestId = event.id;

		const jobRequest: DVMJobRequest = {
			id: requestId,
			kind,
			input,
			inputType,
			outputType: options.outputType,
			params: options.params,
			bid: options.bid,
			targetDvm: options.targetDvm,
			createdAt: Math.floor(Date.now() / 1000)
		};

		return {
			requestId,
			subscribe: (onResult, onError) => {
				this.subscribeToJob(jobRequest, onResult, onError);
			}
		};
	}

	/**
	 * Subscribe to job results
	 */
	private subscribeToJob(
		request: DVMJobRequest,
		onResult: (result: DVMJobResult) => void,
		onError: (error: string) => void
	): void {
		if (!ndkService.ndk) {
			onError('NDK not initialized');
			return;
		}

		const resultKind = getResultKind(request.kind);

		// Subscribe to results and feedback
		const filter: NDKFilter = {
			kinds: [resultKind, DVM_FEEDBACK_KIND],
			'#e': [request.id],
			since: request.createdAt - 10
		};

		const sub = ndkService.ndk.subscribe(filter, { closeOnEose: false });

		const activeJob: ActiveJob = {
			request,
			subscription: sub,
			results: [],
			onResult,
			onError
		};

		this.activeJobs.set(request.id, activeJob);

		sub.on('event', (event: NDKEvent) => {
			this.handleDVMEvent(event, request.id);
		});

		// Timeout after 60 seconds
		setTimeout(() => {
			const job = this.activeJobs.get(request.id);
			if (job && job.results.length === 0) {
				onError('Request timed out - no DVM responded');
				this.cancelJob(request.id);
			}
		}, 60000);
	}

	/**
	 * Handle incoming DVM event
	 */
	private handleDVMEvent(event: NDKEvent, requestId: string): void {
		const job = this.activeJobs.get(requestId);
		if (!job) return;

		const result = this.parseResult(event, requestId);
		
		if (result) {
			job.results.push(result);
			job.onResult(result);

			// If success or error, close subscription
			if (result.status === DVMJobStatus.SUCCESS || result.status === DVMJobStatus.ERROR) {
				this.cancelJob(requestId);
			}
		}
	}

	/**
	 * Parse DVM result event
	 */
	private parseResult(event: NDKEvent, requestId: string): DVMJobResult | null {
		const isResult = event.kind >= 6000 && event.kind < 7000;
		const isFeedback = event.kind === DVM_FEEDBACK_KIND;

		if (!isResult && !isFeedback) return null;

		// Find request reference
		const requestRef = event.tags.find(t => t[0] === 'e' && t[1] === requestId);
		if (!requestRef) return null;

		let status: DVMJobStatus = DVMJobStatus.PROCESSING;
		let output: string | undefined;
		let invoice: string | undefined;
		let error: string | undefined;
		let amount: number | undefined;

		if (isResult) {
			// Parse result content
			output = event.content;
			
			// Check status tag
			const statusTag = event.tags.find(t => t[0] === 'status');
			if (statusTag) {
				switch (statusTag[1]) {
					case 'success': status = DVMJobStatus.SUCCESS; break;
					case 'error': status = DVMJobStatus.ERROR; error = statusTag[2]; break;
					case 'partial': status = DVMJobStatus.PARTIAL; break;
					default: status = DVMJobStatus.SUCCESS;
				}
			} else {
				status = DVMJobStatus.SUCCESS;
			}

			// Check for amount paid
			const amountTag = event.tags.find(t => t[0] === 'amount');
			if (amountTag) {
				amount = Number.parseInt(amountTag[1]) / 1000; // Convert from millisats
			}
		}

		if (isFeedback) {
			// Parse feedback
			const statusTag = event.tags.find(t => t[0] === 'status');
			if (statusTag) {
				switch (statusTag[1]) {
					case 'processing': status = DVMJobStatus.PROCESSING; break;
					case 'payment-required':
						status = DVMJobStatus.PAYMENT_REQUIRED;
						// Get invoice
						const amountTag = event.tags.find(t => t[0] === 'amount');
						if (amountTag) {
							amount = Number.parseInt(amountTag[1]) / 1000;
							invoice = amountTag[2]; // Invoice is in index 2
						}
						break;
					case 'error':
						status = DVMJobStatus.ERROR;
						error = statusTag[2] || event.content;
						break;
				}
			}
		}

		return {
			id: event.id,
			requestId,
			dvmPubkey: event.pubkey,
			status,
			output,
			amount,
			invoice,
			error,
			createdAt: event.created_at ?? Math.floor(Date.now() / 1000)
		};
	}

	/**
	 * Cancel a job subscription
	 */
	cancelJob(requestId: string): void {
		const job = this.activeJobs.get(requestId);
		if (job?.subscription) {
			job.subscription.stop();
		}
		this.activeJobs.delete(requestId);
	}

	/**
	 * Convenience method: AI Text Generation
	 */
	async generateText(
		prompt: string,
		options: {
			model?: string;
			maxTokens?: number;
			temperature?: number;
			bid?: number;
		} = {}
	): Promise<{
		requestId: string;
		subscribe: (
			onResult: (result: DVMJobResult) => void,
			onError: (error: string) => void
		) => void;
	}> {
		const params: Record<string, string> = {};
		
		if (options.model) params.model = options.model;
		if (options.maxTokens) params.max_tokens = String(options.maxTokens);
		if (options.temperature) params.temperature = String(options.temperature);

		return this.submitJob(DVMJobKind.TEXT_GENERATION, prompt, {
			outputType: 'text/plain',
			params,
			bid: options.bid || 100 // Default 100 sats
		});
	}

	/**
	 * Convenience method: Translation
	 */
	async translate(
		text: string,
		targetLanguage: string,
		options: {
			sourceLanguage?: string;
			bid?: number;
		} = {}
	): Promise<{
		requestId: string;
		subscribe: (
			onResult: (result: DVMJobResult) => void,
			onError: (error: string) => void
		) => void;
	}> {
		const params: Record<string, string> = {
			language: targetLanguage
		};
		
		if (options.sourceLanguage) {
			params.source_language = options.sourceLanguage;
		}

		return this.submitJob(DVMJobKind.TRANSLATION, text, {
			outputType: 'text/plain',
			params,
			bid: options.bid || 50
		});
	}

	/**
	 * Convenience method: Summarization
	 */
	async summarize(
		text: string,
		options: {
			length?: 'short' | 'medium' | 'long';
			bid?: number;
		} = {}
	): Promise<{
		requestId: string;
		subscribe: (
			onResult: (result: DVMJobResult) => void,
			onError: (error: string) => void
		) => void;
	}> {
		const params: Record<string, string> = {};
		
		if (options.length) params.length = options.length;

		return this.submitJob(DVMJobKind.SUMMARIZATION, text, {
			outputType: 'text/plain',
			params,
			bid: options.bid || 50
		});
	}

	/**
	 * Convenience method: Text-to-Image
	 */
	async generateImage(
		prompt: string,
		options: {
			size?: string; // e.g., '512x512', '1024x1024'
			style?: string;
			bid?: number;
		} = {}
	): Promise<{
		requestId: string;
		subscribe: (
			onResult: (result: DVMJobResult) => void,
			onError: (error: string) => void
		) => void;
	}> {
		const params: Record<string, string> = {};
		
		if (options.size) params.size = options.size;
		if (options.style) params.style = options.style;

		return this.submitJob(DVMJobKind.TEXT_TO_IMAGE, prompt, {
			outputType: 'url',
			params,
			bid: options.bid || 500 // Images cost more
		});
	}

	/**
	 * Discover available DVMs
	 */
	async discoverDVMs(kind?: DVMJobKind): Promise<{
		pubkey: string;
		name?: string;
		about?: string;
		nip05?: string;
		supportedKinds: number[];
	}[]> {
		if (!ndkService.ndk) {
			console.warn('[DVM] NDK not initialized');
			return [];
		}

		// DVMs advertise via NIP-89 (kind:31990)
		const filter: NDKFilter = {
			kinds: [31990],
			'#k': kind ? [String(kind)] : undefined,
			limit: 50
		};

		const events = await ndkService.ndk.fetchEvents(filter);
		const dvms: Map<string, {
			pubkey: string;
			name?: string;
			about?: string;
			nip05?: string;
			supportedKinds: number[];
		}> = new Map();

		for (const event of events) {
			try {
				const content = JSON.parse(event.content);
				const kTags = event.tags.filter(t => t[0] === 'k').map(t => Number.parseInt(t[1]));

				const existing = dvms.get(event.pubkey);
				if (existing) {
					existing.supportedKinds = [...new Set([...existing.supportedKinds, ...kTags])];
				} else {
					dvms.set(event.pubkey, {
						pubkey: event.pubkey,
						name: content.name,
						about: content.about,
						nip05: content.nip05,
						supportedKinds: kTags
					});
				}
			} catch {
				// Skip invalid
			}
		}

		return Array.from(dvms.values());
	}

	/**
	 * Get all active jobs
	 */
	getActiveJobs(): DVMJobRequest[] {
		return Array.from(this.activeJobs.values()).map(j => j.request);
	}

	/**
	 * Get job results
	 */
	getJobResults(requestId: string): DVMJobResult[] {
		return this.activeJobs.get(requestId)?.results || [];
	}

	/**
	 * Cleanup all subscriptions
	 */
	cleanup(): void {
		for (const [id] of this.activeJobs) {
			this.cancelJob(id);
		}
	}
}

export const dvmService = new DVMService();
export default dvmService;
