<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { storiesStore, type UserStory, type StoryItem } from '$stores/stories.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { formatRelativeTime } from '$lib/utils';
	import X from 'lucide-svelte/icons/x';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import Pause from 'lucide-svelte/icons/pause';
	import Play from 'lucide-svelte/icons/play';

	interface Props {
		userStory: UserStory;
		startIndex?: number;
		onClose: () => void;
		onNext?: () => void;
		onPrev?: () => void;
	}

	let { userStory, startIndex = 0, onClose, onNext, onPrev }: Props = $props();

	let currentIndex = $state(startIndex);
	let progress = $state(0);
	let isPaused = $state(false);
	let progressInterval: ReturnType<typeof setInterval> | null = null;

	const STORY_VIEW_DURATION = 5000; // 5 seconds per story
	const PROGRESS_UPDATE_INTERVAL = 50; // Update progress every 50ms

	const currentItem = $derived(userStory.items[currentIndex]);
	const displayName = $derived(
		userStory.profile?.display_name || userStory.profile?.name || 'Anonymous'
	);

	function startProgress() {
		if (progressInterval) {
			clearInterval(progressInterval);
		}

		progress = 0;
		const increment = 100 / (STORY_VIEW_DURATION / PROGRESS_UPDATE_INTERVAL);

		progressInterval = setInterval(() => {
			if (isPaused) return;

			progress += increment;

			if (progress >= 100) {
				goToNext();
			}
		}, PROGRESS_UPDATE_INTERVAL);
	}

	function stopProgress() {
		if (progressInterval) {
			clearInterval(progressInterval);
			progressInterval = null;
		}
	}

	function goToNext() {
		if (currentIndex < userStory.items.length - 1) {
			currentIndex++;
			startProgress();
		} else if (onNext) {
			onNext();
		} else {
			onClose();
		}
	}

	function goToPrev() {
		if (currentIndex > 0) {
			currentIndex--;
			startProgress();
		} else if (onPrev) {
			onPrev();
		}
	}

	function togglePause() {
		isPaused = !isPaused;
	}

	function handleKeydown(e: KeyboardEvent) {
		switch (e.key) {
			case 'ArrowRight':
			case ' ':
				goToNext();
				break;
			case 'ArrowLeft':
				goToPrev();
				break;
			case 'Escape':
				onClose();
				break;
			case 'p':
				togglePause();
				break;
		}
	}

	function handleTouchArea(e: MouseEvent) {
		const target = e.currentTarget as HTMLElement;
		const rect = target.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const third = rect.width / 3;

		if (x < third) {
			goToPrev();
		} else if (x > third * 2) {
			goToNext();
		} else {
			togglePause();
		}
	}

	// Mark story as viewed
	$effect(() => {
		if (currentItem) {
			storiesStore.markViewed(currentItem.id);
		}
	});

	onMount(() => {
		startProgress();
		document.addEventListener('keydown', handleKeydown);
	});

	onDestroy(() => {
		stopProgress();
		document.removeEventListener('keydown', handleKeydown);
	});
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="fixed inset-0 z-50 bg-black flex items-center justify-center">
	<!-- Progress bars -->
	<div class="absolute top-0 left-0 right-0 flex gap-1 p-2 z-10">
		{#each userStory.items as item, index (item.id)}
			<div class="flex-1 h-0.5 bg-white/30 rounded-full overflow-hidden">
				<div
					class="h-full bg-white transition-all duration-50"
					style="width: {index < currentIndex ? 100 : index === currentIndex ? progress : 0}%"
				></div>
			</div>
		{/each}
	</div>

	<!-- Header -->
	<div class="absolute top-4 left-0 right-0 flex items-center justify-between px-4 z-10">
		<a href="/profile/{userStory.pubkey}" class="flex items-center gap-3">
			<Avatar size="sm">
				<AvatarImage src={userStory.profile?.picture} alt="" />
				<AvatarFallback>
					{displayName.slice(0, 1).toUpperCase()}
				</AvatarFallback>
			</Avatar>
			<div class="text-white">
				<p class="font-medium text-sm">{displayName}</p>
				{#if currentItem}
					<p class="text-xs text-white/60">
						{formatRelativeTime(currentItem.createdAt)} · {storiesStore.getTimeRemaining(currentItem.expiresAt)}
					</p>
				{/if}
			</div>
		</a>

		<div class="flex items-center gap-2">
			<Button
				variant="ghost"
				size="icon"
				class="text-white hover:bg-white/20"
				onclick={togglePause}
			>
				{#if isPaused}
					<Play class="h-5 w-5" />
				{:else}
					<Pause class="h-5 w-5" />
				{/if}
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="text-white hover:bg-white/20"
				onclick={onClose}
			>
				<X class="h-5 w-5" />
			</Button>
		</div>
	</div>

	<!-- Story content -->
	{#if currentItem}
		<div
			class="relative w-full h-full flex items-center justify-center cursor-pointer"
			onclick={handleTouchArea}
		>
			{#if currentItem.contentType === 'image' && currentItem.mediaUrl}
				<img
					src={currentItem.mediaUrl}
					alt=""
					class="max-w-full max-h-full object-contain"
				/>
			{:else if currentItem.contentType === 'video' && currentItem.mediaUrl}
				<!-- svelte-ignore a11y_media_has_caption -->
				<video
					src={currentItem.mediaUrl}
					class="max-w-full max-h-full object-contain"
					autoplay
					loop
					muted={false}
					playsinline
				></video>
			{:else}
				<!-- Text story -->
				<div class="max-w-md p-8 text-center">
					<p class="text-white text-2xl font-medium leading-relaxed">
						{currentItem.content}
					</p>
				</div>
			{/if}

			<!-- Caption overlay for media stories -->
			{#if (currentItem.contentType === 'image' || currentItem.contentType === 'video') && currentItem.content && !currentItem.content.startsWith('http')}
				<div class="absolute bottom-20 left-0 right-0 p-4 bg-gradient-to-t from-black/60 to-transparent">
					<p class="text-white text-center">{currentItem.content}</p>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Navigation buttons (desktop) -->
	<div class="hidden md:flex absolute left-4 top-1/2 -translate-y-1/2">
		{#if currentIndex > 0 || onPrev}
			<Button
				variant="ghost"
				size="icon"
				class="text-white hover:bg-white/20 w-12 h-12"
				onclick={goToPrev}
			>
				<ChevronLeft class="h-8 w-8" />
			</Button>
		{/if}
	</div>

	<div class="hidden md:flex absolute right-4 top-1/2 -translate-y-1/2">
		<Button
			variant="ghost"
			size="icon"
			class="text-white hover:bg-white/20 w-12 h-12"
			onclick={goToNext}
		>
			<ChevronRight class="h-8 w-8" />
		</Button>
	</div>
</div>
