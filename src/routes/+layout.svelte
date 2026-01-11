<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { authStore } from '$stores/auth.svelte';
	import { walletStore } from '$stores/wallet.svelte';
	import ndkService, { eventPublisher } from '$services/ndk';
	import { dbHelpers } from '$db';
	import { browser } from '$app/environment';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Badge } from '$components/ui/badge';
	import { Spinner } from '$components/ui/spinner';
	import { ToastContainer } from '$components/notifications';
	import WelcomeTour from '$lib/components/onboarding/WelcomeTour.svelte';
	import { KeyboardShortcuts } from '$components/ui/keyboard-shortcuts';
	import Home from 'lucide-svelte/icons/home';
	import Search from 'lucide-svelte/icons/search';
	import MessageCircle from 'lucide-svelte/icons/message-circle';
	import Bell from 'lucide-svelte/icons/bell';
	import Wallet from 'lucide-svelte/icons/wallet';
	import Settings from 'lucide-svelte/icons/settings';
	import User from 'lucide-svelte/icons/user';
	import LogOut from 'lucide-svelte/icons/log-out';
	import Zap from 'lucide-svelte/icons/zap';

	let { children } = $props();

	let isInitializing = $state(true);
	let showUserMenu = $state(false);
	let showWelcomeTour = $state(false);

	// Navigation items
	const navItems = [
		{ href: '/', icon: Home, label: 'Feed' },
		{ href: '/search', icon: Search, label: 'Search' },
		{ href: '/notifications', icon: Bell, label: 'Alerts' },
		{ href: '/messages', icon: MessageCircle, label: 'Messages' },
		{ href: '/wallet', icon: Wallet, label: 'Wallet' },
		{ href: '/settings', icon: Settings, label: 'Settings' },
	];

	const currentPath = $derived($page.url.pathname);

	const isActive = (href: string) => {
		if (href === '/') return currentPath === '/';
		return currentPath.startsWith(href);
	};

	// Protected routes that require auth
	const protectedRoutes = ['/messages', '/wallet', '/settings', '/profile'];
	const isProtectedRoute = $derived(
		protectedRoutes.some((route) => currentPath.startsWith(route)),
	);

	onMount(async () => {
		try {
			// Initialize NDK with timeout
			await ndkService.init();

			// Connect with timeout (don't block UI if relays are slow)
			const connectPromise = ndkService.connect();
			const timeoutPromise = new Promise((_, reject) =>
				setTimeout(
					() => reject(new Error('Connection timeout')),
					10000,
				),
			);

			try {
				await Promise.race([connectPromise, timeoutPromise]);
			} catch (e) {
				console.warn('Relay connection slow, continuing anyway:', e);
			}

			// Initialize auth state
			await authStore.init();

			// Initialize wallet if previously connected
			if (authStore.isAuthenticated) {
				await walletStore.init();
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
	$effect(() => {
		if (!isInitializing && isProtectedRoute && !authStore.isAuthenticated) {
			goto('/login');
		}
	});

	async function handleLogout() {
		await authStore.logout();
		showUserMenu = false;
		goto('/login');
	}

	const avatarInitials = $derived(
		(authStore.displayName || 'A').slice(0, 2).toUpperCase(),
	);
</script>

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
			class="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-sidebar-border bg-sidebar md:block"
		>
			<div class="flex h-full flex-col">
				<!-- Logo -->
				<div
					class="flex h-16 items-center gap-3 border-b border-sidebar-border px-6"
				>
					<div
						class="flex h-10 w-10 items-center justify-center rounded-full bg-linear-to-br from-primary to-accent"
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
							class="flex items-center gap-3 rounded-lg px-4 py-3 text-sidebar-foreground transition-all duration-200
								{isActive(item.href) ?
								'bg-sidebar-accent text-sidebar-accent-foreground font-medium'
							:	'hover:bg-sidebar-accent/50'}"
						>
							<item.icon class="h-5 w-5" />
							<span>{item.label}</span>
							{#if item.href === '/messages'}
								<!-- Unread indicator would go here -->
							{/if}
						</a>
					{/each}
				</nav>

				<!-- User section -->
				{#if authStore.isAuthenticated}
					<div class="border-t border-sidebar-border p-4">
						<!-- Wallet status -->
						{#if walletStore.isConnected}
							<div
								class="mb-4 flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-success"
							>
								<Zap class="h-4 w-4" />
								<span class="text-sm font-medium">
									{walletStore.formatSats(
										walletStore.balance,
									)}
								</span>
							</div>
						{/if}

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
		<main class="flex-1">
			{@render children()}
		</main>

		<!-- Mobile bottom nav -->
		<nav
			class="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60 md:hidden"
		>
			<div class="flex items-center justify-around py-2">
				{#each navItems as item}
					<a
						href={item.href}
						class="flex flex-col items-center gap-1 px-4 py-2 transition-colors
							{isActive(item.href) ? 'text-primary' : 'text-muted-foreground'}"
					>
						<item.icon class="h-5 w-5" />
						<span class="text-xs">{item.label}</span>
					</a>
				{/each}
			</div>
		</nav>
	</div>
{/if}

<!-- Welcome Tour for first-time users -->
{#if showWelcomeTour}
	<WelcomeTour onComplete={() => (showWelcomeTour = false)} />
{/if}

<!-- Global keyboard shortcuts -->
<KeyboardShortcuts />
