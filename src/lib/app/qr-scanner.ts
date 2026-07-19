import type QrScanner from 'qr-scanner';

export async function loadQrScanner(): Promise<typeof QrScanner> {
	return (await import('qr-scanner')).default;
}
