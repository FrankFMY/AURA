export type OperationGuard = () => boolean;

export const operationAlwaysCurrent: OperationGuard = () => true;

export class OperationCancelledError extends Error {
	constructor() {
		super('operation cancelled');
		this.name = 'OperationCancelledError';
	}
}

export function assertOperationCurrent(isCurrent: OperationGuard): void {
	if (!isCurrent()) throw new OperationCancelledError();
}

export function isOperationCancelled(cause: unknown): cause is OperationCancelledError {
	return cause instanceof OperationCancelledError;
}
