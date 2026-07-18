import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { getPublicKey, nip19 } from 'nostr-tools';
import { createInviteToken, generateInviteNonce } from '../src/lib/core/invite';

const INVITE_SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const INVITE_SECRET_HEX = Array.from(INVITE_SECRET, (byte) =>
	byte.toString(16).padStart(2, '0')
).join('');

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

	test('fits the first-run experience on a phone viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/');
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
			INVITE_SECRET_HEX
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
