<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { setLocale, locale, SUPPORTED_LOCALES, LOCALE_NAMES, type SupportedLocale } from '$lib/i18n';
	import { Button } from '$components/ui/button';
	import Globe from 'lucide-svelte/icons/globe';
	import Check from 'lucide-svelte/icons/check';

	let isOpen = $state(false);
	let menuRef: HTMLDivElement | undefined = $state(undefined);

	const currentLocale = $derived($locale as SupportedLocale);

	function toggleMenu() {
		isOpen = !isOpen;
	}

	function selectLocale(newLocale: SupportedLocale) {
		setLocale(newLocale);
		isOpen = false;
	}

	function handleClickOutside(event: MouseEvent) {
		if (menuRef && !menuRef.contains(event.target as Node)) {
			isOpen = false;
		}
	}

	function handleKeyDown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			isOpen = false;
		}
	}

	$effect(() => {
		if (isOpen) {
			document.addEventListener('click', handleClickOutside);
			document.addEventListener('keydown', handleKeyDown);
		}
		return () => {
			document.removeEventListener('click', handleClickOutside);
			document.removeEventListener('keydown', handleKeyDown);
		};
	});
</script>

<div class="relative" bind:this={menuRef}>
	<Button
		variant="ghost"
		size="sm"
		onclick={toggleMenu}
		aria-label={$_('settings.language')}
		aria-expanded={isOpen}
		aria-haspopup="true"
	>
		<Globe class="h-4 w-4 mr-2" />
		<span class="hidden sm:inline">{LOCALE_NAMES[currentLocale]}</span>
	</Button>

	{#if isOpen}
		<div
			class="absolute right-0 mt-2 w-40 rounded-md bg-popover border border-border shadow-lg z-50"
			role="menu"
			aria-orientation="vertical"
		>
			{#each SUPPORTED_LOCALES as loc}
				<button
					class="flex items-center justify-between w-full px-4 py-2 text-sm text-left hover:bg-accent hover:text-accent-foreground transition-colors first:rounded-t-md last:rounded-b-md"
					role="menuitem"
					onclick={() => selectLocale(loc)}
				>
					<span>{LOCALE_NAMES[loc]}</span>
					{#if loc === currentLocale}
						<Check class="h-4 w-4 text-primary" />
					{/if}
				</button>
			{/each}
		</div>
	{/if}
</div>
