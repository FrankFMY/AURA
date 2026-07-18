import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

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
		await expect(page.getByLabel('Display name')).toBeVisible();
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
