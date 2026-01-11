/**
 * Internationalization Setup
 * 
 * Provides multi-language support using svelte-i18n.
 */

import { init, register, getLocaleFromNavigator, locale, _ } from 'svelte-i18n';
import { browser } from '$app/environment';

/** Supported locales */
export const SUPPORTED_LOCALES = ['en', 'ru', 'es', 'zh'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

/** Locale display names */
export const LOCALE_NAMES: Record<SupportedLocale, string> = {
	en: 'English',
	ru: 'Русский',
	es: 'Español',
	zh: '中文'
};

/** Default locale */
export const DEFAULT_LOCALE: SupportedLocale = 'en';

/** Storage key for locale preference */
const LOCALE_STORAGE_KEY = 'aura-locale';

/**
 * Register all locales
 */
function registerLocales() {
	register('en', () => import('./locales/en.json'));
	register('ru', () => import('./locales/ru.json'));
	register('es', () => import('./locales/es.json'));
	register('zh', () => import('./locales/zh.json'));
}

/**
 * Get initial locale
 */
function getInitialLocale(): SupportedLocale {
	if (browser) {
		// Check stored preference
		const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
		if (stored && SUPPORTED_LOCALES.includes(stored as SupportedLocale)) {
			return stored as SupportedLocale;
		}

		// Check browser language
		const browserLocale = getLocaleFromNavigator();
		if (browserLocale) {
			const lang = browserLocale.split('-')[0];
			if (SUPPORTED_LOCALES.includes(lang as SupportedLocale)) {
				return lang as SupportedLocale;
			}
		}
	}

	return DEFAULT_LOCALE;
}

/**
 * Initialize i18n
 */
export function setupI18n() {
	registerLocales();

	init({
		fallbackLocale: DEFAULT_LOCALE,
		initialLocale: getInitialLocale()
	});
}

/**
 * Change locale
 */
export function setLocale(newLocale: SupportedLocale) {
	if (!SUPPORTED_LOCALES.includes(newLocale)) {
		console.warn(`Unsupported locale: ${newLocale}`);
		return;
	}

	locale.set(newLocale);

	if (browser) {
		localStorage.setItem(LOCALE_STORAGE_KEY, newLocale);
		document.documentElement.lang = newLocale;

		// Set text direction for RTL languages (none in current set, but future-proof)
		const rtlLocales: string[] = []; // Add 'ar', 'he', etc. if needed
		document.documentElement.dir = rtlLocales.includes(newLocale) ? 'rtl' : 'ltr';
	}
}

/**
 * Get current locale
 */
export function getCurrentLocale(): SupportedLocale {
	let current: SupportedLocale = DEFAULT_LOCALE;
	locale.subscribe((value) => {
		if (value && SUPPORTED_LOCALES.includes(value as SupportedLocale)) {
			current = value as SupportedLocale;
		}
	})();
	return current;
}

// Re-export svelte-i18n utilities
export { _, locale, locales } from 'svelte-i18n';

export default {
	setupI18n,
	setLocale,
	getCurrentLocale,
	SUPPORTED_LOCALES,
	LOCALE_NAMES,
	DEFAULT_LOCALE
};
