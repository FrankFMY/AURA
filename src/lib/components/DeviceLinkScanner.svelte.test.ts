// @vitest-environment jsdom
import { fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeviceLinkScanner from './DeviceLinkScanner.svelte';

const mocks = vi.hoisted(() => ({
	scanImage: vi.fn(),
	start: vi.fn(() => new Promise<void>(() => undefined))
}));

vi.mock('$lib/app/qr-scanner', () => ({
	loadQrScanner: async () =>
		class MockQrScanner {
			static scanImage = mocks.scanImage;
			start = mocks.start;
			stop() {}
			destroy() {}
		}
}));

afterEach(() => {
	mocks.scanImage.mockReset();
	vi.unstubAllGlobals();
});

describe('device-link scanner lifecycle', () => {
	it('rejects oversized pasted input before trimming or delivery', async () => {
		const onDetected = vi.fn();
		const onError = vi.fn();
		const view = render(DeviceLinkScanner, {
			onDetected,
			onCancel: vi.fn(),
			onError
		});
		const textarea = view.container.querySelector<HTMLTextAreaElement>('textarea');
		const form = view.container.querySelector<HTMLFormElement>('form');
		expect(textarea).toBeTruthy();
		expect(form).toBeTruthy();
		await fireEvent.input(textarea!, { target: { value: 'x'.repeat(8_193) } });
		await fireEvent.submit(form!);

		expect(onDetected).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledWith(expect.stringMatching(/too long|supported size/i));
		view.unmount();
	});

	it('rejects oversized QR image files before loading the decoder', async () => {
		mocks.scanImage.mockClear();
		const onError = vi.fn();
		const view = render(DeviceLinkScanner, {
			onDetected: vi.fn(),
			onCancel: vi.fn(),
			onError
		});
		const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
		const oversized = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'huge.png', {
			type: 'image/png'
		});
		await fireEvent.change(input!, { target: { files: [oversized] } });
		expect(mocks.scanImage).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledWith(expect.stringMatching(/image.*large|8 MiB/i));
		view.unmount();
	});

	it('decodes camera-roll images into a bounded bitmap and releases it', async () => {
		mocks.scanImage.mockClear();
		mocks.scanImage.mockResolvedValueOnce({ data: 'https://aura.frankfmy.com/link/#token' });
		const bitmap = { width: 2048, height: 2048, close: vi.fn() } as unknown as ImageBitmap;
		const createBitmap = vi.fn().mockResolvedValue(bitmap);
		vi.stubGlobal('createImageBitmap', createBitmap);
		const onDetected = vi.fn();
		const view = render(DeviceLinkScanner, {
			onDetected,
			onCancel: vi.fn(),
			onError: vi.fn()
		});
		const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
		const image = new File([new Uint8Array(2 * 1024 * 1024)], 'camera.jpg', {
			type: 'image/jpeg'
		});
		await fireEvent.change(input!, { target: { files: [image] } });
		await vi.waitFor(() => expect(onDetected).toHaveBeenCalledOnce());
		expect(createBitmap).toHaveBeenCalledWith(
			image,
			expect.objectContaining({ resizeWidth: 2048, resizeHeight: 2048 })
		);
		expect(mocks.scanImage).toHaveBeenCalledWith(
			bitmap,
			expect.objectContaining({ returnDetailedScanResult: true })
		);
		await vi.waitFor(() => expect(bitmap.close).toHaveBeenCalledOnce());
		view.unmount();
		vi.unstubAllGlobals();
	});

	it('suppresses a stale image-decode error after unmount', async () => {
		const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
		vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
		let rejectDecode!: (error: Error) => void;
		mocks.scanImage.mockReturnValueOnce(
			new Promise((_resolve, reject) => {
				rejectDecode = reject;
			})
		);
		const onError = vi.fn();
		const view = render(DeviceLinkScanner, {
			onDetected: vi.fn(),
			onCancel: vi.fn(),
			onError
		});
		const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
		expect(input).toBeTruthy();
		await fireEvent.change(input!, {
			target: { files: [new File(['qr'], 'link.png', { type: 'image/png' })] }
		});
		await vi.waitFor(() => expect(mocks.scanImage).toHaveBeenCalledOnce());
		view.unmount();
		rejectDecode(new Error('stale decode failure'));
		await Promise.resolve();
		await Promise.resolve();

		expect(onError).not.toHaveBeenCalled();
		await vi.waitFor(() => expect(bitmap.close).toHaveBeenCalledOnce());
	});

	it('fails closed without bounded bitmap decoding and never scans the raw file', async () => {
		vi.stubGlobal('createImageBitmap', undefined);
		const onError = vi.fn();
		const view = render(DeviceLinkScanner, {
			onDetected: vi.fn(),
			onCancel: vi.fn(),
			onError
		});
		const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
		await fireEvent.change(input!, {
			target: { files: [new File(['qr'], 'link.png', { type: 'image/png' })] }
		});
		expect(mocks.scanImage).not.toHaveBeenCalled();
		expect(onError).toHaveBeenCalledWith(expect.stringMatching(/cannot safely scan/i));
		view.unmount();
	});
});
