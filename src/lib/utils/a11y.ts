/**
 * Accessibility Utilities
 * 
 * Provides helpers for keyboard navigation, focus management, and ARIA.
 */

import { browser } from '$app/environment';

/** Focus trap options */
export interface FocusTrapOptions {
	/** Element to trap focus within */
	container: HTMLElement;
	/** Initial element to focus */
	initialFocus?: HTMLElement | string;
	/** Return focus to this element on release */
	returnFocus?: HTMLElement;
	/** Allow escape key to release trap */
	escapeDeactivates?: boolean;
	/** Callback when escape is pressed */
	onEscape?: () => void;
}

/** Focusable element selectors */
const FOCUSABLE_SELECTORS = [
	'a[href]',
	'button:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'textarea:not([disabled])',
	'[tabindex]:not([tabindex="-1"])',
	'[contenteditable="true"]'
].join(', ');

/**
 * Get all focusable elements within a container
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
	return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTORS)).filter(
		(el) => !el.hasAttribute('disabled') && el.offsetParent !== null
	);
}

/**
 * Create a focus trap within a container
 */
export function createFocusTrap(options: FocusTrapOptions): {
	activate: () => void;
	deactivate: () => void;
} {
	const { container, initialFocus, returnFocus, escapeDeactivates = true, onEscape } = options;

	let previousActiveElement: HTMLElement | null = null;
	let isActive = false;

	function handleKeyDown(event: KeyboardEvent) {
		if (!isActive) return;

		if (event.key === 'Tab') {
			const focusable = getFocusableElements(container);
			if (focusable.length === 0) return;

			const first = focusable[0];
			const last = focusable[focusable.length - 1];

			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		}

		if (event.key === 'Escape' && escapeDeactivates) {
			event.preventDefault();
			onEscape?.();
		}
	}

	function activate() {
		if (isActive) return;
		isActive = true;

		previousActiveElement = document.activeElement as HTMLElement;
		document.addEventListener('keydown', handleKeyDown);

		// Focus initial element
		requestAnimationFrame(() => {
			if (initialFocus) {
				const element =
					typeof initialFocus === 'string'
						? container.querySelector<HTMLElement>(initialFocus)
						: initialFocus;
				element?.focus();
			} else {
				const focusable = getFocusableElements(container);
				focusable[0]?.focus();
			}
		});
	}

	function deactivate() {
		if (!isActive) return;
		isActive = false;

		document.removeEventListener('keydown', handleKeyDown);

		// Return focus
		const returnTo = returnFocus || previousActiveElement;
		returnTo?.focus();
	}

	return { activate, deactivate };
}

/**
 * Announce a message to screen readers
 */
export function announce(message: string, priority: 'polite' | 'assertive' = 'polite'): void {
	if (!browser) return;

	const announcer = document.createElement('div');
	announcer.setAttribute('role', 'status');
	announcer.setAttribute('aria-live', priority);
	announcer.setAttribute('aria-atomic', 'true');
	announcer.className = 'sr-only';
	announcer.textContent = message;

	document.body.appendChild(announcer);

	// Remove after announcement
	setTimeout(() => {
		document.body.removeChild(announcer);
	}, 1000);
}

/**
 * Handle keyboard navigation for a list
 */
export function handleListKeyboard(
	event: KeyboardEvent,
	items: HTMLElement[],
	currentIndex: number,
	options: {
		onSelect?: (index: number) => void;
		orientation?: 'vertical' | 'horizontal';
		loop?: boolean;
	} = {}
): number {
	const { onSelect, orientation = 'vertical', loop = true } = options;

	const prevKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
	const nextKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';

	let newIndex = currentIndex;

	switch (event.key) {
		case prevKey:
			event.preventDefault();
			newIndex = currentIndex - 1;
			if (newIndex < 0) {
				newIndex = loop ? items.length - 1 : 0;
			}
			break;

		case nextKey:
			event.preventDefault();
			newIndex = currentIndex + 1;
			if (newIndex >= items.length) {
				newIndex = loop ? 0 : items.length - 1;
			}
			break;

		case 'Home':
			event.preventDefault();
			newIndex = 0;
			break;

		case 'End':
			event.preventDefault();
			newIndex = items.length - 1;
			break;

		case 'Enter':
		case ' ':
			event.preventDefault();
			onSelect?.(currentIndex);
			return currentIndex;
	}

	if (newIndex !== currentIndex && items[newIndex]) {
		items[newIndex].focus();
	}

	return newIndex;
}

/**
 * Generate a unique ID for ARIA relationships
 */
export function generateId(prefix: string = 'aura'): string {
	return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Check if user prefers reduced motion
 */
export function prefersReducedMotion(): boolean {
	if (!browser) return false;
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Check if user prefers high contrast
 */
export function prefersHighContrast(): boolean {
	if (!browser) return false;
	return window.matchMedia('(prefers-contrast: more)').matches;
}

/**
 * Skip link target management
 */
export function skipToContent(targetId: string = 'main-content'): void {
	const target = document.getElementById(targetId);
	if (target) {
		target.setAttribute('tabindex', '-1');
		target.focus();
		target.removeAttribute('tabindex');
	}
}

/**
 * Create roving tabindex for a group of elements
 */
export function createRovingTabindex(
	container: HTMLElement,
	selector: string,
	options: {
		orientation?: 'vertical' | 'horizontal';
		loop?: boolean;
	} = {}
): () => void {
	const { orientation = 'vertical', loop = true } = options;

	const items = Array.from(container.querySelectorAll<HTMLElement>(selector));
	if (items.length === 0) return () => {};

	let currentIndex = 0;

	// Initialize tabindex
	items.forEach((item, index) => {
		item.setAttribute('tabindex', index === 0 ? '0' : '-1');
	});

	function handleKeyDown(event: KeyboardEvent) {
		const target = event.target as HTMLElement;
		const index = items.indexOf(target);
		if (index === -1) return;

		const newIndex = handleListKeyboard(event, items, index, {
			orientation,
			loop,
			onSelect: () => items[index].click()
		});

		if (newIndex !== index) {
			items[index].setAttribute('tabindex', '-1');
			items[newIndex].setAttribute('tabindex', '0');
			currentIndex = newIndex;
		}
	}

	container.addEventListener('keydown', handleKeyDown);

	return () => {
		container.removeEventListener('keydown', handleKeyDown);
	};
}

export default {
	getFocusableElements,
	createFocusTrap,
	announce,
	handleListKeyboard,
	generateId,
	prefersReducedMotion,
	prefersHighContrast,
	skipToContent,
	createRovingTabindex
};
