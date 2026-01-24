import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock functions
const { mockPublish, mockSubscribe } = vi.hoisted(() => ({
	mockPublish: vi.fn().mockResolvedValue(undefined),
	mockSubscribe: vi.fn()
}));

// Mock auth store
vi.mock('$stores/auth.svelte', () => ({
	authStore: {
		isAuthenticated: true,
		pubkey: 'testpubkey123'
	}
}));

// Mock NDK service
vi.mock('$services/ndk', () => ({
	default: {
		ndk: {
			subscribe: mockSubscribe
		}
	},
	eventPublisher: {
		publish: mockPublish
	}
}));

// Import after mocks
import { 
	dvmService, 
	DVMJobKind, 
	DVMJobStatus, 
	getResultKind,
	DVM_FEEDBACK_KIND,
	type DVMJobResult 
} from '$lib/services/dvm';

describe('DVM Service', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Reset internal state
		(dvmService as any).activeJobs = new Map();
		
		// Default mock for subscribe
		mockSubscribe.mockReturnValue({
			on: vi.fn(),
			stop: vi.fn()
		});
	});

	afterEach(() => {
		dvmService.cleanup();
	});

	describe('Job Kind Constants', () => {
		it('should have correct job kind values', () => {
			expect(DVMJobKind.TEXT_GENERATION).toBe(5000);
			expect(DVMJobKind.TEXT_TO_IMAGE).toBe(5001);
			expect(DVMJobKind.TRANSLATION).toBe(5003);
			expect(DVMJobKind.SUMMARIZATION).toBe(5004);
		});

		it('should calculate result kind correctly', () => {
			expect(getResultKind(DVMJobKind.TEXT_GENERATION)).toBe(6000);
			expect(getResultKind(DVMJobKind.TEXT_TO_IMAGE)).toBe(6001);
		});

		it('should have correct feedback kind', () => {
			expect(DVM_FEEDBACK_KIND).toBe(7000);
		});
	});

	describe('Job Submission', () => {
		it('should submit a job and return request ID', async () => {
			const result = await dvmService.submitJob(
				DVMJobKind.TEXT_GENERATION,
				'Hello, world!'
			);

			expect(result.requestId).toBeDefined();
			expect(typeof result.requestId).toBe('string');
			expect(result.subscribe).toBeInstanceOf(Function);
		});

		it('should publish event with correct kind', async () => {
			await dvmService.submitJob(
				DVMJobKind.TEXT_GENERATION,
				'Test input'
			);

			expect(mockPublish).toHaveBeenCalledTimes(1);
			const publishedEvent = mockPublish.mock.calls[0][0];
			expect(publishedEvent.kind).toBe(DVMJobKind.TEXT_GENERATION);
		});

		it('should include input tag', async () => {
			await dvmService.submitJob(
				DVMJobKind.TEXT_GENERATION,
				'Test input',
				{ inputType: 'text' }
			);

			const publishedEvent = mockPublish.mock.calls[0][0];
			const inputTag = publishedEvent.tags.find((t: string[]) => t[0] === 'i');
			expect(inputTag).toBeDefined();
			expect(inputTag[1]).toBe('Test input');
			expect(inputTag[2]).toBe('text');
		});

		it('should include bid tag when specified', async () => {
			await dvmService.submitJob(
				DVMJobKind.TEXT_GENERATION,
				'Test',
				{ bid: 100 }
			);

			const publishedEvent = mockPublish.mock.calls[0][0];
			const bidTag = publishedEvent.tags.find((t: string[]) => t[0] === 'bid');
			expect(bidTag).toBeDefined();
			expect(bidTag[1]).toBe('100000'); // millisats
		});

		it('should include output type when specified', async () => {
			await dvmService.submitJob(
				DVMJobKind.TEXT_GENERATION,
				'Test',
				{ outputType: 'text/plain' }
			);

			const publishedEvent = mockPublish.mock.calls[0][0];
			const outputTag = publishedEvent.tags.find((t: string[]) => t[0] === 'output');
			expect(outputTag).toBeDefined();
			expect(outputTag[1]).toBe('text/plain');
		});

		it('should include params when specified', async () => {
			await dvmService.submitJob(
				DVMJobKind.TEXT_GENERATION,
				'Test',
				{ params: { model: 'gpt-4', temperature: '0.7' } }
			);

			const publishedEvent = mockPublish.mock.calls[0][0];
			const paramTags = publishedEvent.tags.filter((t: string[]) => t[0] === 'param');
			expect(paramTags.length).toBe(2);
		});
	});

	describe('Convenience Methods', () => {
		it('generateText should use TEXT_GENERATION kind', async () => {
			await dvmService.generateText('Hello');

			const publishedEvent = mockPublish.mock.calls[0][0];
			expect(publishedEvent.kind).toBe(DVMJobKind.TEXT_GENERATION);
		});

		it('generateText should include model param when specified', async () => {
			await dvmService.generateText('Hello', { model: 'llama-3' });

			const publishedEvent = mockPublish.mock.calls[0][0];
			const modelParam = publishedEvent.tags.find(
				(t: string[]) => t[0] === 'param' && t[1] === 'model'
			);
			expect(modelParam).toBeDefined();
			expect(modelParam[2]).toBe('llama-3');
		});

		it('translate should use TRANSLATION kind', async () => {
			await dvmService.translate('Hello', 'es');

			const publishedEvent = mockPublish.mock.calls[0][0];
			expect(publishedEvent.kind).toBe(DVMJobKind.TRANSLATION);
		});

		it('translate should include language param', async () => {
			await dvmService.translate('Hello', 'es');

			const publishedEvent = mockPublish.mock.calls[0][0];
			const langParam = publishedEvent.tags.find(
				(t: string[]) => t[0] === 'param' && t[1] === 'language'
			);
			expect(langParam).toBeDefined();
			expect(langParam[2]).toBe('es');
		});

		it('summarize should use SUMMARIZATION kind', async () => {
			await dvmService.summarize('Long text here...');

			const publishedEvent = mockPublish.mock.calls[0][0];
			expect(publishedEvent.kind).toBe(DVMJobKind.SUMMARIZATION);
		});

		it('generateImage should use TEXT_TO_IMAGE kind', async () => {
			await dvmService.generateImage('A cat');

			const publishedEvent = mockPublish.mock.calls[0][0];
			expect(publishedEvent.kind).toBe(DVMJobKind.TEXT_TO_IMAGE);
		});
	});

	describe('Job Management', () => {
		it('should track active jobs', async () => {
			const job = await dvmService.submitJob(DVMJobKind.TEXT_GENERATION, 'Test');
			
			// Subscribe to activate the job
			job.subscribe(() => {}, () => {});

			const activeJobs = dvmService.getActiveJobs();
			expect(activeJobs.length).toBe(1);
			expect(activeJobs[0].id).toBe(job.requestId);
		});

		it('should cancel a job', async () => {
			const job = await dvmService.submitJob(DVMJobKind.TEXT_GENERATION, 'Test');
			job.subscribe(() => {}, () => {});

			expect(dvmService.getActiveJobs().length).toBe(1);
			
			dvmService.cancelJob(job.requestId);
			
			expect(dvmService.getActiveJobs().length).toBe(0);
		});

		it('cleanup should cancel all jobs', async () => {
			const job1 = await dvmService.submitJob(DVMJobKind.TEXT_GENERATION, 'Test1');
			job1.subscribe(() => {}, () => {});
			
			expect(dvmService.getActiveJobs().length).toBeGreaterThanOrEqual(1);
			
			dvmService.cleanup();
			
			expect(dvmService.getActiveJobs().length).toBe(0);
		});
	});

	describe('DVMJobStatus enum', () => {
		it('should have all required status values', () => {
			expect(DVMJobStatus.PENDING).toBe('pending');
			expect(DVMJobStatus.PROCESSING).toBe('processing');
			expect(DVMJobStatus.SUCCESS).toBe('success');
			expect(DVMJobStatus.ERROR).toBe('error');
			expect(DVMJobStatus.PARTIAL).toBe('partial');
			expect(DVMJobStatus.PAYMENT_REQUIRED).toBe('payment-required');
		});
	});
});
