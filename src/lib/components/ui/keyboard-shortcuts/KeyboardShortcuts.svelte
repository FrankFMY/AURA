<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { goto } from '$app/navigation';
	import { browser } from '$app/environment';
	import { Button } from '$components/ui/button';
	import Keyboard from 'lucide-svelte/icons/keyboard';
	import X from 'lucide-svelte/icons/x';

	let showHelp = $state(false);

	interface Shortcut {
		key: string;
		description: string;
		modifiers?: ('ctrl' | 'alt' | 'shift' | 'meta')[];
	}

	const shortcuts: Shortcut[] = [
		{ key: 'n', description: 'New post (focus composer)' },
		{ key: 'r', description: 'Refresh feed' },
		{ key: 'j', description: 'Next post' },
		{ key: 'k', description: 'Previous post' },
		{ key: '/', description: 'Focus search' },
		{ key: 'g h', description: 'Go to Home' },
		{ key: 'g s', description: 'Go to Search' },
		{ key: 'g m', description: 'Go to Messages' },
		{ key: 'g n', description: 'Go to Notifications' },
		{ key: 'g w', description: 'Go to Wallet' },
		{ key: 'g p', description: 'Go to Settings' },
		{ key: '?', description: 'Show keyboard shortcuts' },
		{ key: 'Escape', description: 'Close modal / Cancel' },
	];

	let pendingGoKey = false;

	function handleKeyDown(event: KeyboardEvent) {
		// Don't trigger if user is typing in an input/textarea
		const target = event.target as HTMLElement;
		if (
			target.tagName === 'INPUT' ||
			target.tagName === 'TEXTAREA' ||
			target.isContentEditable
		) {
			return;
		}

		const key = event.key.toLowerCase();

		// Handle "g" prefix for navigation
		if (pendingGoKey) {
			pendingGoKey = false;
			switch (key) {
				case 'h':
					goto('/');
					break;
				case 's':
					goto('/search');
					break;
				case 'm':
					goto('/messages');
					break;
				case 'n':
					goto('/notifications');
					break;
				case 'w':
					goto('/wallet');
					break;
				case 'p':
					goto('/settings');
					break;
			}
			return;
		}

		// Single key shortcuts
		switch (key) {
			case '?':
				event.preventDefault();
				showHelp = !showHelp;
				break;
			case 'escape':
				showHelp = false;
				break;
			case 'g':
				pendingGoKey = true;
				// Reset after 1 second if no follow-up key
				setTimeout(() => (pendingGoKey = false), 1000);
				break;
			case 'n':
				event.preventDefault();
				// Focus the composer if it exists
				const composer = document.querySelector<HTMLTextAreaElement>(
					'textarea[placeholder*="What"]',
				);
				if (composer) {
					composer.focus();
					window.scrollTo({ top: 0, behavior: 'smooth' });
				}
				break;
			case 'r':
				event.preventDefault();
				// Dispatch custom event for feed refresh
				window.dispatchEvent(new CustomEvent('aura:refresh-feed'));
				break;
			case '/':
				event.preventDefault();
				goto('/search');
				// Focus search input after navigation
				setTimeout(() => {
					const searchInput =
						document.querySelector<HTMLInputElement>(
							'input[type="search"]',
						);
					if (searchInput) searchInput.focus();
				}, 100);
				break;
			case 'j':
				event.preventDefault();
				// Scroll to next post
				scrollToPost('next');
				break;
			case 'k':
				event.preventDefault();
				// Scroll to previous post
				scrollToPost('prev');
				break;
		}
	}

	function scrollToPost(direction: 'next' | 'prev') {
		const posts = document.querySelectorAll('article');
		if (posts.length === 0) return;

		const viewportCenter = window.innerHeight / 2;
		let currentIndex = -1;

		// Find the current post in view
		posts.forEach((post, index) => {
			const rect = post.getBoundingClientRect();
			if (rect.top <= viewportCenter && rect.bottom >= viewportCenter) {
				currentIndex = index;
			}
		});

		// Calculate target index
		let targetIndex: number;
		if (direction === 'next') {
			targetIndex =
				currentIndex === -1 ? 0 : (
					Math.min(currentIndex + 1, posts.length - 1)
				);
		} else {
			targetIndex =
				currentIndex === -1 ? 0 : Math.max(currentIndex - 1, 0);
		}

		// Scroll to target post
		posts[targetIndex]?.scrollIntoView({
			behavior: 'smooth',
			block: 'center',
		});
	}

	onMount(() => {
		if (browser) {
			window.addEventListener('keydown', handleKeyDown);
		}
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('keydown', handleKeyDown);
		}
	});

	function formatKey(shortcut: Shortcut): string {
		const parts: string[] = [];
		if (shortcut.modifiers) {
			if (shortcut.modifiers.includes('ctrl')) parts.push('Ctrl');
			if (shortcut.modifiers.includes('alt')) parts.push('Alt');
			if (shortcut.modifiers.includes('shift')) parts.push('Shift');
			if (shortcut.modifiers.includes('meta')) parts.push('⌘');
		}
		parts.push(shortcut.key.toUpperCase());
		return parts.join(' + ');
	}
</script>

<!-- Help Modal -->
{#if showHelp}
	<div
		class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
		onclick={() => (showHelp = false)}
		onkeydown={(e) => e.key === 'Escape' && (showHelp = false)}
		role="button"
		tabindex="-1"
	></div>
	<div
		class="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4"
	>
		<div class="rounded-lg border border-border bg-background shadow-lg">
			<div
				class="flex items-center justify-between border-b border-border p-4"
			>
				<div class="flex items-center gap-2">
					<Keyboard class="h-5 w-5" />
					<h2 class="font-semibold">Keyboard Shortcuts</h2>
				</div>
				<Button
					variant="ghost"
					size="icon"
					onclick={() => (showHelp = false)}
				>
					<X class="h-4 w-4" />
				</Button>
			</div>
			<div class="max-h-96 overflow-y-auto p-4">
				<div class="space-y-2">
					{#each shortcuts as shortcut}
						<div class="flex items-center justify-between py-1">
							<span class="text-sm text-muted-foreground">
								{shortcut.description}
							</span>
							<kbd
								class="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground"
							>
								{formatKey(shortcut)}
							</kbd>
						</div>
					{/each}
				</div>
			</div>
			<div class="border-t border-border p-4">
				<p class="text-center text-xs text-muted-foreground">
					Press <kbd class="rounded bg-muted px-1 font-mono text-xs"
						>?</kbd
					> anytime to toggle this help
				</p>
			</div>
		</div>
	</div>
{/if}
