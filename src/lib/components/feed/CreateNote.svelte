<script lang="ts">
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Textarea } from '$components/ui/textarea';
	import { Spinner } from '$components/ui/spinner';
	import { authStore } from '$stores/auth.svelte';
	import { feedStore } from '$stores/feed.svelte';
	import ImagePlus from 'lucide-svelte/icons/image-plus';
	import Send from 'lucide-svelte/icons/send';

	interface Props {
		replyTo?: import('@nostr-dev-kit/ndk').NDKEvent;
		onSuccess?: () => void;
		placeholder?: string;
	}

	let {
		replyTo,
		onSuccess,
		placeholder = "What's on your mind?",
	}: Props = $props();

	let content = $state('');
	let isSubmitting = $state(false);
	let error = $state<string | null>(null);

	const charCount = $derived(content.length);
	const canSubmit = $derived(content.trim().length > 0 && !isSubmitting);

	const avatarInitials = $derived(
		(authStore.displayName || 'A').slice(0, 2).toUpperCase(),
	);

	async function handleSubmit() {
		if (!canSubmit) return;

		isSubmitting = true;
		error = null;

		try {
			await feedStore.publishNote(content, replyTo);
			content = '';
			onSuccess?.();
		} catch (e) {
			error = e instanceof Error ? e.message : 'Failed to publish';
		} finally {
			isSubmitting = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		// Cmd/Ctrl + Enter to submit
		if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
			handleSubmit();
		}
	}
</script>

<div class="border-b border-border p-4">
	<div class="flex gap-3">
		<Avatar size="md">
			<AvatarImage
				src={authStore.avatar}
				alt={authStore.displayName}
			/>
			<AvatarFallback>{avatarInitials}</AvatarFallback>
		</Avatar>

		<div class="min-w-0 flex-1">
			<Textarea
				bind:value={content}
				{placeholder}
				rows={3}
				class="mb-3 resize-none border-none bg-transparent p-0 text-base focus-visible:ring-0 focus-visible:ring-offset-0"
				onkeydown={handleKeydown}
			/>

			{#if error}
				<p class="mb-2 text-sm text-destructive">{error}</p>
			{/if}

			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<Button
						variant="ghost"
						size="icon"
						disabled
					>
						<ImagePlus class="h-5 w-5 text-muted-foreground" />
					</Button>
					<span class="text-xs text-muted-foreground">
						{charCount} characters
					</span>
				</div>

				<Button
					variant="glow"
					size="sm"
					onclick={handleSubmit}
					disabled={!canSubmit}
					class="min-w-[100px]"
				>
					{#if isSubmitting}
						<Spinner size="sm" />
					{:else}
						<Send class="h-4 w-4" />
						Post
					{/if}
				</Button>
			</div>
		</div>
	</div>
</div>
