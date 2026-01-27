/**
 * QR Code Utilities
 *
 * Generates QR codes for Nostr public keys (npub).
 */

import QRCode from 'qrcode';

export interface QROptions {
	/** Width/height in pixels */
	size?: number;
	/** Margin (modules) */
	margin?: number;
	/** Dark color (foreground) */
	darkColor?: string;
	/** Light color (background) */
	lightColor?: string;
	/** Error correction level */
	errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

const DEFAULT_OPTIONS: QROptions = {
	size: 256,
	margin: 2,
	darkColor: '#000000',
	lightColor: '#ffffff',
	errorCorrectionLevel: 'M'
};

/**
 * Generate QR code as data URL
 * @param data The data to encode (e.g., nostr:npub...)
 * @param options QR generation options
 * @returns Data URL string (base64 PNG)
 */
export async function generateQRDataURL(
	data: string,
	options: QROptions = {}
): Promise<string> {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	return QRCode.toDataURL(data, {
		width: opts.size,
		margin: opts.margin,
		color: {
			dark: opts.darkColor,
			light: opts.lightColor
		},
		errorCorrectionLevel: opts.errorCorrectionLevel
	});
}

/**
 * Generate QR code as SVG string
 * @param data The data to encode
 * @param options QR generation options
 * @returns SVG string
 */
export async function generateQRSVG(
	data: string,
	options: QROptions = {}
): Promise<string> {
	const opts = { ...DEFAULT_OPTIONS, ...options };

	return QRCode.toString(data, {
		type: 'svg',
		width: opts.size,
		margin: opts.margin,
		color: {
			dark: opts.darkColor,
			light: opts.lightColor
		},
		errorCorrectionLevel: opts.errorCorrectionLevel
	});
}

/**
 * Generate Nostr URI for QR code
 * @param npub The npub to encode
 * @returns Nostr URI (nostr:npub...)
 */
export function createNostrURI(npub: string): string {
	// Ensure it starts with nostr: prefix
	if (npub.startsWith('nostr:')) {
		return npub;
	}
	return `nostr:${npub}`;
}

/**
 * Download QR code as image file
 * @param dataURL The data URL of the image
 * @param filename Filename without extension
 */
export function downloadQRImage(dataURL: string, filename: string): void {
	const link = document.createElement('a');
	link.href = dataURL;
	link.download = `${filename}.png`;
	document.body.appendChild(link);
	link.click();
	link.remove();
}
