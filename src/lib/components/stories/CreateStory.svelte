<script lang="ts">
	import { storiesStore } from '$stores/stories.svelte';
	import { mediaService } from '$services/media';
	import { Button } from '$components/ui/button';
	import { Textarea } from '$components/ui/textarea';
	import { Card } from '$components/ui/card';
	import X from 'lucide-svelte/icons/x';
	import ImagePlus from 'lucide-svelte/icons/image-plus';
	import Type from 'lucide-svelte/icons/type';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	import Trash2 from 'lucide-svelte/icons/trash-2';

	interface Props {
		onClose: () => void;
		onCreated?: (storyId: string) => void;
	}

	let { onClose, onCreated }: Props = $props();

	type StoryMode = 'text' | 'media';

	let mode = $state<StoryMode>('text');
	let text = $state('');
	let mediaUrl = $state<string | null>(null);
	let mediaPreview = $state<string | null>(null);
	let isUploading = $state(false);
	let isCreating = $state(false);
	let error = $state<string | null>(null);

	let fileInputRef: HTMLInputElement;

	const canCreate = $derived(
		mode === 'text' ? text.trim().length > 0 : !!mediaUrl
	);

	async function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;

		// Check file type
		const isImage = file.type.startsWith('image/');
		const isVideo = file.type.startsWith('video/');

		if (!isImage && !isVideo) {
			error = 'Please select an image or video file';
			return;
		}

		// Check file size (max 50MB for video, 10MB for image)
		const maxSize = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
		if (file.size > maxSize) {
			error = `File too large. Max ${isVideo ? '50MB' : '10MB'}`;
			return;
		}

		error = null;
		isUploading = true;

		try {
			// Create preview
			mediaPreview = URL.createObjectURL(file);

			// Upload to media server
			const result = await mediaService.upload(file);
			mediaUrl = result.url;
			mode = 'media';
		} catch (e) {
			console.error('Failed to upload media:', e);
			error = 'Failed to upload media. Please try again.';
			mediaPreview = null;
		} finally {
			isUploading = false;
		}
	}

	function clearMedia() {
		if (mediaPreview) {
			URL.revokeObjectURL(mediaPreview);
		}
		mediaUrl = null;
		mediaPreview = null;
		mode = 'text';
	}

	async function handleCreate() {
		if (!canCreate) return;

		isCreating = true;
		error = null;

		try {
			const storyId = await storiesStore.createStory(
				text.trim(),
				mediaUrl || undefined
			);

			if (storyId) {
				onCreated?.(storyId);
				onClose();
			} else {
				error = 'Failed to create story';
			}
		} catch (e) {
			console.error('Failed to create story:', e);
			error = 'Failed to create story';
		} finally {
			isCreating = false;
		}
	}

	function triggerFileInput() {
		fileInputRef?.click();
	}
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
	onclick={(e) => e.target === e.currentTarget && onClose()}
>
	<Card class="w-full max-w-lg mx-4 p-0 overflow-hidden">
		<!-- Header -->
		<div class="flex items-center justify-between p-4 border-b border-border">
			<h2 class="font-semibold">Create Story</h2>
			<Button variant="ghost" size="icon" onclick={onClose}>
				<X class="h-5 w-5" />
			</Button>
		</div>

		<!-- Content -->
		<div class="p-4 space-y-4">
			<!-- Mode selector -->
			{#if !mediaPreview}
				<div class="flex gap-2">
					<Button
						variant={mode === 'text' ? 'default' : 'outline'}
						class="flex-1 gap-2"
						onclick={() => (mode = 'text')}
					>
						<Type class="h-4 w-4" />
						Text
					</Button>
					<Button
						variant={mode === 'media' ? 'default' : 'outline'}
						class="flex-1 gap-2"
						onclick={triggerFileInput}
						disabled={isUploading}
					>
						{#if isUploading}
							<Loader2 class="h-4 w-4 animate-spin" />
						{:else}
							<ImagePlus class="h-4 w-4" />
						{/if}
						Photo/Video
					</Button>
				</div>
			{/if}

			<!-- Hidden file input -->
			<input
				type="file"
				accept="image/*,video/*"
				class="hidden"
				bind:this={fileInputRef}
				onchange={handleFileSelect}
			/>

			<!-- Media preview -->
			{#if mediaPreview}
				<div class="relative rounded-lg overflow-hidden bg-muted aspect-9/16 max-h-80">
					{#if mediaUrl?.match(/\.(mp4|webm|mov)$/i)}
						<!-- svelte-ignore a11y_media_has_caption -->
						<video
							src={mediaPreview}
							class="w-full h-full object-cover"
							autoplay
							loop
							muted
							playsinline
						></video>
					{:else}
						<img
							src={mediaPreview}
							alt="Preview"
							class="w-full h-full object-cover"
						/>
					{/if}

					<!-- Remove button -->
					<Button
						variant="destructive"
						size="icon"
						class="absolute top-2 right-2"
						onclick={clearMedia}
					>
						<Trash2 class="h-4 w-4" />
					</Button>
				</div>
			{/if}

			<!-- Text input -->
			<div>
				<Textarea
					bind:value={text}
					placeholder={mode === 'text' ? 'Share something...' : 'Add a caption (optional)...'}
					rows={mode === 'text' ? 6 : 2}
					maxlength={500}
					class={mode === 'text' ? 'text-lg' : ''}
				/>
				<div class="flex justify-end mt-1">
					<span class="text-xs text-muted-foreground">{text.length}/500</span>
				</div>
			</div>

			<!-- Error message -->
			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}

			<!-- Info -->
			<p class="text-xs text-muted-foreground text-center">
				Stories disappear after 24 hours
			</p>
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-end gap-2 p-4 border-t border-border bg-muted/30">
			<Button variant="outline" onclick={onClose} disabled={isCreating}>
				Cancel
			</Button>
			<Button onclick={handleCreate} disabled={!canCreate || isCreating}>
				{#if isCreating}
					<Loader2 class="h-4 w-4 mr-2 animate-spin" />
					Posting...
				{:else}
					Share Story
				{/if}
			</Button>
		</div>
	</Card>
</div>
