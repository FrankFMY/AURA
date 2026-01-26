<script lang="ts">
	import { bookmarksStore } from '$stores/bookmarks.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { notificationsStore } from '$stores/notifications.svelte';
	import { Button } from '$components/ui/button';
	import { Spinner } from '$components/ui/spinner';
	import Bookmark from 'lucide-svelte/icons/bookmark';
	import BookmarkCheck from 'lucide-svelte/icons/bookmark-check';

	interface Props {
		eventId: string;
		variant?: 'ghost' | 'outline' | 'default';
		size?: 'sm' | 'default' | 'icon';
		showLabel?: boolean;
		class?: string;
	}

	let {
		eventId,
		variant = 'ghost',
		size = 'sm',
		showLabel = false,
		class: className = ''
	}: Props = $props();

	let isToggling = $state(false);

	const isBookmarked = $derived(bookmarksStore.isBookmarked(eventId));

	async function handleToggle(e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();

		// Check if user is authenticated
		if (!authStore.isAuthenticated) {
			notificationsStore.error('Login required', 'Please login to save bookmarks');
			return;
		}

		if (isToggling) return;
		isToggling = true;

		try {
			await bookmarksStore.toggle(eventId);
		} catch (err) {
			console.error('Failed to toggle bookmark:', err);
			notificationsStore.error('Failed', 'Could not update bookmark');
		} finally {
			isToggling = false;
		}
	}
</script>

<Button
	{variant}
	{size}
	class="gap-1.5 h-9 px-2 hover:text-amber-500 hover:bg-amber-500/10 {isBookmarked ? 'text-amber-500' : ''} {className}"
	onclick={handleToggle}
	disabled={isToggling}
	aria-label={isBookmarked ? 'Remove bookmark' : 'Add bookmark'}
	aria-pressed={isBookmarked}
	title={isBookmarked ? 'Remove from bookmarks' : 'Add to bookmarks'}
>
	{#if isToggling}
		<Spinner size="sm" />
	{:else if isBookmarked}
		<BookmarkCheck class="h-4 w-4 fill-current" />
	{:else}
		<Bookmark class="h-4 w-4" />
	{/if}
	{#if showLabel}
		<span class="text-xs">{isBookmarked ? 'Saved' : 'Save'}</span>
	{/if}
</Button>
