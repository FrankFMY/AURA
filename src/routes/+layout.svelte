<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { authStore } from '$stores/auth.svelte';
	import { walletStore } from '$stores/wallet.svelte';
	import { cashuStore } from '$stores/cashu.svelte';
	import { uiStore } from '$stores/ui.svelte';
	import { messagesStore } from '$stores/messages.svelte';
	import { wotStore } from '$stores/wot.svelte';
	import ndkService, { eventPublisher } from '$services/ndk';
	import { analytics } from '$services/analytics';
	import { dbHelpers } from '$db';
	import { browser } from '$app/environment';
	import { setupI18n } from '$lib/i18n';

	// Initialize i18n synchronously before any component renders
	setupI18n();
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Badge } from '$components/ui/badge';
	import { Spinner } from '$components/ui/spinner';
	import { ToastContainer } from '$components/notifications';
	import WelcomeTour from '$lib/components/onboarding/WelcomeTour.svelte';
	import { KeyboardShortcuts } from '$components/ui/keyboard-shortcuts';
	import { CallProvider } from '$components/calls';
	import Home from 'lucide-svelte/icons/home';
	import Search from 'lucide-svelte/icons/search';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Bell from 'lucide-svelte/icons/bell';
	import Wallet from 'lucide-svelte/icons/wallet';
	import Settings from 'lucide-svelte/icons/settings';
	import User from 'lucide-svelte/icons/user';
	import LogOut from 'lucide-svelte/icons/log-out';
	import Zap from 'lucide-svelte/icons/zap';
	import Coins from 'lucide-svelte/icons/coins';
	import Store from 'lucide-svelte/icons/store';
	import Bot from 'lucide-svelte/icons/bot';
	import Bookmark from 'lucide-svelte/icons/bookmark';
	import Users from 'lucide-svelte/icons/users';
	import Menu from 'lucide-svelte/icons/menu';
	import { BottomSheet } from '$components/ui/bottom-sheet';

	let { children } = $props();

	let isInitializing = $state(true);
	let showUserMenu = $state(false);
	let showWelcomeTour = $state(false);
	let showMobileMenu = $state(false);

	// All navigation items (for desktop sidebar)
	const navItems = [
		{ href: '/', icon: Home, label: 'Feed' },
		{ href: '/search', icon: Search, label: 'Search' },
		{ href: '/groups', icon: Users, label: 'Groups' },
		{ href: '/bookmarks', icon: Bookmark, label: 'Saved' },
		{ href: '/marketplace', icon: Store, label: 'Market' },
		{ href: '/ai', icon: Bot, label: 'AI' },
		{ href: '/notifications', icon: Bell, label: 'Alerts' },
		{ href: '/messages', icon: MessageCircle, label: 'Messages' },
		{ href: '/wallet', icon: Wallet, label: 'Wallet' },
		{ href: '/settings', icon: Settings, label: 'Settings' },
	];

	// Primary mobile nav items (5 items that fit comfortably)
	const mobileNavItems = [
		{ href: '/', icon: Home, label: 'Home' },
		{ href: '/search', icon: Search, label: 'Search' },
		{ href: '/messages', icon: MessageCircle, label: 'Messages' },
		{ href: '/notifications', icon: Bell, label: 'Alerts' },
	];

	// Secondary items for "More" menu
	const moreMenuItems = [
		{ href: '/groups', icon: Users, label: 'Groups' },
		{ href: '/bookmarks', icon: Bookmark, label: 'Bookmarks' },
		{ href: '/marketplace', icon: Store, label: 'Marketplace' },
		{ href: '/ai', icon: Bot, label: 'AI Assistant' },
		{ href: '/wallet', icon: Wallet, label: 'Wallet' },
		{ href: '/settings', icon: Settings, label: 'Settings' },
	];

	const currentPath = $derived($page.url.pathname);

	const isActive = (href: string) => {
		if (href === '/') return currentPath === '/';
		return currentPath.startsWith(href);
	};

	// Protected routes that require auth
	// Note: /profile is NOT protected - profiles should be publicly viewable
	const protectedRoutes = ['/messages', '/wallet', '/settings'];
	const isProtectedRoute = $derived(
		protectedRoutes.some((route) => currentPath.startsWith(route)),
	);

	onMount(async () => {
		try {
			// Initialize NDK with timeout
			if (ndkService.connectionStatus === 'disconnected') {
				await ndkService.init();
			}

			// Connect with timeout (don't block UI if relays are slow)
			// Increased from 3s to 5s for better reliability on slower connections
			const connectPromise = ndkService.connect();
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(() => reject(new Error('Connection timeout')), 5000),
			);

			try {
				await Promise.race([connectPromise, timeoutPromise]);
			} catch (e) {
				console.warn('Relay connection slow, continuing anyway:', e);
			}

			// Initialize auth state
			await authStore.init();

			// Initialize analytics (non-blocking)
			void analytics.initialize();

			// Initialize wallet, cashu, WoT and load messages if previously connected
			// Each service is wrapped in try-catch so one failure doesn't block others
			// Services are initialized in parallel for faster startup
			if (authStore.isAuthenticated) {
				// Initialize non-critical services in parallel with individual timeouts
				const initPromises: Promise<void>[] = [];

				// Initialize Lightning wallet (NWC) - non-critical with timeout
				initPromises.push(
					Promise.race([
						walletStore.init(),
						new Promise<void>((_, reject) =>
							setTimeout(() => reject(new Error('Wallet timeout')), 10000)
						)
					]).catch((e) => {
						console.warn('Wallet init failed (non-critical):', e);
						walletStore.clearError(); // Don't show error on Wallet page for auto-init failures
					})
				);

				// Initialize Cashu eCash - non-critical with timeout
				initPromises.push(
					Promise.race([
						cashuStore.init(),
						new Promise<void>((_, reject) =>
							setTimeout(() => reject(new Error('Cashu timeout')), 10000)
						)
					]).catch((e) => {
						console.warn('Cashu init failed (non-critical):', e);
					})
				);

				// Initialize Web of Trust - non-critical with timeout
				initPromises.push(
					Promise.race([
						wotStore.init(),
						new Promise<void>((_, reject) =>
							setTimeout(() => reject(new Error('WoT timeout')), 10000)
						)
					]).catch((e) => {
						console.warn('WoT init failed (non-critical):', e);
					})
				);

				// Wait for all non-critical services (they handle their own errors)
				await Promise.allSettled(initPromises);

				// Load conversations to track unread count
				messagesStore.loadConversations();
			}

			// Check if first-time user
			const welcomeCompleted = await dbHelpers.getSetting<boolean>(
				'welcome_completed',
				false,
			);
			if (!welcomeCompleted && authStore.isAuthenticated) {
				showWelcomeTour = true;
			}

			// Listen for service worker sync messages
			if (browser && navigator.serviceWorker) {
				navigator.serviceWorker.addEventListener(
					'message',
					async (event) => {
						if (event.data?.type === 'SYNC_OUTBOX') {
							const processed =
								await eventPublisher.processOutbox();
							if (processed > 0) {
								console.info(
									`[AURA] Synced ${processed} offline events`,
								);
							}
						}
					},
				);

				// Also sync when coming back online
				window.addEventListener('online', async () => {
					const processed = await eventPublisher.processOutbox();
					if (processed > 0) {
						console.info(
							`[AURA] Synced ${processed} offline events after reconnect`,
						);
					}
				});
			}
		} catch (e) {
			console.error('Initialization failed:', e);
		} finally {
			isInitializing = false;
		}
	});

	// Redirect to login if not authenticated and on protected route
	// Wait for both initialization AND auth loading to complete to avoid race conditions
	$effect(() => {
		if (!isInitializing && !authStore.isLoading && isProtectedRoute && !authStore.isAuthenticated) {
			goto('/login');
		}
	});

	async function handleLogout() {
		await authStore.logout();
		showUserMenu = false;
		goto('/login');
	}

	let lastScrollY = 0;
	function handleScroll() {
		const currentScrollY = window.scrollY;
		if (currentScrollY <= 0) {
			uiStore.setBottomNavVisible(true);
			return;
		}

		if (currentScrollY > lastScrollY && currentScrollY > 50) {
			uiStore.setBottomNavVisible(false);
		} else {
			uiStore.setBottomNavVisible(true);
		}
		lastScrollY = currentScrollY;
	}

	const avatarInitials = $derived(
		(authStore.displayName || 'A').slice(0, 2).toUpperCase(),
	);

	// Show loading state for protected routes while auth is being verified
	const isAuthChecking = $derived(
		isProtectedRoute && (isInitializing || authStore.isLoading)
	);
</script>

<svelte:window onscroll={handleScroll} />

<svelte:head>
	<title>AURA - Decentralized Social</title>
</svelte:head>

{#if isInitializing}
	<div class="flex h-screen items-center justify-center bg-background">
		<div class="flex flex-col items-center gap-4">
			<div class="relative">
				<div
					class="h-16 w-16 animate-pulse rounded-full bg-primary/20"
				></div>
				<Spinner
					size="lg"
					class="absolute inset-0 m-auto"
				/>
			</div>
			<p class="text-muted-foreground">Connecting to Nostr...</p>
		</div>
	</div>
{:else}
	<!-- Toast notifications -->
	<ToastContainer />

	<div class="flex min-h-screen bg-background">
		<!-- Desktop Sidebar -->
		<aside
			class="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-sidebar-border bg-sidebar/95 backdrop-blur-sm md:block"
		>
			<div class="flex h-full flex-col">
				<!-- Logo -->
				<div
					class="flex h-16 items-center gap-3 border-b border-sidebar-border px-6"
				>
					<div
						class="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-primary to-accent shadow-lg shadow-primary/20 animate-pulse-glow"
					>
						<span class="text-lg font-bold text-primary-foreground"
							>A</span
						>
					</div>
					<span class="text-xl font-bold text-gradient-primary"
						>AURA</span
					>
				</div>

				<!-- Navigation -->
				<nav class="flex-1 space-y-1 p-4">
					{#each navItems as item}
						<a
							href={item.href}
							class="group/nav flex items-center gap-3 rounded-lg px-4 py-3 text-sidebar-foreground transition-all duration-200
								{isActive(item.href) ?
								'bg-primary/15 text-primary font-medium border-l-2 border-primary shadow-sm'
							:	'hover:bg-sidebar-accent/60 hover:translate-x-1'}"
						>
							<item.icon
								class="h-5 w-5 transition-transform group-hover/nav:scale-110 {(
									isActive(item.href)
								) ?
									'text-primary'
								:	''}"
							/>
							<span class="flex-1">{item.label}</span>
							{#if item.href === '/messages' && messagesStore.totalUnreadCount > 0}
								<Badge
									variant="default"
									class="text-xs h-5 min-w-5 px-1.5"
								>
									{messagesStore.totalUnreadCount}
								</Badge>
							{/if}
						</a>
					{/each}
				</nav>

				<!-- User section -->
				{#if authStore.isAuthenticated}
					<div class="border-t border-sidebar-border p-4">
						<!-- Wallet status -->
						<div class="mb-4 space-y-2">
							{#if walletStore.isConnected}
								<div
									class="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-success"
								>
									<Zap class="h-4 w-4" />
									<span class="text-sm font-medium">
										{walletStore.formatSats(walletStore.balance)}
									</span>
								</div>
							{/if}
							{#if cashuStore.isConnected && cashuStore.totalBalance > 0}
								<div
									class="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-amber-600 dark:text-amber-400"
								>
									<Coins class="h-4 w-4" />
									<span class="text-sm font-medium">
										{cashuStore.formattedBalance} eCash
									</span>
								</div>
							{/if}
						</div>

						<!-- User profile -->
						<div class="relative">
							<button
								class="flex w-full items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-sidebar-accent"
								onclick={() => (showUserMenu = !showUserMenu)}
							>
								<Avatar size="sm">
									<AvatarImage
										src={authStore.avatar}
										alt={authStore.displayName}
									/>
									<AvatarFallback
										>{avatarInitials}</AvatarFallback
									>
								</Avatar>
								<div class="flex-1 text-left">
									<p
										class="text-sm font-medium text-sidebar-foreground"
									>
										{authStore.displayName}
									</p>
									<p class="text-xs text-muted-foreground">
										{authStore.npub?.slice(0, 12)}...
									</p>
								</div>
							</button>

							{#if showUserMenu}
								<div
									class="absolute bottom-full left-0 mb-2 w-full rounded-lg border border-border bg-popover p-2 shadow-lg"
								>
									<a
										href="/profile/{authStore.pubkey}"
										class="flex items-center gap-2 rounded-md px-3 py-2 text-sm hover:bg-accent"
										onclick={() => (showUserMenu = false)}
									>
										<User class="h-4 w-4" />
										Profile
									</a>
									<button
										class="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-destructive hover:bg-destructive/10"
										onclick={handleLogout}
									>
										<LogOut class="h-4 w-4" />
										Logout
									</button>
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<div class="p-4">
						<Button
							variant="glow"
							class="w-full"
							onclick={() => goto('/login')}
						>
							Login
						</Button>
					</div>
				{/if}
			</div>
		</aside>

		<!-- Main content -->
		<main class="flex-1 min-w-0 w-full">
			{#if isAuthChecking}
				<!-- Show loading while verifying auth for protected routes -->
				<div class="flex h-full min-h-[50vh] items-center justify-center">
					<Spinner size="lg" />
				</div>
			{:else}
				{@render children()}
			{/if}
		</main>

		<!-- Mobile bottom nav -->
		<nav
			class="fixed bottom-0 left-0 right-0 z-50 border-t border-border/50 bg-background/90 backdrop-blur-lg supports-backdrop-filter:bg-background/70 md:hidden safe-area-pb transition-transform duration-300 {(
				uiStore.bottomNavVisible
			) ?
				'translate-y-0'
			:	'translate-y-full'}"
		>
			<div class="flex items-center justify-around py-2 px-1">
				{#each mobileNavItems as item}
					<a
						href={item.href}
						class="group/mobile relative flex flex-col items-center gap-0.5 px-4 py-2 transition-all duration-200 rounded-xl
							{isActive(item.href) ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}"
					>
						{#if isActive(item.href)}
							<span class="absolute inset-0 bg-primary/10 rounded-xl"></span>
						{/if}
						<div class="relative">
							<item.icon
								class="h-5 w-5 transition-transform group-hover/mobile:scale-110 {isActive(item.href) ? 'drop-shadow-[0_0_8px_var(--primary)]' : ''}"
							/>
							{#if item.href === '/messages' && messagesStore.totalUnreadCount > 0}
								<span
									class="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground px-1"
								>
									{messagesStore.totalUnreadCount > 9 ? '9+' : messagesStore.totalUnreadCount}
								</span>
							{/if}
						</div>
						<span class="relative text-[10px] font-medium">{item.label}</span>
					</a>
				{/each}

				<!-- More button -->
				<button
					onclick={() => (showMobileMenu = true)}
					class="group/mobile relative flex flex-col items-center gap-0.5 px-4 py-2 transition-all duration-200 rounded-xl text-muted-foreground hover:text-foreground"
				>
					<Menu class="h-5 w-5 transition-transform group-hover/mobile:scale-110" />
					<span class="relative text-[10px] font-medium">More</span>
				</button>
			</div>
		</nav>

		<!-- Mobile "More" menu bottom sheet -->
		<BottomSheet bind:open={showMobileMenu} title="Menu">
			<div class="space-y-1">
				{#each moreMenuItems as item}
					<a
						href={item.href}
						onclick={() => (showMobileMenu = false)}
						class="flex items-center gap-4 rounded-xl px-4 py-3 transition-colors
							{isActive(item.href) ? 'bg-primary/10 text-primary' : 'hover:bg-accent text-foreground'}"
					>
						<item.icon class="h-5 w-5" />
						<span class="font-medium">{item.label}</span>
					</a>
				{/each}

				<!-- Divider -->
				<div class="my-3 border-t border-border"></div>

				<!-- Profile & Auth section -->
				{#if authStore.isAuthenticated}
					<a
						href="/profile/{authStore.pubkey}"
						onclick={() => (showMobileMenu = false)}
						class="flex items-center gap-4 rounded-xl px-4 py-3 transition-colors hover:bg-accent"
					>
						<Avatar size="sm">
							<AvatarImage src={authStore.avatar} alt={authStore.displayName} />
							<AvatarFallback>{avatarInitials}</AvatarFallback>
						</Avatar>
						<div class="flex-1">
							<p class="font-medium">{authStore.displayName}</p>
							<p class="text-xs text-muted-foreground">{authStore.npub?.slice(0, 16)}...</p>
						</div>
					</a>

					<!-- Wallet info -->
					{#if walletStore.isConnected || (cashuStore.isConnected && cashuStore.totalBalance > 0)}
						<div class="flex gap-2 px-4 py-2">
							{#if walletStore.isConnected}
								<div class="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-success">
									<Zap class="h-4 w-4" />
									<span class="text-sm font-medium">{walletStore.formatSats(walletStore.balance)}</span>
								</div>
							{/if}
							{#if cashuStore.isConnected && cashuStore.totalBalance > 0}
								<div class="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-amber-600 dark:text-amber-400">
									<Coins class="h-4 w-4" />
									<span class="text-sm font-medium">{cashuStore.formattedBalance}</span>
								</div>
							{/if}
						</div>
					{/if}

					<button
						onclick={() => { showMobileMenu = false; handleLogout(); }}
						class="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-destructive transition-colors hover:bg-destructive/10"
					>
						<LogOut class="h-5 w-5" />
						<span class="font-medium">Logout</span>
					</button>
				{:else}
					<a
						href="/login"
						onclick={() => (showMobileMenu = false)}
						class="flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground transition-colors hover:bg-primary/90"
					>
						Login
					</a>
				{/if}
			</div>
		</BottomSheet>
	</div>
{/if}

<!-- Welcome Tour for first-time users -->
{#if showWelcomeTour}
	<WelcomeTour onComplete={() => (showWelcomeTour = false)} />
{/if}

<!-- Global keyboard shortcuts -->
<KeyboardShortcuts />

<!-- Global call handler -->
<CallProvider />
