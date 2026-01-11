import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/login');
	});

	test('should display login options', async ({ page }) => {
		await expect(page.getByText('Welcome to Aura')).toBeVisible();
		await expect(page.getByRole('button', { name: /Login with Browser Extension/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /Login with Private Key/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /Generate New Key/i })).toBeVisible();
	});

	test('should show error for invalid private key', async ({ page }) => {
		await page.getByPlaceholder(/Enter your private key/i).fill('invalid-key');
		await page.getByRole('button', { name: /Login with Private Key/i }).click();

		await expect(page.getByText(/Invalid/i)).toBeVisible();
	});

	test('should generate new key', async ({ page }) => {
		await page.getByRole('button', { name: /Generate New Key/i }).click();

		await expect(page.getByText(/Your new private key/i)).toBeVisible();
		await expect(page.getByText(/nsec1/i)).toBeVisible();
		await expect(page.getByText(/IMPORTANT/i)).toBeVisible();
	});

	test('should have copy button for generated key', async ({ page }) => {
		await page.getByRole('button', { name: /Generate New Key/i }).click();

		const copyButton = page.getByRole('button', { name: /copy/i });
		await expect(copyButton).toBeVisible();
	});
});

test.describe('Navigation', () => {
	test('should redirect to login when not authenticated', async ({ page }) => {
		await page.goto('/');
		await expect(page).toHaveURL(/\/login/);
	});

	test('should show AURA branding', async ({ page }) => {
		await page.goto('/login');
		await expect(page.getByText('AURA')).toBeVisible();
	});
});
