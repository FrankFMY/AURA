export interface ComposerKeyInput {
	key: string;
	shiftKey: boolean;
	isComposing: boolean;
	keyCode?: number;
}

export interface ComposerKeyContext {
	mobile: boolean;
}

export interface ComposerGeometry {
	readonly scrollHeight: number;
	style: {
		height: string;
		overflowY: string;
	};
}

export function resizeComposer(element: ComposerGeometry, maximumHeight = 144): void {
	if (!Number.isFinite(maximumHeight) || maximumHeight < 1) {
		throw new Error('composer maximum height is invalid');
	}
	element.style.height = 'auto';
	element.style.height = `${Math.min(element.scrollHeight, maximumHeight)}px`;
	element.style.overflowY = element.scrollHeight > maximumHeight ? 'auto' : 'hidden';
}

export interface ScrollGeometry {
	readonly scrollTop: number;
	readonly scrollHeight: number;
	readonly clientHeight: number;
}

export function isNearConversationEnd(geometry: ScrollGeometry, threshold = 96): boolean {
	if (!Number.isFinite(threshold) || threshold < 0) {
		throw new Error('conversation scroll threshold is invalid');
	}
	const remaining = geometry.scrollHeight - geometry.clientHeight - geometry.scrollTop;
	return remaining <= threshold;
}

export interface WritableScrollGeometry {
	scrollTop: number;
	readonly scrollHeight: number;
}

export function scrollToConversationEnd(geometry: WritableScrollGeometry): void {
	geometry.scrollTop = geometry.scrollHeight;
}

export interface RefreshContext {
	readonly database: object;
	readonly runtime: object;
	readonly conversation: string;
}

export function isCurrentRefreshContext(
	captured: RefreshContext,
	current: RefreshContext
): boolean {
	return (
		captured.database === current.database &&
		captured.runtime === current.runtime &&
		captured.conversation === current.conversation
	);
}

export interface SessionOperationContext {
	readonly generation: number;
	readonly runtime: object;
	readonly session: object;
}

export function isCurrentSessionOperation(
	captured: SessionOperationContext,
	current: SessionOperationContext
): boolean {
	return (
		captured.generation === current.generation &&
		captured.runtime === current.runtime &&
		captured.session === current.session
	);
}

export class CoalescingTaskRunner {
	#running: Promise<void> | undefined;
	#queued:
		| {
				promise: Promise<void>;
				resolve: () => void;
				reject: (cause: unknown) => void;
		  }
		| undefined;

	constructor(
		private readonly worker: () => Promise<void>,
		private readonly onBackgroundError: (cause: unknown) => void
	) {}

	request(): Promise<void> {
		if (this.#running) {
			if (!this.#queued) {
				let resolve!: () => void;
				let reject!: (cause: unknown) => void;
				const promise = new Promise<void>((onResolve, onReject) => {
					resolve = onResolve;
					reject = onReject;
				});
				this.#queued = { promise, resolve, reject };
			}
			return this.#queued.promise;
		}
		return this.#start();
	}

	cancelQueued(): void {
		const queued = this.#queued;
		this.#queued = undefined;
		queued?.resolve();
	}

	async whenIdle(): Promise<void> {
		while (this.#running) {
			try {
				await this.#running;
			} catch {
				// The caller of request owns the foreground error.
			}
		}
	}

	#start(): Promise<void> {
		const task = Promise.resolve().then(this.worker);
		this.#running = task;
		void task.then(
			() => this.#finish(task),
			() => this.#finish(task)
		);
		return task;
	}

	#finish(task: Promise<void>): void {
		if (this.#running !== task) return;
		this.#running = undefined;
		const queued = this.#queued;
		this.#queued = undefined;
		if (!queued) return;
		const trailing = this.#start();
		void trailing.then(queued.resolve, (cause) => {
			queued.reject(cause);
			try {
				this.onBackgroundError(cause);
			} catch {
				// Error reporting must not create another unhandled rejection.
			}
		});
	}
}

export class ConversationDraftStore {
	#drafts = new Map<string, string>();

	save(conversation: string, draft: string): void {
		if (!conversation) return;
		if (draft) this.#drafts.set(conversation, draft);
		else this.#drafts.delete(conversation);
	}

	load(conversation: string): string {
		return this.#drafts.get(conversation) ?? '';
	}

	clear(): void {
		this.#drafts.clear();
	}
}

export function shouldClearSubmittedDraft(currentDraft: string, submittedDraft: string): boolean {
	return currentDraft === submittedDraft;
}

export function shouldSendComposerKey(
	input: ComposerKeyInput,
	context: ComposerKeyContext
): boolean {
	return (
		input.key === 'Enter' &&
		!input.shiftKey &&
		!input.isComposing &&
		input.keyCode !== 229 &&
		!context.mobile
	);
}
