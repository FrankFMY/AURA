<script lang="ts">
	import { sanitizeUrl } from '$lib/validators/sanitize';
	import Play from 'lucide-svelte/icons/play';
	import ImageOff from 'lucide-svelte/icons/image-off';
	import ExternalLink from 'lucide-svelte/icons/external-link';

	interface Props {
		url: string;
		class?: string;
	}

	let { url, class: className = '' }: Props = $props();

	// Media type detection
	const mediaType = $derived(detectMediaType(url));
	const embedData = $derived(parseEmbed(url));

	let hasError = $state(false);
	let showYouTubeEmbed = $state(false);
	let isLoading = $state(true);

	function detectMediaType(
		url: string,
	): 'image' | 'video' | 'youtube' | 'audio' | 'unknown' {
		const lower = url.toLowerCase();

		// Image extensions
		if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?.*)?$/i.test(lower)) {
			return 'image';
		}

		// Video extensions
		if (/\.(mp4|webm|mov|avi|mkv)(\?.*)?$/i.test(lower)) {
			return 'video';
		}

		// Audio extensions
		if (/\.(mp3|wav|ogg|flac|m4a)(\?.*)?$/i.test(lower)) {
			return 'audio';
		}

		// YouTube
		if (
			lower.includes('youtube.com/watch') ||
			lower.includes('youtu.be/') ||
			lower.includes('youtube.com/shorts/')
		) {
			return 'youtube';
		}

		// Image hosting services (often don't have extensions)
		if (
			lower.includes('nostr.build') ||
			lower.includes('imgbb.com') ||
			lower.includes('imgur.com') ||
			lower.includes('i.imgur.com') ||
			lower.includes('primal.b-cdn.net') ||
			lower.includes('image.nostr.build') ||
			lower.includes('void.cat')
		) {
			return 'image';
		}

		return 'unknown';
	}

	function parseEmbed(url: string): {
		type: string;
		id?: string;
		thumbnail?: string;
	} {
		const type = detectMediaType(url);

		if (type === 'youtube') {
			const videoId = extractYouTubeId(url);
			return {
				type: 'youtube',
				id: videoId ?? undefined,
				thumbnail:
					videoId ?
						`https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
					:	undefined,
			};
		}

		return { type };
	}

	function extractYouTubeId(url: string): string | null {
		// Handle youtube.com/watch?v=ID
		const watchMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
		if (watchMatch) return watchMatch[1];

		// Handle youtu.be/ID
		const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
		if (shortMatch) return shortMatch[1];

		// Handle youtube.com/shorts/ID
		const shortsMatch = url.match(
			/youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
		);
		if (shortsMatch) return shortsMatch[1];

		return null;
	}

	function handleImageError() {
		hasError = true;
		isLoading = false;
	}

	function handleVideoError() {
		hasError = true;
		isLoading = false;
	}

	function handleLoad() {
		isLoading = false;
	}

	function handleYouTubeClick() {
		showYouTubeEmbed = true;
	}

	const safeUrl = $derived(sanitizeUrl(url));
</script>

{#if safeUrl && !hasError}
	<div class="media-embed relative w-full max-w-full rounded-lg overflow-hidden bg-muted {className}">
		{#if mediaType === 'image'}
			<!-- Image embed -->
			<a
				href={safeUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="block relative"
			>
				{#if isLoading}
					<div class="absolute inset-0 flex items-center justify-center bg-muted animate-pulse">
						<ImageOff class="h-8 w-8 text-muted-foreground/30" />
					</div>
				{/if}
				<img
					src={safeUrl}
					alt="Embedded media"
					class="max-h-96 w-full object-contain hover:opacity-90 transition-opacity {isLoading ? 'opacity-0' : 'opacity-100'}"
					loading="lazy"
					decoding="async"
					onerror={handleImageError}
					onload={handleLoad}
				/>
			</a>
		{:else if mediaType === 'video'}
			<!-- Video embed - centered with max dimensions for vertical videos -->
			<div class="flex items-center justify-center bg-black/5">
				<video
					src={safeUrl}
					controls
					preload="metadata"
					class="max-h-125 max-w-full"
					poster=""
					onerror={handleVideoError}
					onloadeddata={handleLoad}
				>
					<track kind="captions" />
					Your browser does not support video playback.
				</video>
			</div>
		{:else if mediaType === 'youtube' && embedData.id}
			<!-- YouTube embed - limited height to not take over the feed -->
			{#if showYouTubeEmbed}
				<div class="aspect-video max-h-90">
					<iframe
						src="https://www.youtube-nocookie.com/embed/{embedData.id}?autoplay=1&rel=0"
						title="YouTube video"
						frameborder="0"
						allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
						allowfullscreen
						class="h-full w-full max-h-90"
					></iframe>
				</div>
			{:else}
				<!-- YouTube thumbnail with play button -->
				<button
					class="relative aspect-video w-full max-h-90 cursor-pointer group"
					onclick={handleYouTubeClick}
				>
					<img
						src={embedData.thumbnail}
						alt="YouTube video thumbnail"
						class="h-full w-full object-cover"
						loading="lazy"
						onerror={handleImageError}
					/>
					<div
						class="absolute inset-0 flex items-center justify-center bg-black/30 group-hover:bg-black/40 transition-colors"
					>
						<div
							class="flex h-16 w-16 items-center justify-center rounded-full bg-red-600 group-hover:bg-red-500 transition-colors"
						>
							<Play class="h-8 w-8 text-white ml-1" />
						</div>
					</div>
					<!-- YouTube branding -->
					<div
						class="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs text-white"
					>
						<svg
							viewBox="0 0 90 20"
							class="h-4 w-auto fill-current"
						>
							<path
								d="M27.973 5.267c-.3-1.135-1.186-2.029-2.312-2.332C23.587 2.4 14.5 2.4 14.5 2.4s-9.087 0-11.16.535c-1.127.303-2.013 1.197-2.313 2.332C.5 7.357.5 11.7.5 11.7s0 4.343.527 6.433c.3 1.135 1.186 1.993 2.312 2.296 2.074.535 11.16.535 11.16.535s9.088 0 11.161-.535c1.126-.303 2.012-1.161 2.312-2.296.528-2.09.528-6.433.528-6.433s0-4.343-.527-6.433zM11.7 15.4V8l7.465 3.7-7.464 3.7z"
							/>
						</svg>
					</div>
				</button>
			{/if}
		{:else if mediaType === 'audio'}
			<!-- Audio embed -->
			<div class="p-4">
				<audio
					src={safeUrl}
					controls
					preload="metadata"
					class="w-full"
				>
					Your browser does not support audio playback.
				</audio>
			</div>
		{:else}
			<!-- Unknown type - show as link -->
			<a
				href={safeUrl}
				target="_blank"
				rel="noopener noreferrer"
				class="flex items-center gap-2 p-4 text-sm text-accent hover:underline"
			>
				<ExternalLink class="h-4 w-4" />
				<span class="truncate">{safeUrl}</span>
			</a>
		{/if}
	</div>
{:else if hasError}
	<!-- Error state -->
	<div
		class="flex items-center gap-2 rounded-lg bg-muted p-4 text-sm text-muted-foreground {className}"
	>
		<ImageOff class="h-4 w-4" />
		<span>Failed to load media</span>
		<a
			href={url}
			target="_blank"
			rel="noopener noreferrer"
			class="text-accent hover:underline"
		>
			Open link
		</a>
	</div>
{/if}
