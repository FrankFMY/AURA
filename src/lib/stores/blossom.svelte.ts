/**
 * Blossom Store
 * 
 * Reactive state for file uploads and media management.
 */

import { blossomService, type BlossomServer, type BlobDescriptor, type UploadResult } from '$lib/services/blossom';

/** Upload state */
export interface UploadState {
	id: string;
	file: File;
	progress: number;
	status: 'pending' | 'uploading' | 'complete' | 'error';
	result?: UploadResult;
	error?: string;
}

function createBlossomStore() {
	// State
	let uploads = $state<UploadState[]>([]);
	let userBlobs = $state<BlobDescriptor[]>([]);
	let isLoadingBlobs = $state(false);
	let servers = $state<BlossomServer[]>(blossomService.getServers());
	let preferredServer = $state<string | null>(null);

	/**
	 * Upload a file
	 */
	async function upload(file: File): Promise<UploadResult> {
		const id = crypto.randomUUID();
		
		const uploadState: UploadState = {
			id,
			file,
			progress: 0,
			status: 'pending'
		};
		
		uploads = [...uploads, uploadState];

		try {
			// Update status to uploading
			uploads = uploads.map(u => 
				u.id === id ? { ...u, status: 'uploading' as const } : u
			);

			const result = await blossomService.upload(file, {
				server: preferredServer || undefined,
				onProgress: (progress) => {
					uploads = uploads.map(u =>
						u.id === id ? { ...u, progress } : u
					);
				}
			});

			// Update with result
			uploads = uploads.map(u =>
				u.id === id ? { ...u, status: 'complete' as const, progress: 100, result } : u
			);

			return result;
		} catch (e) {
			const error = e instanceof Error ? e.message : 'Upload failed';
			
			uploads = uploads.map(u =>
				u.id === id ? { ...u, status: 'error' as const, error } : u
			);

			throw e;
		}
	}

	/**
	 * Upload multiple files
	 */
	async function uploadMultiple(files: File[]): Promise<UploadResult[]> {
		const results: UploadResult[] = [];
		
		for (const file of files) {
			try {
				const result = await upload(file);
				results.push(result);
			} catch {
				// Continue with other files
			}
		}
		
		return results;
	}

	/**
	 * Load user's uploaded blobs
	 */
	async function loadUserBlobs(): Promise<void> {
		isLoadingBlobs = true;
		
		try {
			const blobs = await blossomService.listUploads();
			userBlobs = blobs;
		} catch (e) {
			console.error('Failed to load blobs:', e);
		} finally {
			isLoadingBlobs = false;
		}
	}

	/**
	 * Delete a blob
	 */
	async function deleteBlob(sha256: string): Promise<boolean> {
		const success = await blossomService.delete(sha256);
		
		if (success) {
			userBlobs = userBlobs.filter(b => b.sha256 !== sha256);
		}
		
		return success;
	}

	/**
	 * Clear completed uploads from list
	 */
	function clearCompleted(): void {
		uploads = uploads.filter(u => u.status !== 'complete');
	}

	/**
	 * Clear failed uploads from list
	 */
	function clearFailed(): void {
		uploads = uploads.filter(u => u.status !== 'error');
	}

	/**
	 * Retry failed upload
	 */
	async function retry(id: string): Promise<void> {
		const uploadState = uploads.find(u => u.id === id);
		if (!uploadState || uploadState.status !== 'error') return;

		// Remove old state
		uploads = uploads.filter(u => u.id !== id);
		
		// Re-upload
		await upload(uploadState.file);
	}

	/**
	 * Cancel pending upload
	 */
	function cancel(id: string): void {
		uploads = uploads.filter(u => u.id !== id);
	}

	/**
	 * Add a server
	 */
	function addServer(server: BlossomServer): void {
		blossomService.addServer(server);
		servers = blossomService.getServers();
	}

	/**
	 * Remove a server
	 */
	function removeServer(url: string): void {
		blossomService.removeServer(url);
		servers = blossomService.getServers();
	}

	/**
	 * Set preferred server
	 */
	function setPreferredServer(url: string | null): void {
		preferredServer = url;
		blossomService.setPreferredServer(url);
	}

	/**
	 * Get blob URL
	 */
	function getBlobUrl(sha256: string): string {
		return blossomService.getBlobUrl(sha256, preferredServer || undefined);
	}

	/**
	 * Check if blob exists
	 */
	async function exists(sha256: string): Promise<boolean> {
		return blossomService.exists(sha256);
	}

	/**
	 * Get upload state by ID
	 */
	function getUpload(id: string): UploadState | undefined {
		return uploads.find(u => u.id === id);
	}

	/**
	 * Get active (non-complete) uploads
	 */
	const activeUploads = $derived(
		uploads.filter(u => u.status === 'pending' || u.status === 'uploading')
	);

	/**
	 * Get total upload progress
	 */
	const totalProgress = $derived(
		activeUploads.length > 0
			? activeUploads.reduce((sum, u) => sum + u.progress, 0) / activeUploads.length
			: 0
	);

	/**
	 * Check if any upload is in progress
	 */
	const isUploading = $derived(
		uploads.some(u => u.status === 'uploading')
	);

	return {
		// State
		get uploads() { return uploads; },
		get userBlobs() { return userBlobs; },
		get isLoadingBlobs() { return isLoadingBlobs; },
		get servers() { return servers; },
		get preferredServer() { return preferredServer; },
		
		// Derived
		get activeUploads() { return activeUploads; },
		get totalProgress() { return totalProgress; },
		get isUploading() { return isUploading; },

		// Actions
		upload,
		uploadMultiple,
		loadUserBlobs,
		deleteBlob,
		clearCompleted,
		clearFailed,
		retry,
		cancel,
		addServer,
		removeServer,
		setPreferredServer,
		getBlobUrl,
		exists,
		getUpload
	};
}

export const blossomStore = createBlossomStore();
export default blossomStore;
