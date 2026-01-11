/**
 * Notifications Store
 * 
 * Manages toast notifications and in-app alerts
 */

import { ErrorHandler, type AuraError } from '$lib/core/errors';

/** Notification types */
export type NotificationType = 'info' | 'success' | 'warning' | 'error';

/** Toast notification */
export interface Toast {
	id: string;
	type: NotificationType;
	title: string;
	message?: string;
	duration?: number;
	dismissible?: boolean;
	action?: {
		label: string;
		onClick: () => void;
	};
	createdAt: number;
}

/** Toast options for creating new toasts */
export interface ToastOptions {
	type?: NotificationType;
	title: string;
	message?: string;
	duration?: number;
	dismissible?: boolean;
	action?: {
		label: string;
		onClick: () => void;
	};
}

/** Default durations by type (ms) */
const DEFAULT_DURATIONS: Record<NotificationType, number> = {
	info: 5000,
	success: 4000,
	warning: 6000,
	error: 8000
};

/** Maximum number of visible toasts */
const MAX_TOASTS = 5;

/** Create notifications store */
function createNotificationsStore() {
	let toasts = $state<Toast[]>([]);
	let timeouts = new Map<string, ReturnType<typeof setTimeout>>();

	/** Generate unique ID */
	function generateId(): string {
		return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
	}

	/** Add a toast notification */
	function addToast(options: ToastOptions): string {
		const id = generateId();
		const type = options.type || 'info';
		const duration = options.duration ?? DEFAULT_DURATIONS[type];

		const toast: Toast = {
			id,
			type,
			title: options.title,
			message: options.message,
			duration,
			dismissible: options.dismissible ?? true,
			action: options.action,
			createdAt: Date.now()
		};

		// Remove oldest toast if at max
		if (toasts.length >= MAX_TOASTS) {
			const oldest = toasts[0];
			removeToast(oldest.id);
		}

		toasts = [...toasts, toast];

		// Set auto-dismiss timeout if duration > 0
		if (duration > 0) {
			const timeout = setTimeout(() => {
				removeToast(id);
			}, duration);
			timeouts.set(id, timeout);
		}

		return id;
	}

	/** Remove a toast by ID */
	function removeToast(id: string): void {
		const timeout = timeouts.get(id);
		if (timeout) {
			clearTimeout(timeout);
			timeouts.delete(id);
		}

		toasts = toasts.filter(t => t.id !== id);
	}

	/** Clear all toasts */
	function clearAll(): void {
		timeouts.forEach(timeout => clearTimeout(timeout));
		timeouts.clear();
		toasts = [];
	}

	/** Convenience methods for different notification types */
	function info(title: string, message?: string, options?: Partial<ToastOptions>): string {
		return addToast({ ...options, type: 'info', title, message });
	}

	function success(title: string, message?: string, options?: Partial<ToastOptions>): string {
		return addToast({ ...options, type: 'success', title, message });
	}

	function warning(title: string, message?: string, options?: Partial<ToastOptions>): string {
		return addToast({ ...options, type: 'warning', title, message });
	}

	function error(title: string, message?: string, options?: Partial<ToastOptions>): string {
		return addToast({ ...options, type: 'error', title, message });
	}

	/** Show error from AuraError */
	function showError(auraError: AuraError): string {
		return addToast({
			type: 'error',
			title: 'Error',
			message: auraError.userMessage,
			duration: auraError.severity === 'critical' ? 0 : DEFAULT_DURATIONS.error,
			dismissible: auraError.recoverable
		});
	}

	/** Promise-based toast for async operations */
	function promise<T>(
		promise: Promise<T>,
		options: {
			loading: string;
			success: string | ((data: T) => string);
			error: string | ((error: unknown) => string);
		}
	): Promise<T> {
		const id = addToast({
			type: 'info',
			title: options.loading,
			duration: 0,
			dismissible: false
		});

		return promise
			.then((data) => {
				removeToast(id);
				const message = typeof options.success === 'function'
					? options.success(data)
					: options.success;
				success(message);
				return data;
			})
			.catch((err) => {
				removeToast(id);
				const message = typeof options.error === 'function'
					? options.error(err)
					: options.error;
				error(message);
				throw err;
			});
	}

	// Connect to error handler
	if (typeof window !== 'undefined') {
		ErrorHandler.addListener((auraError) => {
			// Auto-show errors with severity >= warning
			if (['error', 'critical'].includes(auraError.severity)) {
				showError(auraError);
			}
		});
	}

	return {
		// State
		get toasts() { return toasts; },

		// Actions
		addToast,
		removeToast,
		clearAll,

		// Convenience methods
		info,
		success,
		warning,
		error,
		showError,
		promise
	};
}

/** Notifications store singleton */
export const notificationsStore = createNotificationsStore();

export default notificationsStore;
