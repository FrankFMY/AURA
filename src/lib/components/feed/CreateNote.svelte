<script lang="ts">
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Textarea } from '$components/ui/textarea';
	import { Spinner } from '$components/ui/spinner';
	import { MediaUpload } from '$components/media';
	import { authStore } from '$stores/auth.svelte';
	import { feedStore } from '$stores/feed.svelte';
	import type { MediaUploadResult } from '$services/media';
	import ImagePlus from 'lucide-svelte/icons/image-plus';
	import Send from 'lucide-svelte/icons/send';
	import X from 'lucide-svelte/icons/x';
	import CirclePlus from 'lucide-svelte/icons/circle-plus';

	interface Props {
		replyTo?: import('@nostr-dev-kit/ndk').NDKEvent;
		onSuccess?: () => void;
		onCreateStory?: () => void;
		placeholder?: string;
		compact?: boolean;
	}

	let {
		replyTo,
		onSuccess,
		onCreateStory,
		placeholder = "What's on your mind?",
		compact = false,
	}: Props = $props();

	let content = $state('');
	let isSubmitting = $state(false);
	let error = $state<string | null>(null);
	let attachedImages = $state<string[]>([]);
	let showMediaUpload = $state(false);

	const charCount = $derived(content.length);
	const canSubmit = $derived(
		(content.trim().length > 0 || attachedImages.length > 0) &&
			!isSubmitting,
	);

	function handleMediaUpload(result: MediaUploadResult) {
		attachedImages = [...attachedImages, result.url];
		showMediaUpload = false;
	}

	function removeImage(url: string) {
		attachedImages = attachedImages.filter((u) => u !== url);
	}

	const avatarInitials = $derived(
		(authStore.displayName || 'A').slice(0, 2).toUpperCase(),
	);

	async function handleSubmit() {
		if (!canSubmit) return;

		isSubmitting = true;
		error = null;

		try {
			// Append image URLs to content
			let fullContent = content;
			if (attachedImages.length > 0) {
				if (fullContent.trim()) {
					fullContent += '\n\n';
				}
				fullContent += attachedImages.join('\n');
			}

			await feedStore.publishNote(fullContent, replyTo);
			content = '';
			attachedImages = [];
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

<div
	class="border-b border-border bg-card/30 p-3 sm:p-4 transition-colors hover:bg-card/50"
>
	<div class="flex gap-2 sm:gap-3">
		<!-- Avatar with optional Story button -->
		<div class="flex flex-col items-center gap-1">
			<button
				class="relative group"
				onclick={onCreateStory}
				disabled={!onCreateStory}
			>
				<Avatar
					size="md"
					class="ring-2 ring-primary/20 ring-offset-2 ring-offset-background {onCreateStory ? 'group-hover:ring-primary/40 transition-all' : ''}"
				>
					<AvatarImage
						src={authStore.avatar}
						alt={authStore.displayName}
					/>
					<AvatarFallback>{avatarInitials}</AvatarFallback>
				</Avatar>
				{#if onCreateStory}
					<div class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center ring-2 ring-background">
						<CirclePlus class="h-2.5 w-2.5 text-primary-foreground" />
					</div>
				{/if}
			</button>
		</div>

		<div class="min-w-0 flex-1">
			<Textarea
				bind:value={content}
				{placeholder}
				rows={compact ? 2 : 3}
				class="mb-2 sm:mb-3 resize-none border-none bg-transparent p-0 text-sm sm:text-base placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
				onkeydown={handleKeydown}
			/>

			<!-- Attached images preview -->
			{#if attachedImages.length > 0}
				<div class="mb-3 flex flex-wrap gap-2">
					{#each attachedImages as imageUrl (imageUrl)}
						<div class="relative">
							<img
								src={imageUrl}
								alt="Attached"
								class="h-20 w-20 rounded-lg object-cover"
							/>
							<button
								class="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
								onclick={() => removeImage(imageUrl)}
								aria-label="Remove image"
							>
								<X class="h-3 w-3" />
							</button>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Media upload dropdown -->
			{#if showMediaUpload}
				<div class="mb-3">
					<MediaUpload onUpload={handleMediaUpload} />
				</div>
			{/if}

			{#if error}
				<p class="mb-2 text-sm text-destructive">{error}</p>
			{/if}

			<div class="flex items-center justify-between gap-2">
				<div class="flex items-center gap-1 sm:gap-2">
					<Button
						variant="ghost"
						size="icon"
						onclick={() => (showMediaUpload = !showMediaUpload)}
						class="h-8 w-8 sm:h-9 sm:w-9 {showMediaUpload ? 'text-primary' : ''}"
					>
						<ImagePlus class="h-4 w-4 sm:h-5 sm:w-5" />
					</Button>
					<span class="text-[10px] sm:text-xs text-muted-foreground hidden sm:inline">
						{charCount} chars
						{#if attachedImages.length > 0}
							· {attachedImages.length} img
						{/if}
					</span>
				</div>

				<Button
					variant="glow"
					size="sm"
					onclick={handleSubmit}
					disabled={!canSubmit}
					class="min-w-17.5 sm:min-w-25 h-8 sm:h-9 text-xs sm:text-sm"
				>
					{#if isSubmitting}
						<Spinner size="sm" />
					{:else}
						<Send class="h-3.5 w-3.5 sm:h-4 sm:w-4" />
						<span class="ml-1">Post</span>
					{/if}
				</Button>
			</div>
		</div>
	</div>
</div>
