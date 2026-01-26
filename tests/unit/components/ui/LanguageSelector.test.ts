/**
 * LanguageSelector Component Tests
 *
 * Tests for language selector dropdown functionality and a11y.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/svelte';

// Mock setLocale function
const mockSetLocale = vi.hoisted(() => vi.fn());

// Mock svelte-i18n BEFORE importing component
vi.mock('svelte-i18n', () => {
	const mockT = (key: string) => key;
	return {
		_: {
			subscribe: (fn: (v: any) => void) => {
				fn(mockT);
				return () => {};
			}
		}
	};
});

// Mock $lib/i18n
vi.mock('$lib/i18n', () => ({
	setLocale: mockSetLocale,
	locale: {
		subscribe: (fn: (v: any) => void) => {
			fn('en');
			return () => {};
		}
	},
	SUPPORTED_LOCALES: ['en', 'ru', 'es', 'zh'],
	LOCALE_NAMES: {
		en: 'English',
		ru: 'Русский',
		es: 'Español',
		zh: '中文'
	}
}));

// Import after mocks
import LanguageSelector from '$lib/components/ui/language-selector/LanguageSelector.svelte';

describe('LanguageSelector.svelte', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it('should render the component', () => {
		render(LanguageSelector);

		// Button should exist
		const button = screen.getByRole('button');
		expect(button).toBeInTheDocument();
	});

	it('should have correct aria attributes on button', () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		expect(button).toHaveAttribute('aria-haspopup', 'menu');
		expect(button).toHaveAttribute('aria-expanded', 'false');
	});

	it('should open menu on button click', async () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		await fireEvent.click(button);

		// Menu should be visible
		const menu = screen.getByRole('menu');
		expect(menu).toBeInTheDocument();
	});

	it('should show all supported locales in menu', async () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		await fireEvent.click(button);

		// All locale options should be visible in menu items
		const menuItems = screen.getAllByRole('menuitem');
		expect(menuItems).toHaveLength(4);

		// Check each locale is present
		expect(screen.getAllByText('English').length).toBeGreaterThanOrEqual(1);
		expect(screen.getByText('Русский')).toBeInTheDocument();
		expect(screen.getByText('Español')).toBeInTheDocument();
		expect(screen.getByText('中文')).toBeInTheDocument();
	});

	it('should have menuitem role for options', async () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		await fireEvent.click(button);

		const menuItems = screen.getAllByRole('menuitem');
		expect(menuItems).toHaveLength(4);
	});

	it('should call setLocale when option is clicked', async () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		await fireEvent.click(button);

		const russianOption = screen.getByText('Русский');
		await fireEvent.click(russianOption);

		expect(mockSetLocale).toHaveBeenCalledWith('ru');
	});

	it('should close menu after selection', async () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		await fireEvent.click(button);

		expect(screen.getByRole('menu')).toBeInTheDocument();

		const option = screen.getByText('Español');
		await fireEvent.click(option);

		// Menu should be closed
		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
	});

	it('should close menu on Escape key', async () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		await fireEvent.click(button);

		expect(screen.getByRole('menu')).toBeInTheDocument();

		// Find the menu container and trigger keydown
		const menuContainer = screen.getByRole('menu').parentElement;
		await fireEvent.keyDown(menuContainer!, { key: 'Escape' });

		expect(screen.queryByRole('menu')).not.toBeInTheDocument();
	});

	it('should navigate with ArrowDown key', async () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		await fireEvent.click(button);

		const menuContainer = screen.getByRole('menu').parentElement;

		// Press ArrowDown
		await fireEvent.keyDown(menuContainer!, { key: 'ArrowDown' });

		// Focus should move to next item
		const menuItems = screen.getAllByRole('menuitem');
		// Second item should now have tabindex=0
		expect(menuItems[1]).toHaveAttribute('tabindex', '0');
	});

	it('should navigate with ArrowUp key', async () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		await fireEvent.click(button);

		const menuContainer = screen.getByRole('menu').parentElement;

		// Press ArrowUp (wraps to last item)
		await fireEvent.keyDown(menuContainer!, { key: 'ArrowUp' });

		const menuItems = screen.getAllByRole('menuitem');
		// Last item should now have tabindex=0
		expect(menuItems[3]).toHaveAttribute('tabindex', '0');
	});

	it('should select option with Enter key', async () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		await fireEvent.click(button);

		const menuContainer = screen.getByRole('menu').parentElement;

		// Navigate to second option
		await fireEvent.keyDown(menuContainer!, { key: 'ArrowDown' });
		// Select with Enter
		await fireEvent.keyDown(menuContainer!, { key: 'Enter' });

		expect(mockSetLocale).toHaveBeenCalledWith('ru');
	});

	it('should select option with Space key', async () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		await fireEvent.click(button);

		const menuContainer = screen.getByRole('menu').parentElement;

		// Navigate to third option
		await fireEvent.keyDown(menuContainer!, { key: 'ArrowDown' });
		await fireEvent.keyDown(menuContainer!, { key: 'ArrowDown' });
		// Select with Space
		await fireEvent.keyDown(menuContainer!, { key: ' ' });

		expect(mockSetLocale).toHaveBeenCalledWith('es');
	});

	it('should wrap navigation at boundaries', async () => {
		render(LanguageSelector);

		const button = screen.getByRole('button');
		await fireEvent.click(button);

		const menuContainer = screen.getByRole('menu').parentElement;

		// Press ArrowDown 4 times (wrap around)
		for (let i = 0; i < 4; i++) {
			await fireEvent.keyDown(menuContainer!, { key: 'ArrowDown' });
		}

		// Should be back at first item
		const menuItems = screen.getAllByRole('menuitem');
		expect(menuItems[0]).toHaveAttribute('tabindex', '0');
	});
});
