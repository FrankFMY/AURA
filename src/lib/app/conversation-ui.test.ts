import { describe, expect, it } from 'vitest';
import {
	CoalescingTaskRunner,
	ConversationDraftStore,
	isCurrentRefreshContext,
	isCurrentSessionOperation,
	isNearConversationEnd,
	resizeComposer,
	scrollToConversationEnd,
	shouldClearSubmittedDraft,
	shouldSendComposerKey
} from './conversation-ui';

describe('conversation composer policy', () => {
	it('never sends while an IME composition is active', () => {
		expect(
			shouldSendComposerKey({ key: 'Enter', shiftKey: false, isComposing: true }, { mobile: false })
		).toBe(false);
	});

	it('sends only plain desktop Enter', () => {
		expect(
			shouldSendComposerKey(
				{ key: 'Enter', shiftKey: false, isComposing: false },
				{ mobile: false }
			)
		).toBe(true);
		expect(
			shouldSendComposerKey({ key: 'Enter', shiftKey: true, isComposing: false }, { mobile: false })
		).toBe(false);
	});

	it('does not send the Safari IME completion key event', () => {
		expect(
			shouldSendComposerKey(
				{ key: 'Enter', shiftKey: false, isComposing: false, keyCode: 229 },
				{ mobile: false }
			)
		).toBe(false);
	});

	it('keeps Return as a newline action on mobile', () => {
		expect(
			shouldSendComposerKey({ key: 'Enter', shiftKey: false, isComposing: false }, { mobile: true })
		).toBe(false);
	});

	it('grows with content and caps the visible composer height', () => {
		const style = { height: '', overflowY: '' };
		resizeComposer({ scrollHeight: 166, style }, 144);

		expect(style.height).toBe('144px');
		expect(style.overflowY).toBe('auto');
	});

	it('treats a conversation as near the end within the configured threshold', () => {
		expect(isNearConversationEnd({ scrollTop: 2433, scrollHeight: 2809, clientHeight: 376 })).toBe(
			true
		);
		expect(isNearConversationEnd({ scrollTop: 2200, scrollHeight: 2809, clientHeight: 376 })).toBe(
			false
		);
	});

	it('scrolls to the latest message deterministically', () => {
		const scroller = { scrollTop: 0, scrollHeight: 2809 };
		scrollToConversationEnd(scroller);
		expect(scroller.scrollTop).toBe(2809);
	});

	it('coalesces overlapping refresh requests into one trailing run', async () => {
		const releases: Array<() => void> = [];
		let runs = 0;
		const runner = new CoalescingTaskRunner(
			async () => {
				runs += 1;
				await new Promise<void>((resolve) => releases.push(resolve));
			},
			() => undefined
		);

		const first = runner.request();
		const overlapping = runner.request();
		const alsoOverlapping = runner.request();
		expect(overlapping).not.toBe(first);
		expect(alsoOverlapping).toBe(overlapping);
		await Promise.resolve();
		expect(runs).toBe(1);

		let overlappingSettled = false;
		void overlapping.then(() => {
			overlappingSettled = true;
		});
		releases.shift()?.();
		await first;
		await Promise.resolve();
		await Promise.resolve();
		expect(runs).toBe(2);
		expect(overlappingSettled).toBe(false);

		releases.shift()?.();
		await overlapping;
		await runner.whenIdle();
		expect(runs).toBe(2);
	});

	it('does not leak a current refresh failure into a queued request', async () => {
		let runs = 0;
		const runner = new CoalescingTaskRunner(
			async () => {
				runs += 1;
				if (runs === 1) throw new Error('stale refresh failed');
			},
			() => undefined
		);

		const current = runner.request();
		const queued = runner.request();
		await expect(current).rejects.toThrow('stale refresh failed');
		await expect(queued).resolves.toBeUndefined();
		expect(runs).toBe(2);
	});

	it('propagates a trailing failure to its callers and background reporter', async () => {
		let runs = 0;
		const backgroundErrors: unknown[] = [];
		const runner = new CoalescingTaskRunner(
			async () => {
				runs += 1;
				if (runs === 2) throw new Error('trailing refresh failed');
			},
			(cause) => backgroundErrors.push(cause)
		);

		const current = runner.request();
		const queued = runner.request();
		await expect(current).resolves.toBeUndefined();
		await expect(queued).rejects.toThrow('trailing refresh failed');
		expect(backgroundErrors).toHaveLength(1);
	});

	it('settles a cancelled queued request without starting another worker', async () => {
		let release!: () => void;
		let runs = 0;
		const runner = new CoalescingTaskRunner(
			async () => {
				runs += 1;
				await new Promise<void>((resolve) => {
					release = resolve;
				});
			},
			() => undefined
		);

		const current = runner.request();
		const queued = runner.request();
		await Promise.resolve();
		runner.cancelQueued();
		await expect(queued).resolves.toBeUndefined();
		release();
		await current;
		await runner.whenIdle();
		expect(runs).toBe(1);
	});

	it('rejects refresh results and errors from an old session or conversation', () => {
		const databaseA = {};
		const databaseB = {};
		const runtimeA = {};
		const runtimeB = {};
		const captured = { database: databaseA, runtime: runtimeA, conversation: 'alice' };

		expect(isCurrentRefreshContext(captured, captured)).toBe(true);
		expect(
			isCurrentRefreshContext(captured, {
				database: databaseB,
				runtime: runtimeB,
				conversation: 'alice'
			})
		).toBe(false);
		expect(
			isCurrentRefreshContext(captured, {
				database: databaseA,
				runtime: runtimeA,
				conversation: 'bob'
			})
		).toBe(false);
	});

	it('invalidates late send work across lock or session replacement', () => {
		const runtime = {};
		const session = {};
		const captured = { generation: 7, runtime, session };

		expect(isCurrentSessionOperation(captured, captured)).toBe(true);
		expect(isCurrentSessionOperation(captured, { generation: 8, runtime, session })).toBe(false);
		expect(isCurrentSessionOperation(captured, { generation: 7, runtime: {}, session: {} })).toBe(
			false
		);
	});

	it('clears only the exact draft that was submitted', () => {
		expect(shouldClearSubmittedDraft('hello', 'hello')).toBe(true);
		expect(shouldClearSubmittedDraft('hello\nnew text', 'hello')).toBe(false);
		expect(shouldClearSubmittedDraft('', 'hello')).toBe(false);
	});

	it('isolates in-memory drafts by conversation and clears them on lock', () => {
		const drafts = new ConversationDraftStore();
		drafts.save('alice', 'one\ntwo');
		drafts.save('bob', 'different');

		expect(drafts.load('alice')).toBe('one\ntwo');
		expect(drafts.load('bob')).toBe('different');
		drafts.save('alice', '');
		expect(drafts.load('alice')).toBe('');
		drafts.clear();
		expect(drafts.load('bob')).toBe('');
	});
});
