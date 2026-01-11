/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const self = globalThis as unknown as ServiceWorkerGlobalScope;

// Unique cache name for this deployment
const CACHE = `aura-cache-${version}`;

// Assets to cache immediately
const ASSETS = [
	...build, // the app itself
	...files // everything in `static`
];

// Install: cache all static assets
self.addEventListener('install', (event) => {
	async function addFilesToCache() {
		const cache = await caches.open(CACHE);
		await cache.addAll(ASSETS);
	}

	event.waitUntil(addFilesToCache());
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
	async function deleteOldCaches() {
		for (const key of await caches.keys()) {
			if (key !== CACHE) {
				await caches.delete(key);
			}
		}
	}

	event.waitUntil(deleteOldCaches());
});

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

	async function respond() {
		const cache = await caches.open(CACHE);

		// Try cache first for static assets
		if (ASSETS.includes(url.pathname)) {
			const cachedResponse = await cache.match(url.pathname);
			if (cachedResponse) {
				return cachedResponse;
			}
		}

		// Network-first for HTML pages
		if (event.request.mode === 'navigate') {
			try {
				const response = await fetch(event.request);
				// Cache successful responses
				if (response.status === 200) {
					cache.put(event.request, response.clone());
				}
				return response;
			} catch {
				// Offline: try to return cached page or fallback
				const cachedResponse = await cache.match(event.request);
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
		const cachedResponse = await cache.match(event.request);

		const fetchPromise = fetch(event.request).then((response) => {
			// Only cache valid responses
			if (response.status === 200 && response.type === 'basic') {
				cache.put(event.request, response.clone());
			}
			return response;
		});

		// Return cached immediately, update cache in background
		return cachedResponse || fetchPromise;
	}

	event.respondWith(respond());
});

// Handle push notifications (future feature)
self.addEventListener('push', (event) => {
	if (!event.data) return;

	const data = event.data.json();

	const options: NotificationOptions = {
		body: data.body,
		icon: '/icon-192.png',
		badge: '/icon-192.png',
		tag: data.tag || 'aura-notification',
		data: data.data,
		actions: data.actions
	};

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

// Background sync (future feature)
self.addEventListener('sync', (event) => {
	if (event.tag === 'sync-messages') {
		// Sync pending messages when back online
		event.waitUntil(syncMessages());
	}
});

async function syncMessages() {
	// This would sync any pending outgoing messages
	// stored in IndexedDB when back online
	console.log('Syncing messages...');
}
