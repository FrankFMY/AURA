import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { getPublicKey, nip19 } from 'nostr-tools';
import { createInviteToken, generateInviteNonce } from '../src/lib/core/invite';

const INVITE_SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1);

test.describe('public shell', () => {
	test('renders a calm first-run landing and opens secure profile creation', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveTitle('AURA — private conversations');
		await expect(page.getByRole('heading', { name: /Your people/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /Create secure profile/i })).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await page.getByRole('button', { name: /Create secure profile/i }).click();
		await expect(page.getByRole('heading', { name: /How should people know you/i })).toBeVisible();
		const displayName = page.getByLabel('Display name');
		await expect(displayName).toBeVisible();
		await expect(displayName).toBeFocused();
		await expect(displayName).toHaveAttribute('required', '');
		await expect(page.locator('form').filter({ has: displayName })).toHaveCount(1);
	});

	test('prevents onboarding navigation while credential persistence is in flight', async ({
		page
	}) => {
		await page.addInitScript(() => {
			class PendingPublicKeyCredential {
				static async isUserVerifyingPlatformAuthenticatorAvailable() {
					return true;
				}
			}
			Object.defineProperty(globalThis, 'PublicKeyCredential', {
				configurable: true,
				value: PendingPublicKeyCredential
			});
			Object.defineProperty(navigator, 'credentials', {
				configurable: true,
				value: {
					create: () => new Promise(() => undefined),
					get: () => new Promise(() => undefined)
				}
			});
		});
		await page.goto('/');
		await page.getByRole('button', { name: /Create secure profile/i }).click();
		await page.getByLabel('Display name').fill('Pending profile');
		await page.getByRole('button', { name: /Continue with Passkey/i }).click();

		await expect(page.getByRole('button', { name: /Waiting for your device/i })).toBeDisabled();
		await expect(page.getByRole('button', { name: /Go back/i })).toBeDisabled();
	});

	test('fits the first-run experience on a phone viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/');
		await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
			'content',
			/viewport-fit=cover.*interactive-widget=resizes-content/u
		);
		await expect(page.getByRole('button', { name: /Create secure profile/i })).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
		await page.getByRole('button', { name: /I have a Recovery Code/i }).click();
		await expect(page.getByRole('heading', { name: /Bring your identity back/i })).toBeVisible();
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
	});

	test('applies the full-screen viewport CSS contract to a mobile conversation', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/');
		const layout = await page.evaluate(() => {
			document.documentElement.style.setProperty('--aura-viewport-height', '600px');
			document.documentElement.style.setProperty('--aura-viewport-top', '20px');
			const shellFixture = document.createElement('main');
			shellFixture.className = 'app-shell conversation-open';
			const railFixture = document.createElement('aside');
			railFixture.className = 'rail';
			const chatListFixture = document.createElement('section');
			chatListFixture.className = 'chat-list-pane hidden-mobile';
			const paneFixture = document.createElement('section');
			paneFixture.className = 'conversation-pane';
			const headerFixture = document.createElement('header');
			headerFixture.className = 'conversation-header';
			const backFixture = document.createElement('button');
			backFixture.className = 'mobile-back';
			backFixture.textContent = 'Back';
			headerFixture.append(backFixture);
			const messageFixture = document.createElement('div');
			messageFixture.className = 'message-space';
			const tallMessageContent = document.createElement('div');
			tallMessageContent.style.height = '1200px';
			messageFixture.append(tallMessageContent);
			const newMessageFixture = document.createElement('button');
			newMessageFixture.className = 'new-message-chip';
			newMessageFixture.textContent = '1 new message';
			const composerFixture = document.createElement('form');
			composerFixture.className = 'composer';
			const textareaFixture = document.createElement('textarea');
			textareaFixture.rows = 1;
			textareaFixture.style.height = '144px';
			const sendFixture = document.createElement('button');
			sendFixture.textContent = 'Send';
			composerFixture.append(textareaFixture, sendFixture);
			paneFixture.append(headerFixture, messageFixture, newMessageFixture, composerFixture);
			shellFixture.append(railFixture, chatListFixture, paneFixture);
			document.body.replaceChildren(shellFixture);
			const shell = document.querySelector<HTMLElement>('.app-shell')!;
			const pane = document.querySelector<HTMLElement>('.conversation-pane')!;
			const rail = document.querySelector<HTMLElement>('.rail')!;
			const back = document.querySelector<HTMLElement>('.mobile-back')!;
			const composer = document.querySelector<HTMLElement>('.composer')!;
			const shellRect = shell.getBoundingClientRect();
			const paneRect = pane.getBoundingClientRect();
			const backRect = back.getBoundingClientRect();
			const composerRect = composer.getBoundingClientRect();
			const headerRect = document
				.querySelector<HTMLElement>('.conversation-header')!
				.getBoundingClientRect();
			const messageArea = document.querySelector<HTMLElement>('.message-space')!;
			const messageRect = messageArea.getBoundingClientRect();
			const chipRect = document
				.querySelector<HTMLElement>('.new-message-chip')!
				.getBoundingClientRect();
			return {
				shellTop: shellRect.top,
				shellHeight: shellRect.height,
				paneBottom: paneRect.bottom,
				composerBottom: composerRect.bottom,
				composerTop: composerRect.top,
				headerBottom: headerRect.bottom,
				messageTop: messageRect.top,
				messageBottom: messageRect.bottom,
				messageClientHeight: messageArea.clientHeight,
				messageScrollHeight: messageArea.scrollHeight,
				chipTop: chipRect.top,
				chipBottom: chipRect.bottom,
				railDisplay: getComputedStyle(rail).display,
				backWidth: backRect.width,
				backHeight: backRect.height
			};
		});

		expect(layout.shellTop).toBe(20);
		expect(layout.shellHeight).toBe(600);
		expect(layout.railDisplay).toBe('none');
		expect(layout.backWidth).toBeGreaterThanOrEqual(44);
		expect(layout.backHeight).toBeGreaterThanOrEqual(44);
		expect(layout.paneBottom - layout.composerBottom).toBeLessThanOrEqual(16);
		expect(layout.messageTop).toBeGreaterThanOrEqual(layout.headerBottom);
		expect(layout.messageScrollHeight).toBeGreaterThan(layout.messageClientHeight);
		expect(layout.chipTop).toBeGreaterThanOrEqual(layout.messageTop);
		expect(layout.chipBottom).toBeLessThanOrEqual(layout.messageBottom);
		expect(layout.chipBottom).toBeLessThanOrEqual(layout.composerTop - 8);
	});

	test('keeps an invite fragment out of all HTTP requests', async ({ page }) => {
		const requested: string[] = [];
		page.on('request', (request) => requested.push(request.url()));
		const secretFragment = 'not-a-valid-secret-token';
		await page.goto(`/i/#${secretFragment}`);
		await expect(page.getByRole('heading', { name: /invitation cannot be opened/i })).toBeVisible();
		expect(requested.some((url) => url.includes(secretFragment))).toBe(false);
		expect(await page.evaluate(() => location.hash)).toBe('');
	});

	test('opens a signed invitation without treating its display name as verified identity', async ({
		page
	}) => {
		const now = Math.floor(Date.now() / 1000);
		await page.setViewportSize({ width: 390, height: 844 });
		const pubkey = getPublicKey(INVITE_SECRET);
		const token = createInviteToken(
			{
				v: 1,
				action: 'dm',
				origin: 'http://127.0.0.1:4173',
				issuer_pubkey: pubkey,
				display: { name: 'Production smoke' },
				relay_hints: ['wss://nos.lol/'],
				issued_at: now - 1,
				expires_at: now + 300,
				nonce: generateInviteNonce()
			},
			INVITE_SECRET
		);
		await page.goto(`/i/#${token}`);
		await expect(
			page.getByRole('heading', { name: /self-declared.*Production smoke/i })
		).toBeVisible();
		await expect(page.getByText(nip19.npubEncode(pubkey), { exact: true })).toBeVisible();
		expect(await page.evaluate(() => location.hash)).toBe('');
		expect(
			await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
		).toBe(true);
	});

	test('has no serious or critical automated accessibility violations', async ({ page }) => {
		await page.goto('/');
		let results = await new AxeBuilder({ page }).analyze();
		expect(
			results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
		).toEqual([]);

		await page.getByRole('button', { name: /I have a Recovery Code/i }).click();
		results = await new AxeBuilder({ page }).analyze();
		expect(
			results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')
		).toEqual([]);
	});
});
