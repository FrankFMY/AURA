import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Mock browser APIs
const localStorageMock = {
	getItem: vi.fn(),
	setItem: vi.fn(),
	removeItem: vi.fn(),
	clear: vi.fn(),
	length: 0,
	key: vi.fn()
};

Object.defineProperty(window, 'localStorage', {
	value: localStorageMock
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
	writable: true,
	value: vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn()
	}))
});

// Mock ResizeObserver
class ResizeObserverMock {
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}

Object.defineProperty(window, 'ResizeObserver', {
	value: ResizeObserverMock
});

// Mock IntersectionObserver
class IntersectionObserverMock {
	constructor(callback: IntersectionObserverCallback) {
		this.callback = callback;
	}
	callback: IntersectionObserverCallback;
	observe = vi.fn();
	unobserve = vi.fn();
	disconnect = vi.fn();
}

Object.defineProperty(window, 'IntersectionObserver', {
	value: IntersectionObserverMock
});

// Mock crypto
Object.defineProperty(window, 'crypto', {
	value: {
		getRandomValues: (arr: Uint8Array) => {
			for (let i = 0; i < arr.length; i++) {
				arr[i] = Math.floor(Math.random() * 256);
			}
			return arr;
		},
		subtle: {
			importKey: vi.fn(),
			deriveKey: vi.fn(),
			encrypt: vi.fn(),
			decrypt: vi.fn(),
			digest: vi.fn()
		}
	}
});

// Mock WebSocket
class WebSocketMock {
	static CONNECTING = 0;
	static OPEN = 1;
	static CLOSING = 2;
	static CLOSED = 3;

	readyState = WebSocketMock.OPEN;
	onopen: (() => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: ((error: Event) => void) | null = null;
	onmessage: ((event: MessageEvent) => void) | null = null;

	constructor(public url: string) {
		setTimeout(() => this.onopen?.(), 0);
	}

	send = vi.fn();
	close = vi.fn(() => {
		this.readyState = WebSocketMock.CLOSED;
		this.onclose?.();
	});
}

Object.defineProperty(window, 'WebSocket', {
	value: WebSocketMock
});

// Mock IndexedDB (basic)
const indexedDBMock = {
	open: vi.fn().mockReturnValue({
		result: {},
		onerror: null,
		onsuccess: null,
		onupgradeneeded: null
	})
};

Object.defineProperty(window, 'indexedDB', {
	value: indexedDBMock
});

vi.mock('dompurify', () => {
	// This is a mock of the DOMPurify library.
	// We're creating a simple object that mimics the real library's API
	// so that our tests can run without needing a real DOM.
	const mockDOMPurify = {
		sanitize: vi.fn((dirty) =>
			typeof dirty === 'string' ? dirty.replace(/<script\b[^>]*>.*?<\/script>/gi, '') : dirty
		),
		addHook: vi.fn(),
		removeHook: vi.fn()
	};
	return {
		// The library uses a default export, so we mock it this way
		__esModule: true, // This is important for ES modules
		default: mockDOMPurify
	};
});

import { afterEach } from 'vitest';

// Clean up after each test
afterEach(() => {
	vi.clearAllMocks();
});
