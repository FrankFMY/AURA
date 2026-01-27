/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

declare const self: ServiceWorkerGlobalScope;

// Extended types for Service Worker APIs
interface SyncEvent extends ExtendableEvent {
	tag: string;
}

interface ExtendedNotificationOptions extends NotificationOptions {
	actions?: NotificationAction[];
}

interface NotificationAction {
	action: string;
	title: string;
	icon?: string;
}

// Unique cache name for this deployment
const CACHE = `aura-cache-${version}`;

// Assets to cache immediately
const ASSETS = [
	...build, // the app itself
	...files // everything in `static`
];

/** Add all static assets to cache */
async function addFilesToCache(): Promise<void> {
	const cache = await caches.open(CACHE);
	await cache.addAll(ASSETS);
}

/** Delete old caches */
async function deleteOldCaches(): Promise<void> {
	for (const key of await caches.keys()) {
		if (key !== CACHE) {
			await caches.delete(key);
		}
	}
}

// Install: cache all static assets
self.addEventListener('install', (event) => {
	event.waitUntil(addFilesToCache());
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
	event.waitUntil(deleteOldCaches());
});

/** Handle fetch request with caching strategy */
async function handleFetchRequest(request: Request, url: URL): Promise<Response | undefined> {
	const cache = await caches.open(CACHE);

	// Try cache first for static assets
	if (ASSETS.includes(url.pathname)) {
		const cachedResponse = await cache.match(url.pathname);
		if (cachedResponse) {
			return cachedResponse;
		}
	}

	// Network-first for HTML pages
	if (request.mode === 'navigate') {
		try {
			const response = await fetch(request);
			// Cache successful responses
			if (response.status === 200) {
				cache.put(request, response.clone());
			}
			return response;
		} catch {
			// Offline: try to return cached page or fallback
			const cachedResponse = await cache.match(request);
			if (cachedResponse) {
				return cachedResponse;
			}
			// Return the fallback page for SPA navigation
			const fallback = await cache.match('/200.html');
			if (fallback) {
				return fallback;
			}
		}
	}

	// Stale-while-revalidate for other requests
	const cachedResponse = await cache.match(request);

	const fetchPromise = fetch(request).then((response) => {
		// Only cache valid responses
		if (response.status === 200 && response.type === 'basic') {
			cache.put(request, response.clone());
		}
		return response;
	});

	// Return cached immediately, update cache in background
	return cachedResponse ?? fetchPromise;
}

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', (event) => {
	// Skip non-GET requests
	if (event.request.method !== 'GET') return;

	// Skip WebSocket connections
	if (event.request.url.startsWith('wss://')) return;

	// Skip cross-origin requests (except for fonts and images)
	const url = new URL(event.request.url);
	if (url.origin !== self.location.origin) {
		// Allow caching fonts and images from CDNs
		if (!event.request.destination || !['font', 'image'].includes(event.request.destination)) {
			return;
		}
	}

	event.respondWith(handleFetchRequest(event.request, url) as Promise<Response>);
});

// Handle push notifications
self.addEventListener('push', (event) => {
	if (!event.data) return;

	const data = event.data.json();

	const options: ExtendedNotificationOptions = {
		body: data.body,
		icon: '/icon-192.svg',
		badge: '/icon-192.svg',
		tag: data.tag || 'aura-notification',
		data: data.data
	};

	// Add actions if provided
	if (data.actions) {
		options.actions = data.actions;
	}

	event.waitUntil(
		self.registration.showNotification(data.title || 'AURA', options)
	);
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	const data = event.notification.data;
	const urlToOpen = data?.url || '/';

	event.waitUntil(
		self.clients.matchAll({ type: 'window' }).then((clientList) => {
			// Focus existing window if available
			for (const client of clientList) {
				if (client.url === urlToOpen && 'focus' in client) {
					return client.focus();
				}
			}
			// Open new window
			if (self.clients.openWindow) {
				return self.clients.openWindow(urlToOpen);
			}
		})
	);
});

// Background sync for offline messages
self.addEventListener('sync', (event: Event) => {
	const syncEvent = event as SyncEvent;
	if (syncEvent.tag === 'sync-outbox') {
		syncEvent.waitUntil(syncOutbox());
	}
});

/**
 * Sync pending outbox events when back online.
 * Sends a message to the main thread to process queued events.
 */
async function syncOutbox(): Promise<void> {
	const clients = await self.clients.matchAll({ type: 'window' });

	if (clients.length === 0) {
		// No active clients, can't process outbox
		return;
	}

	// Send message to first available client to process outbox
	clients[0].postMessage({
		type: 'SYNC_OUTBOX',
		timestamp: Date.now()
	});
}

// Listen for messages from main thread
self.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') {
		self.skipWaiting();
	}
});
