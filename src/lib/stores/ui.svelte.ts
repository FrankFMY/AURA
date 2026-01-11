/**
 * UI Store
 * 
 * Global UI state management including theme, modals, and navigation state.
 */

import { browser } from '$app/environment';

/** Modal types */
export type ModalType = 
	| 'compose'
	| 'reply'
	| 'zap'
	| 'profile-edit'
	| 'relay-add'
	| 'wallet-connect'
	| 'image-viewer'
	| 'confirm'
	| null;

/** Theme options */
export type Theme = 'light' | 'dark' | 'system';

/** UI breakpoints */
export type Breakpoint = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';

/** Modal context data */
export interface ModalContext {
	type: ModalType;
	data?: unknown;
	onConfirm?: () => void | Promise<void>;
	onCancel?: () => void;
}

/** Create UI store */
function createUIStore() {
	// State
	let theme = $state<Theme>('system');
	let resolvedTheme = $state<'light' | 'dark'>('dark');
	let sidebarOpen = $state(true);
	let mobileSidebarOpen = $state(false);
	let modal = $state<ModalContext>({ type: null });
	let searchOpen = $state(false);
	let commandPaletteOpen = $state(false);
	let bottomNavVisible = $state(true);
	let isOnline = $state(browser ? navigator.onLine : true);
	let isReducedMotion = $state(false);
	let breakpoint = $state<Breakpoint>('lg');

	// Initialize from localStorage and system preferences
	if (browser) {
		// Theme
		const savedTheme = localStorage.getItem('aura-theme') as Theme | null;
		if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
			theme = savedTheme;
		}

		// Sidebar
		const savedSidebar = localStorage.getItem('aura-sidebar');
		if (savedSidebar !== null) {
			sidebarOpen = savedSidebar === 'true';
		}

		// Resolve theme
		updateResolvedTheme();

		// Listen for system theme changes
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		mediaQuery.addEventListener('change', () => {
			if (theme === 'system') {
				updateResolvedTheme();
			}
		});

		// Listen for reduced motion preference
		const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
		isReducedMotion = motionQuery.matches;
		motionQuery.addEventListener('change', (e) => {
			isReducedMotion = e.matches;
		});

		// Listen for online/offline
		window.addEventListener('online', () => {
			isOnline = true;
		});
		window.addEventListener('offline', () => {
			isOnline = false;
		});

		// Listen for resize
		updateBreakpoint();
		window.addEventListener('resize', updateBreakpoint);
	}

	function updateResolvedTheme() {
		if (theme === 'system') {
			const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
			resolvedTheme = prefersDark ? 'dark' : 'light';
		} else {
			resolvedTheme = theme;
		}

		// Apply to document
		if (browser) {
			document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
		}
	}

	function updateBreakpoint() {
		if (!browser) return;

		const width = window.innerWidth;
		if (width < 640) breakpoint = 'xs';
		else if (width < 768) breakpoint = 'sm';
		else if (width < 1024) breakpoint = 'md';
		else if (width < 1280) breakpoint = 'lg';
		else if (width < 1536) breakpoint = 'xl';
		else breakpoint = '2xl';
	}

	/** Set theme */
	function setTheme(newTheme: Theme) {
		theme = newTheme;
		if (browser) {
			localStorage.setItem('aura-theme', newTheme);
		}
		updateResolvedTheme();
	}

	/** Toggle theme between light and dark */
	function toggleTheme() {
		const newTheme = resolvedTheme === 'dark' ? 'light' : 'dark';
		setTheme(newTheme);
	}

	/** Toggle sidebar */
	function toggleSidebar() {
		sidebarOpen = !sidebarOpen;
		if (browser) {
			localStorage.setItem('aura-sidebar', String(sidebarOpen));
		}
	}

	/** Toggle mobile sidebar */
	function toggleMobileSidebar() {
		mobileSidebarOpen = !mobileSidebarOpen;
	}

	/** Open modal */
	function openModal(type: NonNullable<ModalType>, data?: unknown, options?: {
		onConfirm?: () => void | Promise<void>;
		onCancel?: () => void;
	}) {
		modal = {
			type,
			data,
			onConfirm: options?.onConfirm,
			onCancel: options?.onCancel
		};
	}

	/** Close modal */
	function closeModal() {
		modal.onCancel?.();
		modal = { type: null };
	}

	/** Confirm modal action */
	async function confirmModal() {
		await modal.onConfirm?.();
		modal = { type: null };
	}

	/** Open search */
	function openSearch() {
		searchOpen = true;
	}

	/** Close search */
	function closeSearch() {
		searchOpen = false;
	}

	/** Toggle command palette */
	function toggleCommandPalette() {
		commandPaletteOpen = !commandPaletteOpen;
	}

	/** Set bottom nav visibility */
	function setBottomNavVisible(visible: boolean) {
		bottomNavVisible = visible;
	}

	/** Check if device is mobile */
	const isMobile = $derived(['xs', 'sm'].includes(breakpoint));

	/** Check if device is tablet */
	const isTablet = $derived(breakpoint === 'md');

	/** Check if device is desktop */
	const isDesktop = $derived(['lg', 'xl', '2xl'].includes(breakpoint));

	return {
		// State (readonly)
		get theme() { return theme; },
		get resolvedTheme() { return resolvedTheme; },
		get sidebarOpen() { return sidebarOpen; },
		get mobileSidebarOpen() { return mobileSidebarOpen; },
		get modal() { return modal; },
		get searchOpen() { return searchOpen; },
		get commandPaletteOpen() { return commandPaletteOpen; },
		get bottomNavVisible() { return bottomNavVisible; },
		get isOnline() { return isOnline; },
		get isReducedMotion() { return isReducedMotion; },
		get breakpoint() { return breakpoint; },
		get isMobile() { return isMobile; },
		get isTablet() { return isTablet; },
		get isDesktop() { return isDesktop; },

		// Actions
		setTheme,
		toggleTheme,
		toggleSidebar,
		toggleMobileSidebar,
		openModal,
		closeModal,
		confirmModal,
		openSearch,
		closeSearch,
		toggleCommandPalette,
		setBottomNavVisible
	};
}

/** UI store singleton */
export const uiStore = createUIStore();

export default uiStore;
