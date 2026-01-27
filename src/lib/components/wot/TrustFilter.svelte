<script lang="ts">
	/**
	 * TrustFilter
	 *
	 * Filter dropdown for Web of Trust levels.
	 */
	import { _ } from 'svelte-i18n';
	import { wotStore, type WoTFilterLevel } from '$stores/wot.svelte';
	import { Button } from '$components/ui/button';
	import Filter from 'lucide-svelte/icons/filter';
	import ChevronDown from 'lucide-svelte/icons/chevron-down';
	import Check from 'lucide-svelte/icons/check';

	let showDropdown = $state(false);
	let focusedIndex = $state(0);

	const filters: { value: WoTFilterLevel; labelKey: string; descKey: string }[] = [
		{ value: 'all', labelKey: 'components.wot.all', descKey: 'components.wot.allDesc' },
		{ value: 'extended', labelKey: 'components.wot.network', descKey: 'components.wot.networkDesc' },
		{ value: 'fof', labelKey: 'components.wot.friends', descKey: 'components.wot.friendsDesc' },
		{ value: 'trusted', labelKey: 'components.wot.trusted', descKey: 'components.wot.trustedDesc' }
	];

	// Total items including "Show unknown users" toggle
	const totalItems = filters.length + 1;

	function selectFilter(level: WoTFilterLevel) {
		wotStore.setFilterLevel(level);
		showDropdown = false;
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (!showDropdown) return;

		switch (e.key) {
			case 'ArrowDown':
				e.preventDefault();
				focusedIndex = (focusedIndex + 1) % totalItems;
				break;
			case 'ArrowUp':
				e.preventDefault();
				focusedIndex = (focusedIndex - 1 + totalItems) % totalItems;
				break;
			case 'Enter':
			case ' ':
				e.preventDefault();
				if (focusedIndex < filters.length) {
					selectFilter(filters[focusedIndex].value);
				} else {
					wotStore.toggleShowUnknown();
					showDropdown = false;
				}
				break;
			case 'Escape':
				e.preventDefault();
				showDropdown = false;
				break;
		}
	}

	function openDropdown() {
		showDropdown = true;
		focusedIndex = filters.findIndex(f => f.value === wotStore.filterLevel);
		if (focusedIndex === -1) focusedIndex = 0;
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="relative" onkeydown={handleKeyDown}>
	<Button
		variant="ghost"
		size="sm"
		class="gap-1"
		onclick={openDropdown}
		aria-expanded={showDropdown}
		aria-haspopup="menu"
		aria-label="Filter by trust level"
	>
		<Filter class="h-4 w-4" />
		<span class="hidden sm:inline">
			{$_(filters.find(f => f.value === wotStore.filterLevel)?.labelKey || 'components.wot.filterLabel')}
		</span>
		<ChevronDown class="h-3 w-3" />
	</Button>

	{#if showDropdown}
		<!-- Backdrop -->
		<button
			class="fixed inset-0 z-40"
			onclick={() => showDropdown = false}
			aria-label="Close filter dropdown"
			tabindex="-1"
		></button>

		<!-- Dropdown -->
		<div
			class="absolute right-0 top-full mt-1 z-50 min-w-45 rounded-md border border-border bg-popover p-1 shadow-lg"
			role="menu"
			aria-orientation="vertical"
		>
			{#each filters as filter, i}
				<button
					class="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted transition-colors
						{wotStore.filterLevel === filter.value ? 'bg-muted' : ''}
						{focusedIndex === i ? 'ring-2 ring-primary ring-inset' : ''}"
					role="menuitem"
					tabindex={focusedIndex === i ? 0 : -1}
					onclick={() => selectFilter(filter.value)}
				>
					<span class="w-4">
						{#if wotStore.filterLevel === filter.value}
							<Check class="h-4 w-4 text-primary" />
						{/if}
					</span>
					<div class="text-left">
						<div class="font-medium">{$_(filter.labelKey)}</div>
						<div class="text-xs text-muted-foreground">{$_(filter.descKey)}</div>
					</div>
				</button>
			{/each}

			<div class="border-t border-border mt-1 pt-1">
				<button
					class="flex w-full items-center gap-2 rounded px-3 py-2 text-sm hover:bg-muted transition-colors
						{focusedIndex === filters.length ? 'ring-2 ring-primary ring-inset' : ''}"
					role="menuitemcheckbox"
					aria-checked={wotStore.showUnknown}
					tabindex={focusedIndex === filters.length ? 0 : -1}
					onclick={() => { wotStore.toggleShowUnknown(); showDropdown = false; }}
				>
					<span class="w-4">
						{#if wotStore.showUnknown}
							<Check class="h-4 w-4 text-primary" />
						{/if}
					</span>
					<span>{$_('components.wot.showUnknown')}</span>
				</button>
			</div>
		</div>
	{/if}
</div>
