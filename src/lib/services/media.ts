/**
 * Media Service
 * 
 * Handles media upload to Nostr-compatible services.
 * Supports nostr.build (free, no auth required).
 */

import { NetworkError, ErrorCode } from '$lib/core/errors';

/** Upload result */
export interface MediaUploadResult {
	url: string;
	deleteUrl?: string;
	mimeType?: string;
	size?: number;
	dimensions?: {
		width: number;
		height: number;
	};
}

/** Upload progress callback */
export type UploadProgressCallback = (progress: number) => void;

/** Supported media types */
export const SUPPORTED_IMAGE_TYPES = [
	'image/jpeg',
	'image/png',
	'image/gif',
	'image/webp',
	'image/svg+xml'
];

export const SUPPORTED_VIDEO_TYPES = [
	'video/mp4',
	'video/webm',
	'video/quicktime'
];

export const SUPPORTED_AUDIO_TYPES = [
	'audio/webm',
	'audio/ogg',
	'audio/mp4',
	'audio/mpeg',
	'audio/wav'
];

/** Max file sizes */
export const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_VIDEO_SIZE = 50 * 1024 * 1024; // 50MB
export const MAX_AUDIO_SIZE = 5 * 1024 * 1024; // 5MB

/**
 * Media Service Class
 */
class MediaService {
	private readonly NOSTR_BUILD_API = 'https://nostr.build/api/v2/upload/files';

	/**
	 * Upload a file to nostr.build
	 */
	async upload(
		file: File,
		onProgress?: UploadProgressCallback
	): Promise<MediaUploadResult> {
		// Validate file type
		const isImage = SUPPORTED_IMAGE_TYPES.includes(file.type);
		const isVideo = SUPPORTED_VIDEO_TYPES.includes(file.type);
		const isAudio = SUPPORTED_AUDIO_TYPES.includes(file.type);

		if (!isImage && !isVideo && !isAudio) {
			throw new NetworkError('Unsupported file type', {
				code: ErrorCode.VALIDATION_ERROR,
				details: {
					supportedTypes: [...SUPPORTED_IMAGE_TYPES, ...SUPPORTED_VIDEO_TYPES, ...SUPPORTED_AUDIO_TYPES]
				}
			});
		}

		// Validate file size
		let maxSize: number;
		if (isImage) {
			maxSize = MAX_IMAGE_SIZE;
		} else if (isVideo) {
			maxSize = MAX_VIDEO_SIZE;
		} else {
			maxSize = MAX_AUDIO_SIZE;
		}
		if (file.size > maxSize) {
			throw new NetworkError(`File too large. Max size: ${maxSize / 1024 / 1024}MB`, {
				code: ErrorCode.VALIDATION_ERROR
			});
		}

		// Create form data
		const formData = new FormData();
		formData.append('file', file);

		// Upload with progress tracking
		return new Promise((resolve, reject) => {
			const xhr = new XMLHttpRequest();

			xhr.upload.addEventListener('progress', (event) => {
				if (event.lengthComputable && onProgress) {
					const progress = Math.round((event.loaded / event.total) * 100);
					onProgress(progress);
				}
			});

			xhr.addEventListener('load', () => {
				if (xhr.status >= 200 && xhr.status < 300) {
					try {
						const response = JSON.parse(xhr.responseText);
						
						if (response.status === 'success' && response.data?.[0]) {
							const data = response.data[0];
							resolve({
								url: data.url,
								mimeType: data.mime,
								size: data.size,
								dimensions: data.dimensions ? {
									width: data.dimensions.width,
									height: data.dimensions.height
								} : undefined
							});
						} else {
							reject(new NetworkError(
								response.message || 'Upload failed',
								{ code: ErrorCode.NETWORK_ERROR }
							));
						}
					} catch (e) {
						reject(new NetworkError('Invalid response from server', {
							code: ErrorCode.NETWORK_ERROR
						}));
					}
				} else {
					reject(new NetworkError(`Upload failed: ${xhr.statusText}`, {
						code: ErrorCode.NETWORK_ERROR
					}));
				}
			});

			xhr.addEventListener('error', () => {
				reject(new NetworkError('Network error during upload', {
					code: ErrorCode.NETWORK_ERROR
				}));
			});

			xhr.addEventListener('abort', () => {
				reject(new NetworkError('Upload cancelled', {
					code: ErrorCode.NETWORK_ERROR
				}));
			});

			xhr.open('POST', this.NOSTR_BUILD_API);
			xhr.send(formData);
		});
	}

	/**
	 * Upload from a data URL (e.g., from clipboard)
	 */
	async uploadFromDataUrl(
		dataUrl: string,
		filename?: string,
		onProgress?: UploadProgressCallback
	): Promise<MediaUploadResult> {
		// Convert data URL to blob
		const response = await fetch(dataUrl);
		const blob = await response.blob();
		
		// Create file from blob
		const file = new File(
			[blob],
			filename || `image-${Date.now()}.${blob.type.split('/')[1]}`,
			{ type: blob.type }
		);

		return this.upload(file, onProgress);
	}

	/**
	 * Upload from clipboard
	 */
	async uploadFromClipboard(onProgress?: UploadProgressCallback): Promise<MediaUploadResult | null> {
		try {
			// Check if clipboard API is available
			if (!navigator.clipboard?.read) {
				console.warn('[Media] Clipboard API not available');
				return null;
			}
			const items = await navigator.clipboard.read();
			
			for (const item of items) {
				for (const type of item.types) {
					if (SUPPORTED_IMAGE_TYPES.includes(type)) {
						const blob = await item.getType(type);
						const file = new File(
							[blob],
							`clipboard-${Date.now()}.${type.split('/')[1]}`,
							{ type }
						);
						return this.upload(file, onProgress);
					}
				}
			}
			
			return null;
		} catch (e) {
			console.error('Failed to read clipboard:', e);
			return null;
		}
	}

	/**
	 * Create object URL for preview
	 */
	createPreviewUrl(file: File): string {
		return URL.createObjectURL(file);
	}

	/**
	 * Revoke object URL
	 */
	revokePreviewUrl(url: string): void {
		URL.revokeObjectURL(url);
	}

	/**
	 * Check if a URL is a valid image URL
	 */
	isImageUrl(url: string): boolean {
		try {
			const urlObj = new URL(url);
			const pathname = urlObj.pathname.toLowerCase();
			return (
				pathname.endsWith('.jpg') ||
				pathname.endsWith('.jpeg') ||
				pathname.endsWith('.png') ||
				pathname.endsWith('.gif') ||
				pathname.endsWith('.webp') ||
				pathname.endsWith('.svg')
			);
		} catch {
			return false;
		}
	}

	/**
	 * Check if a URL is a valid video URL
	 */
	isVideoUrl(url: string): boolean {
		try {
			const urlObj = new URL(url);
			const pathname = urlObj.pathname.toLowerCase();
			return (
				pathname.endsWith('.mp4') ||
				pathname.endsWith('.webm') ||
				pathname.endsWith('.mov')
			);
		} catch {
			return false;
		}
	}

	/**
	 * Check if a URL is a valid audio URL
	 */
	isAudioUrl(url: string): boolean {
		try {
			const urlObj = new URL(url);
			const pathname = urlObj.pathname.toLowerCase();
			return (
				pathname.endsWith('.webm') ||
				pathname.endsWith('.ogg') ||
				pathname.endsWith('.mp3') ||
				pathname.endsWith('.m4a') ||
				pathname.endsWith('.wav')
			);
		} catch {
			return false;
		}
	}

	/**
	 * Extract audio URL from message content
	 */
	extractAudioUrl(content: string): string | null {
		if (!content) return null;

		// Look for URLs that end with audio extensions
		const urlRegex = /https?:\/\/[^\s]+\.(webm|ogg|mp3|m4a|wav)(\?[^\s]*)?/gi;
		const match = content.match(urlRegex);
		return match ? match[0] : null;
	}

	/**
	 * Format file size for display
	 */
	formatFileSize(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
	}
}

/** Singleton instance */
export const mediaService = new MediaService();

export default mediaService;
