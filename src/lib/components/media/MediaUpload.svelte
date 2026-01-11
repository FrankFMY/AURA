<script lang="ts">
	import {
		mediaService,
		SUPPORTED_IMAGE_TYPES,
		MAX_IMAGE_SIZE,
		type MediaUploadResult,
	} from '$services/media';
	import { Button } from '$components/ui/button';
	import { Spinner } from '$components/ui/spinner';
	import { notificationsStore } from '$stores/notifications.svelte';
	import Upload from 'lucide-svelte/icons/upload';
	import Image from 'lucide-svelte/icons/image';
	import X from 'lucide-svelte/icons/x';
	import Clipboard from 'lucide-svelte/icons/clipboard';

	interface Props {
		/** Callback when upload completes */
		onUpload: (result: MediaUploadResult) => void;
		/** Allow multiple uploads */
		multiple?: boolean;
		/** Compact mode */
		compact?: boolean;
	}

	let { onUpload, multiple = false, compact = false }: Props = $props();

	let isDragging = $state(false);
	let isUploading = $state(false);
	let uploadProgress = $state(0);
	let previewUrls = $state<string[]>([]);
	let fileInput = $state<HTMLInputElement>();

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		isDragging = true;
	}

	function handleDragLeave(e: DragEvent) {
		e.preventDefault();
		isDragging = false;
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		isDragging = false;

		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			await uploadFiles(files);
		}
	}

	async function handleFileSelect(e: Event) {
		const input = e.target as HTMLInputElement;
		if (input.files && input.files.length > 0) {
			await uploadFiles(input.files);
		}
		// Reset input
		input.value = '';
	}

	async function handlePaste() {
		isUploading = true;
		uploadProgress = 0;

		try {
			const result = await mediaService.uploadFromClipboard(
				(progress) => {
					uploadProgress = progress;
				},
			);

			if (result) {
				onUpload(result);
				notificationsStore.success(
					'Image uploaded',
					'Pasted from clipboard',
				);
			} else {
				notificationsStore.warning(
					'No image found',
					'Clipboard does not contain an image',
				);
			}
		} catch (e) {
			console.error('Clipboard upload failed:', e);
			notificationsStore.error(
				'Upload failed',
				e instanceof Error ? e.message : 'Unknown error',
			);
		} finally {
			isUploading = false;
			uploadProgress = 0;
		}
	}

	async function uploadFiles(files: FileList) {
		const filesToUpload = multiple ? Array.from(files) : [files[0]];

		for (const file of filesToUpload) {
			// Validate
			if (!SUPPORTED_IMAGE_TYPES.includes(file.type)) {
				notificationsStore.error(
					'Invalid file type',
					'Please upload an image (JPEG, PNG, GIF, WebP)',
				);
				continue;
			}

			if (file.size > MAX_IMAGE_SIZE) {
				notificationsStore.error(
					'File too large',
					`Maximum size is ${MAX_IMAGE_SIZE / 1024 / 1024}MB`,
				);
				continue;
			}

			// Add preview
			const previewUrl = mediaService.createPreviewUrl(file);
			previewUrls = [...previewUrls, previewUrl];

			isUploading = true;
			uploadProgress = 0;

			try {
				const result = await mediaService.upload(file, (progress) => {
					uploadProgress = progress;
				});

				onUpload(result);
				notificationsStore.success('Image uploaded', 'Ready to use');
			} catch (e) {
				console.error('Upload failed:', e);
				notificationsStore.error(
					'Upload failed',
					e instanceof Error ? e.message : 'Unknown error',
				);
			} finally {
				// Remove preview
				mediaService.revokePreviewUrl(previewUrl);
				previewUrls = previewUrls.filter((u) => u !== previewUrl);
			}
		}

		isUploading = false;
		uploadProgress = 0;
	}

	function triggerFileSelect() {
		fileInput?.click();
	}
</script>

{#if compact}
	<!-- Compact mode - just buttons -->
	<div class="flex items-center gap-2">
		<Button
			variant="ghost"
			size="icon"
			onclick={triggerFileSelect}
			disabled={isUploading}
			title="Upload image"
		>
			{#if isUploading}
				<Spinner class="h-4 w-4" />
			{:else}
				<Image class="h-4 w-4" />
			{/if}
		</Button>
		<Button
			variant="ghost"
			size="icon"
			onclick={handlePaste}
			disabled={isUploading}
			title="Paste from clipboard"
		>
			<Clipboard class="h-4 w-4" />
		</Button>
		<input
			bind:this={fileInput}
			type="file"
			accept={SUPPORTED_IMAGE_TYPES.join(',')}
			class="hidden"
			onchange={handleFileSelect}
			{multiple}
		/>
	</div>
{:else}
	<!-- Full mode - drag and drop area -->
	<div
		class="relative rounded-lg border-2 border-dashed transition-colors
			{isDragging ?
			'border-primary bg-primary/5'
		:	'border-border hover:border-muted-foreground'}"
		ondragover={handleDragOver}
		ondragleave={handleDragLeave}
		ondrop={handleDrop}
		role="button"
		tabindex="0"
		onclick={triggerFileSelect}
		onkeydown={(e) => e.key === 'Enter' && triggerFileSelect()}
	>
		<input
			bind:this={fileInput}
			type="file"
			accept={SUPPORTED_IMAGE_TYPES.join(',')}
			class="hidden"
			onchange={handleFileSelect}
			{multiple}
		/>

		{#if isUploading}
			<div class="flex flex-col items-center justify-center p-8">
				<Spinner class="h-8 w-8 text-primary" />
				<p class="mt-2 text-sm text-muted-foreground">
					Uploading... {uploadProgress}%
				</p>
				<div
					class="mt-2 h-1 w-32 overflow-hidden rounded-full bg-muted"
				>
					<div
						class="h-full bg-primary transition-all"
						style="width: {uploadProgress}%"
					></div>
				</div>
			</div>
		{:else if previewUrls.length > 0}
			<div class="grid grid-cols-2 gap-2 p-4">
				{#each previewUrls as url}
					<div class="relative">
						<img
							src={url}
							alt="Preview"
							class="h-24 w-full rounded object-cover"
						/>
						<div
							class="absolute inset-0 flex items-center justify-center bg-background/50"
						>
							<Spinner class="h-6 w-6" />
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<div class="flex flex-col items-center justify-center p-8">
				<div
					class="flex h-12 w-12 items-center justify-center rounded-full bg-muted"
				>
					<Upload class="h-6 w-6 text-muted-foreground" />
				</div>
				<p class="mt-3 text-sm font-medium">
					{isDragging ? 'Drop image here' : 'Click or drag to upload'}
				</p>
				<p class="mt-1 text-xs text-muted-foreground">
					JPEG, PNG, GIF, WebP up to {MAX_IMAGE_SIZE / 1024 / 1024}MB
				</p>
				<div class="mt-3 flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						onclick={(e) => {
							e.stopPropagation();
							handlePaste();
						}}
					>
						<Clipboard class="mr-1 h-3 w-3" />
						Paste
					</Button>
				</div>
			</div>
		{/if}
	</div>
{/if}
