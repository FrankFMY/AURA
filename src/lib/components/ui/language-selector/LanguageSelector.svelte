<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { setLocale, locale, SUPPORTED_LOCALES, LOCALE_NAMES, type SupportedLocale } from '$lib/i18n';
	import { Button } from '$components/ui/button';
	import Globe from 'lucide-svelte/icons/globe';
	import Check from 'lucide-svelte/icons/check';

	let isOpen = $state(false);
	let menuRef: HTMLDivElement | undefined = $state(undefined);
	let focusedIndex = $state(0);

	const currentLocale = $derived($locale as SupportedLocale);

	function openMenu() {
		isOpen = true;
		// Set initial focus to current locale
		focusedIndex = SUPPORTED_LOCALES.indexOf(currentLocale);
		if (focusedIndex === -1) focusedIndex = 0;
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
		if (!isOpen) return;

		switch (event.key) {
			case 'Escape':
				event.preventDefault();
				isOpen = false;
				break;
			case 'ArrowDown':
				event.preventDefault();
				focusedIndex = (focusedIndex + 1) % SUPPORTED_LOCALES.length;
				break;
			case 'ArrowUp':
				event.preventDefault();
				focusedIndex = (focusedIndex - 1 + SUPPORTED_LOCALES.length) % SUPPORTED_LOCALES.length;
				break;
			case 'Enter':
			case ' ':
				event.preventDefault();
				selectLocale(SUPPORTED_LOCALES[focusedIndex]);
				break;
		}
	}

	$effect(() => {
		if (isOpen) {
			document.addEventListener('click', handleClickOutside);
		}
		return () => {
			document.removeEventListener('click', handleClickOutside);
		};
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relative" bind:this={menuRef} onkeydown={handleKeyDown}>
	<Button
		variant="ghost"
		size="sm"
		onclick={openMenu}
		aria-label={$_('settings.language')}
		aria-expanded={isOpen}
		aria-haspopup="menu"
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
			{#each SUPPORTED_LOCALES as loc, i}
				<button
					class="flex items-center justify-between w-full px-4 py-2 text-sm text-left hover:bg-accent hover:text-accent-foreground transition-colors first:rounded-t-md last:rounded-b-md
						{focusedIndex === i ? 'bg-accent text-accent-foreground' : ''}"
					role="menuitem"
					tabindex={focusedIndex === i ? 0 : -1}
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
