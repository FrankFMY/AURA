/**
 * Blossom Service
 * 
 * Blossom is a spec for storing blobs (files) on decentralized servers.
 * Files are addressed by their SHA-256 hash and authenticated via NIP-98.
 * 
 * @see https://github.com/hzrd149/blossom
 */

import type { NDKEvent } from '@nostr-dev-kit/ndk';
import { NDKEvent as NDKEventClass } from '@nostr-dev-kit/ndk';
import ndkService from '$services/ndk';
import { authStore } from '$stores/auth.svelte';

/** Blossom server info */
export interface BlossomServer {
	url: string;
	name?: string;
	description?: string;
	acceptedTypes?: string[];
	maxSize?: number; // bytes
}

/** Blob descriptor */
export interface BlobDescriptor {
	sha256: string;
	url: string;
	size: number;
	type: string;
	uploaded: number; // timestamp
}

/** Upload result */
export interface UploadResult {
	url: string;
	sha256: string;
	size: number;
	type: string;
	nip94?: NDKEvent; // Optional NIP-94 file metadata event
}

/** Default public Blossom servers */
const DEFAULT_SERVERS: BlossomServer[] = [
	{ url: 'https://blossom.primal.net', name: 'Primal' },
	{ url: 'https://media.nostr.band', name: 'Nostr.band' },
	{ url: 'https://nostr.build', name: 'Nostr.build' }
];

/**
 * Create NIP-98 HTTP Auth event
 */
async function createAuthEvent(
	url: string,
	method: string,
	sha256?: string
): Promise<string> {
	if (!authStore.pubkey) {
		throw new Error('Not authenticated');
	}

	const event = new NDKEventClass(ndkService.ndk);
	event.kind = 24242; // NIP-98 HTTP Auth
	event.created_at = Math.floor(Date.now() / 1000);
	event.content = '';
	
	// Required tags
	event.tags = [
		['u', url],
		['method', method.toUpperCase()]
	];

	// Add payload hash for uploads
	if (sha256) {
		event.tags.push(['x', sha256]);
	}

	// Add expiration (5 minutes)
	event.tags.push(['expiration', String(Math.floor(Date.now() / 1000) + 300)]);

	await event.sign();
	
	// Return base64 encoded event
	return btoa(JSON.stringify(event.rawEvent()));
}

/**
 * Calculate SHA-256 hash of a file
 */
async function hashFile(file: File): Promise<string> {
	const buffer = await file.arrayBuffer();
	const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
	const hashArray = Array.from(new Uint8Array(hashBuffer));
	return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Blossom Service
 */
class BlossomService {
	private servers: BlossomServer[] = [...DEFAULT_SERVERS];
	private preferredServer: string | null = null;

	/**
	 * Get list of servers
	 */
	getServers(): BlossomServer[] {
		return [...this.servers];
	}

	/**
	 * Add a server
	 */
	addServer(server: BlossomServer): void {
		if (!this.servers.find(s => s.url === server.url)) {
			this.servers.push(server);
		}
	}

	/**
	 * Remove a server
	 */
	removeServer(url: string): void {
		this.servers = this.servers.filter(s => s.url !== url);
	}

	/**
	 * Set preferred server
	 */
	setPreferredServer(url: string | null): void {
		this.preferredServer = url;
	}

	/**
	 * Get server URL for uploads
	 */
	private getUploadServer(): string {
		if (this.preferredServer) {
			return this.preferredServer;
		}
		// Return first available server
		return this.servers[0]?.url || DEFAULT_SERVERS[0].url;
	}

	/**
	 * Upload a file to Blossom
	 */
	async upload(
		file: File,
		options: {
			server?: string;
			onProgress?: (progress: number) => void;
		} = {}
	): Promise<UploadResult> {
		const serverUrl = options.server || this.getUploadServer();
		const sha256 = await hashFile(file);
		
		// Create auth header
		const authToken = await createAuthEvent(
			`${serverUrl}/upload`,
			'PUT',
			sha256
		);

		// Upload with XMLHttpRequest for progress tracking
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();
			
			xhr.upload.addEventListener('progress', (e) => {
				if (e.lengthComputable && options.onProgress) {
					options.onProgress((e.loaded / e.total) * 100);
				}
			});

			xhr.addEventListener('load', () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					try {
						const response = JSON.parse(xhr.responseText);
						resolve({
							url: response.url || `${serverUrl}/${sha256}`,
							sha256: response.sha256 || sha256,
							size: response.size || file.size,
							type: response.type || file.type
						});
					} catch {
						// Fallback if response isn't JSON
						resolve({
							url: `${serverUrl}/${sha256}`,
							sha256,
							size: file.size,
							type: file.type
						});
					}
				} else {
					reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
				}
			});

			xhr.addEventListener('error', () => {
				reject(new Error('Upload failed: Network error'));
			});

			xhr.open('PUT', `${serverUrl}/upload`);
			xhr.setRequestHeader('Authorization', `Nostr ${authToken}`);
			xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
			xhr.setRequestHeader('X-Content-Length', String(file.size));
			xhr.send(file);
		});
	}

	/**
	 * Upload multiple files
	 */
	async uploadMultiple(
		files: File[],
		options: {
			server?: string;
			onProgress?: (fileIndex: number, progress: number) => void;
		} = {}
	): Promise<UploadResult[]> {
		const results: UploadResult[] = [];
		
		for (let i = 0; i < files.length; i++) {
			const result = await this.upload(files[i], {
				server: options.server,
				onProgress: options.onProgress 
					? (p) => options.onProgress!(i, p)
					: undefined
			});
			results.push(result);
		}
		
		return results;
	}

	/**
	 * Check if a blob exists on server
	 */
	async exists(sha256: string, server?: string): Promise<boolean> {
		const serverUrl = server || this.getUploadServer();
		
		try {
			const response = await fetch(`${serverUrl}/${sha256}`, {
				method: 'HEAD'
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	/**
	 * Get blob URL
	 */
	getBlobUrl(sha256: string, server?: string): string {
		const serverUrl = server || this.getUploadServer();
		return `${serverUrl}/${sha256}`;
	}

	/**
	 * Delete a blob (requires auth)
	 */
	async delete(sha256: string, server?: string): Promise<boolean> {
		const serverUrl = server || this.getUploadServer();
		
		const authToken = await createAuthEvent(
			`${serverUrl}/${sha256}`,
			'DELETE'
		);

		try {
			const response = await fetch(`${serverUrl}/${sha256}`, {
				method: 'DELETE',
				headers: {
					'Authorization': `Nostr ${authToken}`
				}
			});
			return response.ok;
		} catch {
			return false;
		}
	}

	/**
	 * List user's uploads on a server
	 */
	async listUploads(server?: string): Promise<BlobDescriptor[]> {
		if (!authStore.pubkey) {
			throw new Error('Not authenticated');
		}

		const serverUrl = server || this.getUploadServer();
		
		const authToken = await createAuthEvent(
			`${serverUrl}/list/${authStore.pubkey}`,
			'GET'
		);

		try {
			const response = await fetch(`${serverUrl}/list/${authStore.pubkey}`, {
				headers: {
					'Authorization': `Nostr ${authToken}`
				}
			});

			if (!response.ok) {
				throw new Error(`Failed to list uploads: ${response.status}`);
			}

			return await response.json();
		} catch (e) {
			console.error('Failed to list uploads:', e);
			return [];
		}
	}

	/**
	 * Mirror a blob from one server to another
	 */
	async mirror(sha256: string, fromServer: string, toServer: string): Promise<boolean> {
		// Download from source
		const sourceUrl = `${fromServer}/${sha256}`;
		
		try {
			const response = await fetch(sourceUrl);
			if (!response.ok) return false;
			
			const blob = await response.blob();
			const file = new File([blob], sha256, { type: blob.type });
			
			// Upload to destination
			await this.upload(file, { server: toServer });
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Create NIP-94 file metadata event
	 */
	async createFileMetadataEvent(
		uploadResult: UploadResult,
		options: {
			filename?: string;
			description?: string;
			dimensions?: { width: number; height: number };
			blurhash?: string;
		} = {}
	): Promise<NDKEvent> {
		const event = new NDKEventClass(ndkService.ndk);
		event.kind = 1063; // NIP-94 file metadata
		event.content = options.description || '';
		
		event.tags = [
			['url', uploadResult.url],
			['x', uploadResult.sha256],
			['m', uploadResult.type],
			['size', String(uploadResult.size)]
		];

		if (options.filename) {
			event.tags.push(['filename', options.filename]);
		}

		if (options.dimensions) {
			event.tags.push(['dim', `${options.dimensions.width}x${options.dimensions.height}`]);
		}

		if (options.blurhash) {
			event.tags.push(['blurhash', options.blurhash]);
		}

		await event.sign();
		await event.publish();

		return event;
	}

	/**
	 * Get image dimensions from file
	 */
	async getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
		if (!file.type.startsWith('image/')) return null;

		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				resolve({ width: img.naturalWidth, height: img.naturalHeight });
				URL.revokeObjectURL(img.src);
			};
			img.onerror = () => {
				resolve(null);
				URL.revokeObjectURL(img.src);
			};
			img.src = URL.createObjectURL(file);
		});
	}
}

export const blossomService = new BlossomService();
export default blossomService;
