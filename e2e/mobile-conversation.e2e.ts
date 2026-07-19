import { randomBytes } from 'node:crypto';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { schnorr } from '@noble/curves/secp256k1.js';
import { createInviteToken, type InvitePayload } from '../src/lib/core/invite';

const ORIGIN = 'http://127.0.0.1:4173';
const INVITER_TEST_KEY = randomBytes(32).toString('hex');

function hexToBytes(value: string): Uint8Array {
	return Uint8Array.from(value.match(/.{2}/gu) ?? [], (pair) => Number.parseInt(pair, 16));
}

function bytesToHex(value: Uint8Array): string {
	return Array.from(value, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function invitationToken(): string {
	const now = Math.floor(Date.now() / 1000);
	const payload: InvitePayload = {
		v: 1,
		action: 'dm',
		origin: ORIGIN,
		issuer_pubkey: bytesToHex(schnorr.getPublicKey(hexToBytes(INVITER_TEST_KEY))),
		issued_at: now - 30,
		expires_at: now + 3600,
		nonce: 'AQIDBAUGBwgJCgsMDQ4PEA',
		relay_hints: ['wss://relay.invalid'],
		display: { name: 'Offline fixture' }
	};
	return createInviteToken(payload, hexToBytes(INVITER_TEST_KEY));
}

async function installOfflineWebAuthn(page: Page): Promise<void> {
	await page.routeWebSocket(/.*/u, (webSocket) => webSocket.close());
	await page.addInitScript(() => {
		const credentialId = new Uint8Array(32).fill(7);
		const prfOutput = new Uint8Array(32).fill(19);
		const credential = {
			id: 'aura-e2e-passkey',
			rawId: credentialId.buffer,
			type: 'public-key',
			authenticatorAttachment: 'platform',
			response: {},
			getClientExtensionResults: () => ({
				prf: { enabled: true, results: { first: prfOutput.buffer } }
			}),
			toJSON: () => ({})
		};
		class MockPublicKeyCredential {
			static async isUserVerifyingPlatformAuthenticatorAvailable(): Promise<boolean> {
				return true;
			}
		}
		Object.defineProperty(window, 'PublicKeyCredential', {
			configurable: true,
			value: MockPublicKeyCredential
		});
		Object.defineProperty(navigator, 'credentials', {
			configurable: true,
			value: {
				create: async () => credential,
				get: async () => credential
			}
		});
	});
}

async function installControllableVisualViewport(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const viewport = new EventTarget();
		const state = { height: window.innerHeight, offsetTop: 0, manual: false };
		window.addEventListener('resize', () => {
			if (!state.manual) state.height = window.innerHeight;
		});
		Object.defineProperties(viewport, {
			height: { configurable: true, get: () => state.height },
			offsetTop: { configurable: true, get: () => state.offsetTop },
			width: { configurable: true, get: () => window.innerWidth },
			offsetLeft: { configurable: true, get: () => 0 },
			pageLeft: { configurable: true, get: () => 0 },
			pageTop: { configurable: true, get: () => state.offsetTop },
			scale: { configurable: true, get: () => 1 }
		});
		Object.defineProperty(window, 'visualViewport', {
			configurable: true,
			value: viewport
		});
		Object.defineProperty(window, '__setAuraVisualViewport', {
			configurable: true,
			value: (height: number, offsetTop: number) => {
				state.manual = true;
				state.height = height;
				state.offsetTop = offsetTop;
				viewport.dispatchEvent(new Event('resize'));
				viewport.dispatchEvent(new Event('scroll'));
			}
		});
	});
}

async function createOfflineProfile(page: Page): Promise<void> {
	await page.goto(`/i/#${invitationToken()}`);
	await page.getByRole('button', { name: /Create secure profile/i }).click();
	await page.getByLabel('Display name').fill('Mobile fixture');
	await page.getByRole('button', { name: /Continue with Passkey/i }).click();
	await expect(page.getByRole('heading', { name: /Save your Recovery Code/i })).toBeVisible();

	const words = await page.locator('.word-grid li').allTextContents();
	for (const index of [3, 11, 20]) {
		const word = words[index]?.replace(/^\s*\d+\s*/u, '').trim();
		if (!word) throw new Error(`Recovery word ${index + 1} is missing`);
		await page.getByLabel(`Word ${index + 1}`).fill(word);
	}
	await page.getByRole('button', { name: /I saved it safely/i }).click();
	await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible({
		timeout: 15_000
	});
}

test.describe('mobile conversation', () => {
	test.use({ hasTouch: true, isMobile: true });

	test('keeps mobile composition multiline, focused, and inside the visible shell', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await installOfflineWebAuthn(page);
		await installControllableVisualViewport(page);
		await createOfflineProfile(page);

		const accessibility = await new AxeBuilder({ page }).analyze();
		const blockingViolations = accessibility.violations.filter((violation) =>
			['serious', 'critical'].includes(violation.impact ?? '')
		);
		expect(blockingViolations).toEqual([]);

		const composer = page.getByRole('textbox', { name: 'Message', exact: true });
		await composer.fill('first line');
		await composer.press('Enter');
		await composer.type('second line\nthird line\nfourth line\nfifth line');
		expect(await composer.inputValue()).toContain('first line\nsecond line');

		const geometry = await composer.evaluate((element) => {
			const rectangle = element.getBoundingClientRect();
			return { height: rectangle.height, overflowY: getComputedStyle(element).overflowY };
		});
		expect(geometry.height).toBeGreaterThan(44);
		expect(geometry.height).toBeLessThanOrEqual(144);
		expect(geometry.overflowY).toBe('hidden');

		const imePrevented = await composer.evaluate((element) => {
			const event = new KeyboardEvent('keydown', {
				key: 'Enter',
				bubbles: true,
				cancelable: true,
				isComposing: true
			});
			element.dispatchEvent(event);
			return event.defaultPrevented;
		});
		expect(imePrevented).toBe(false);

		const draftBeforeRemount = await composer.inputValue();
		await page.getByRole('button', { name: 'Back to chats' }).click();
		await page.getByRole('button', { name: 'Start a conversation' }).click();
		await page.getByRole('button', { name: /Open conversation/i }).click();
		await expect(composer).toHaveValue(draftBeforeRemount);
		const reopenedHeight = await composer.evaluate(
			(element) => element.getBoundingClientRect().height
		);
		expect(reopenedHeight).toBeGreaterThan(44);

		await composer.focus();
		const send = page.getByRole('button', { name: 'Send message' });
		const sendBox = await send.boundingBox();
		if (!sendBox) throw new Error('Send button has no layout box');
		await page.mouse.move(sendBox.x + sendBox.width / 2, sendBox.y + sendBox.height / 2);
		await page.mouse.down();
		await expect(composer).toBeFocused();
		await page.mouse.move(0, 0);
		await page.mouse.up();

		for (const viewport of [
			{ width: 390, height: 844 },
			{ width: 412, height: 915 },
			{ width: 320, height: 640 }
		]) {
			await page.setViewportSize(viewport);
			await page.waitForFunction(
				(expectedHeight) =>
					document.documentElement.style.getPropertyValue('--aura-viewport-height') ===
					`${expectedHeight}px`,
				viewport.height
			);
			const layout = await page.evaluate(() => {
				const rail = document.querySelector<HTMLElement>('.rail');
				const shell = document.querySelector<HTMLElement>('.app-shell')!.getBoundingClientRect();
				const pane = document
					.querySelector<HTMLElement>('.conversation-pane')!
					.getBoundingClientRect();
				const form = document.querySelector<HTMLElement>('.composer')!.getBoundingClientRect();
				const back = document.querySelector<HTMLElement>('.mobile-back')!.getBoundingClientRect();
				return {
					railPresent: rail !== null,
					shellHeight: shell.height,
					paneBottom: pane.bottom,
					composerBottom: form.bottom,
					backWidth: back.width,
					backHeight: back.height,
					documentWidth: document.documentElement.scrollWidth
				};
			});
			expect(layout.railPresent).toBe(false);
			expect(layout.shellHeight).toBeLessThanOrEqual(viewport.height);
			expect(layout.paneBottom - layout.composerBottom).toBeLessThanOrEqual(16);
			expect(layout.backWidth).toBeGreaterThanOrEqual(44);
			expect(layout.backHeight).toBeGreaterThanOrEqual(44);
			expect(layout.documentWidth).toBeLessThanOrEqual(viewport.width);
		}

		await page.setViewportSize({ width: 720, height: 800 });
		await expect(composer).toHaveAttribute('enterkeyhint', 'send');
		const remountDraft = await composer.inputValue();
		const remountHeight = await composer.evaluate(
			(element) => element.getBoundingClientRect().height
		);
		expect(remountHeight).toBeGreaterThan(60);
		await page.getByRole('button', { name: 'Profile' }).click();
		await page.getByRole('button', { name: 'Chats' }).click();
		await expect(composer).toHaveValue(remountDraft);
		expect(
			await composer.evaluate((element) => element.getBoundingClientRect().height)
		).toBeGreaterThanOrEqual(remountHeight - 1);
		const primaryNavigation = page.getByRole('navigation', { name: 'Primary navigation' });
		await primaryNavigation.getByRole('button', { name: 'New chat' }).click();
		await primaryNavigation.getByRole('button', { name: 'Chats' }).click();
		await expect(composer).toHaveValue(remountDraft);
		expect(
			await composer.evaluate((element) => element.getBoundingClientRect().height)
		).toBeGreaterThanOrEqual(remountHeight - 1);

		await page.setViewportSize({ width: 390, height: 844 });
		await expect(composer).toHaveAttribute('enterkeyhint', 'enter');
		await composer.fill('offline send activation probe');
		await page.evaluate(() => {
			document.querySelector('form.composer')?.addEventListener(
				'submit',
				() => {
					document.body.dataset.composerSubmitted = 'true';
				},
				{ capture: true }
			);
		});
		const touchBox = await send.boundingBox();
		if (!touchBox) throw new Error('Send button has no touch layout box');
		await page.touchscreen.tap(touchBox.x + touchBox.width / 2, touchBox.y + touchBox.height / 2);
		await expect
			.poll(() => page.evaluate(() => document.body.dataset.composerSubmitted))
			.toBe('true');
		await expect(composer).toBeFocused();

		await page.evaluate(() => {
			(
				window as typeof window & {
					__setAuraVisualViewport: (height: number, offsetTop: number) => void;
				}
			).__setAuraVisualViewport(480, 120);
		});
		await page.waitForFunction(
			() =>
				document.documentElement.style.getPropertyValue('--aura-viewport-height') === '480px' &&
				document.documentElement.style.getPropertyValue('--aura-viewport-top') === '120px'
		);
		const keyboardLayout = await page.evaluate(() => {
			const shell = document.querySelector<HTMLElement>('.app-shell')!.getBoundingClientRect();
			const pane = document
				.querySelector<HTMLElement>('.conversation-pane')!
				.getBoundingClientRect();
			const composerForm = document
				.querySelector<HTMLElement>('form.composer')!
				.getBoundingClientRect();
			const viewport = window.visualViewport!;
			return {
				shellTop: shell.top,
				shellHeight: shell.height,
				paneTop: pane.top,
				paneBottom: pane.bottom,
				viewportBottom: viewport.offsetTop + viewport.height,
				composerBottom: composerForm.bottom,
				railPresent: document.querySelector('.rail') !== null,
				keyboardOpen: document.documentElement.hasAttribute('data-aura-keyboard-open'),
				documentWidth: document.documentElement.scrollWidth
			};
		});
		expect(keyboardLayout.shellTop).toBeGreaterThanOrEqual(119);
		expect(keyboardLayout.shellTop).toBeLessThanOrEqual(121);
		expect(keyboardLayout.shellHeight).toBeLessThanOrEqual(480);
		expect(keyboardLayout.paneTop).toBeGreaterThanOrEqual(119);
		expect(keyboardLayout.paneTop).toBeLessThanOrEqual(121);
		expect(keyboardLayout.paneBottom).toBeGreaterThanOrEqual(599);
		expect(keyboardLayout.paneBottom).toBeLessThanOrEqual(601);
		expect(keyboardLayout.viewportBottom - keyboardLayout.composerBottom).toBeGreaterThanOrEqual(0);
		expect(keyboardLayout.viewportBottom - keyboardLayout.composerBottom).toBeLessThanOrEqual(16);
		expect(keyboardLayout.railPresent).toBe(false);
		expect(keyboardLayout.keyboardOpen).toBe(true);
		expect(keyboardLayout.documentWidth).toBeLessThanOrEqual(390);
		await expect(composer).toBeFocused();

		await page.evaluate(() => {
			(
				window as typeof window & {
					__setAuraVisualViewport: (height: number, offsetTop: number) => void;
				}
			).__setAuraVisualViewport(414, 0);
		});
		await page.waitForFunction(
			() =>
				document.documentElement.style.getPropertyValue('--aura-viewport-height') === '414px' &&
				document.documentElement.style.getPropertyValue('--aura-viewport-top') === '0px'
		);
		const safariKeyboardLayout = await page.evaluate(() => {
			const pane = document
				.querySelector<HTMLElement>('.conversation-pane')!
				.getBoundingClientRect();
			const form = document.querySelector<HTMLElement>('form.composer')!.getBoundingClientRect();
			const header = document
				.querySelector<HTMLElement>('.conversation-header')!
				.getBoundingClientRect();
			return {
				paneTop: pane.top,
				paneBottom: pane.bottom,
				headerTop: header.top,
				composerBottom: form.bottom,
				railPresent: document.querySelector('.rail') !== null
			};
		});
		expect(safariKeyboardLayout.paneTop).toBeGreaterThanOrEqual(0);
		expect(safariKeyboardLayout.paneTop).toBeLessThanOrEqual(1);
		expect(safariKeyboardLayout.paneBottom).toBeGreaterThanOrEqual(413);
		expect(safariKeyboardLayout.paneBottom).toBeLessThanOrEqual(415);
		expect(safariKeyboardLayout.headerTop).toBeGreaterThanOrEqual(0);
		expect(414 - safariKeyboardLayout.composerBottom).toBeGreaterThanOrEqual(0);
		expect(414 - safariKeyboardLayout.composerBottom).toBeLessThanOrEqual(16);
		expect(safariKeyboardLayout.railPresent).toBe(false);

		await page.getByRole('button', { name: 'Back to chats' }).click();
		await page.getByRole('button', { name: 'Profile' }).click();
		const pageErrors: string[] = [];
		page.on('pageerror', (cause) => pageErrors.push(cause.message));
		await page.evaluate(() => {
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: { writeText: () => Promise.reject('clipboard denied') }
			});
		});
		await page.getByRole('button', { name: 'Copy npub' }).click();
		await expect(page.getByRole('alert')).toContainText('The identity could not be copied.');
		expect(pageErrors).toEqual([]);

		await page.evaluate(() => {
			let release!: () => void;
			Object.defineProperty(window, '__releaseAuraClipboard', {
				configurable: true,
				value: () => release()
			});
			Object.defineProperty(navigator, 'clipboard', {
				configurable: true,
				value: {
					writeText: () => {
						document.body.dataset.clipboardPending = 'true';
						return new Promise<void>((resolve) => {
							release = resolve;
						});
					}
				}
			});
		});
		await page.getByRole('button', { name: 'Copy npub' }).click();
		await expect
			.poll(() => page.evaluate(() => document.body.dataset.clipboardPending))
			.toBe('true');
		await page.getByRole('button', { name: 'Lock profile' }).click();
		await page.evaluate(() => {
			(window as typeof window & { __releaseAuraClipboard: () => void }).__releaseAuraClipboard();
		});
		await expect(page.getByRole('button', { name: 'Unlock with device' })).toBeVisible();
		await expect(page.getByText('Copied identity', { exact: true })).toHaveCount(0);
		await expect(page.getByText('Latest invitation', { exact: true })).toHaveCount(0);
		await page.waitForTimeout(50);
		expect(pageErrors).toEqual([]);
	});
});
