/**
 * Image Compression Utility
 *
 * Compresses images using Canvas API before upload.
 * Targets: max 1920px dimension, quality 0.85, WebP when supported.
 */

export interface CompressionOptions {
	/** Max width or height in pixels */
	maxDimension?: number;
	/** Quality (0-1) for lossy formats */
	quality?: number;
	/** Output format: 'webp', 'jpeg', or 'original' */
	outputFormat?: 'webp' | 'jpeg' | 'original';
	/** Skip compression if file is smaller than this (bytes) */
	skipIfSmallerThan?: number;
}

export interface CompressionResult {
	/** Compressed file */
	file: File;
	/** Original size in bytes */
	originalSize: number;
	/** Compressed size in bytes */
	compressedSize: number;
	/** Size reduction percentage */
	reduction: number;
	/** Whether compression was applied */
	wasCompressed: boolean;
	/** New dimensions if resized */
	dimensions?: { width: number; height: number };
}

const DEFAULT_OPTIONS: CompressionOptions = {
	maxDimension: 1920,
	quality: 0.85,
	outputFormat: 'webp',
	skipIfSmallerThan: 100 * 1024 // 100KB
};

/** MIME types that can be compressed */
const COMPRESSIBLE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** Check if browser supports WebP encoding */
function supportsWebP(): boolean {
	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	return canvas.toDataURL('image/webp').startsWith('data:image/webp');
}

/**
 * Load an image from a File
 */
function loadImage(file: File): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		img.onload = () => resolve(img);
		img.onerror = () => reject(new Error('Failed to load image'));

		const url = URL.createObjectURL(file);
		img.src = url;

		// Clean up URL after load
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
	});
}

/**
 * Calculate new dimensions while maintaining aspect ratio
 */
function calculateDimensions(
	width: number,
	height: number,
	maxDimension: number
): { width: number; height: number; resized: boolean } {
	if (width <= maxDimension && height <= maxDimension) {
		return { width, height, resized: false };
	}

	const ratio = Math.min(maxDimension / width, maxDimension / height);
	return {
		width: Math.round(width * ratio),
		height: Math.round(height * ratio),
		resized: true
	};
}

/**
 * Convert canvas to File
 */
function canvasToFile(
	canvas: HTMLCanvasElement,
	filename: string,
	mimeType: string,
	quality: number
): Promise<File> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (!blob) {
					reject(new Error('Failed to create blob'));
					return;
				}

				const file = new File([blob], filename, { type: mimeType });
				resolve(file);
			},
			mimeType,
			quality
		);
	});
}

/**
 * Get output MIME type based on options and browser support
 */
function getOutputMimeType(
	originalType: string,
	outputFormat: 'webp' | 'jpeg' | 'original'
): string {
	if (outputFormat === 'original') {
		// For PNG, keep as PNG to preserve transparency
		return originalType;
	}

	if (outputFormat === 'webp' && supportsWebP()) {
		return 'image/webp';
	}

	// Fallback to JPEG
	return 'image/jpeg';
}

/**
 * Get file extension from MIME type
 */
function getExtension(mimeType: string): string {
	const map: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
		'image/gif': 'gif'
	};
	return map[mimeType] || 'jpg';
}

/**
 * Compress an image file
 */
export async function compressImage(
	file: File,
	options: CompressionOptions = {}
): Promise<CompressionResult> {
	const opts = { ...DEFAULT_OPTIONS, ...options };
	const originalSize = file.size;

	// Skip non-compressible types (GIF, SVG)
	if (!COMPRESSIBLE_TYPES.includes(file.type)) {
		return {
			file,
			originalSize,
			compressedSize: originalSize,
			reduction: 0,
			wasCompressed: false
		};
	}

	// Skip if already small enough
	if (opts.skipIfSmallerThan && file.size < opts.skipIfSmallerThan) {
		return {
			file,
			originalSize,
			compressedSize: originalSize,
			reduction: 0,
			wasCompressed: false
		};
	}

	try {
		// Load image
		const img = await loadImage(file);

		// Calculate new dimensions
		const { width, height, resized } = calculateDimensions(
			img.naturalWidth,
			img.naturalHeight,
			opts.maxDimension!
		);

		// Determine output format
		const outputMimeType = getOutputMimeType(file.type, opts.outputFormat!);

		// Create canvas and draw
		const canvas = document.createElement('canvas');
		canvas.width = width;
		canvas.height = height;

		const ctx = canvas.getContext('2d');
		if (!ctx) {
			throw new Error('Failed to get canvas context');
		}

		// Use high quality scaling
		ctx.imageSmoothingEnabled = true;
		ctx.imageSmoothingQuality = 'high';

		// Draw image
		ctx.drawImage(img, 0, 0, width, height);

		// Generate new filename
		const baseName = file.name.replace(/\.[^.]+$/, '');
		const extension = getExtension(outputMimeType);
		const newFilename = `${baseName}.${extension}`;

		// Convert to file
		const compressedFile = await canvasToFile(
			canvas,
			newFilename,
			outputMimeType,
			opts.quality!
		);

		const compressedSize = compressedFile.size;

		// If compression actually made it larger, return original
		if (compressedSize >= originalSize) {
			return {
				file,
				originalSize,
				compressedSize: originalSize,
				reduction: 0,
				wasCompressed: false
			};
		}

		const reduction = Math.round(((originalSize - compressedSize) / originalSize) * 100);

		return {
			file: compressedFile,
			originalSize,
			compressedSize,
			reduction,
			wasCompressed: true,
			dimensions: resized ? { width, height } : undefined
		};
	} catch (e) {
		console.warn('[ImageCompression] Compression failed, using original:', e);
		return {
			file,
			originalSize,
			compressedSize: originalSize,
			reduction: 0,
			wasCompressed: false
		};
	}
}

/**
 * Format bytes for display
 */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default {
	compressImage,
	formatBytes,
	supportsWebP
};
