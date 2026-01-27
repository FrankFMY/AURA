<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { storiesStore, type UserStory } from '$stores/stories.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import Plus from 'lucide-svelte/icons/plus';

	interface Props {
		onViewStory: (userStory: UserStory, startIndex?: number) => void;
		onCreateStory: () => void;
	}

	let { onViewStory, onCreateStory }: Props = $props();

	let cleanupInterval: ReturnType<typeof setInterval> | null = null;

	onMount(async () => {
		await storiesStore.subscribe();

		// Cleanup expired stories periodically
		cleanupInterval = setInterval(() => {
			storiesStore.cleanupExpired();
		}, 60000); // Every minute
	});

	onDestroy(() => {
		storiesStore.unsubscribe();
		if (cleanupInterval) {
			clearInterval(cleanupInterval);
		}
	});

	const sortedStories = $derived(storiesStore.sortedStories);
	const hasOwnStory = $derived(
		authStore.pubkey ? storiesStore.stories.has(authStore.pubkey) : false
	);
</script>

<!-- Only show stories bar when there are actual stories to view -->
{#if sortedStories.length > 0}
	<div class="border-b border-border bg-background/50">
		<div class="flex gap-2 sm:gap-3 overflow-x-auto py-2 px-3 sm:p-3 scrollbar-hide">
			<!-- Create story button (if logged in) -->
			{#if authStore.isAuthenticated}
				<button
					class="flex flex-col items-center gap-0.5 shrink-0"
					onclick={onCreateStory}
				>
					<div class="relative">
						<div
							class="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-muted flex items-center justify-center
								{hasOwnStory ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}"
						>
							{#if hasOwnStory && authStore.profile?.picture}
								<Avatar size="md" class="w-full h-full">
									<AvatarImage src={authStore.profile.picture} alt="" />
									<AvatarFallback>
										{(authStore.profile?.display_name || authStore.profile?.name || 'Y').slice(0, 1).toUpperCase()}
									</AvatarFallback>
								</Avatar>
							{:else}
								<Plus class="h-5 w-5 text-muted-foreground" />
							{/if}
						</div>
						{#if !hasOwnStory}
							<div
								class="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center"
							>
								<Plus class="h-2.5 w-2.5 text-primary-foreground" />
							</div>
						{/if}
					</div>
					<span class="text-[10px] text-muted-foreground truncate w-12 sm:w-14 text-center">
						{hasOwnStory ? 'You' : 'Add'}
					</span>
				</button>
			{/if}

			<!-- User stories -->
			{#each sortedStories as userStory (userStory.pubkey)}
				{#if userStory.pubkey !== authStore.pubkey || !authStore.isAuthenticated}
					<button
						class="flex flex-col items-center gap-0.5 shrink-0"
						onclick={() => onViewStory(userStory)}
					>
						<div
							class="w-12 h-12 sm:w-14 sm:h-14 rounded-full p-0.5
								{userStory.hasUnviewed
								? 'bg-gradient-to-tr from-primary via-purple-500 to-pink-500'
								: 'bg-muted'}"
						>
							<div class="w-full h-full rounded-full bg-background p-0.5">
								<Avatar size="md" class="w-full h-full">
									<AvatarImage src={userStory.profile?.picture} alt="" />
									<AvatarFallback>
										{(userStory.profile?.display_name || userStory.profile?.name || 'A').slice(0, 1).toUpperCase()}
									</AvatarFallback>
								</Avatar>
							</div>
						</div>
						<span class="text-[10px] truncate w-12 sm:w-14 text-center {userStory.hasUnviewed ? 'text-foreground font-medium' : 'text-muted-foreground'}">
							{userStory.profile?.display_name || userStory.profile?.name || 'Anon'}
						</span>
					</button>
				{/if}
			{/each}

			<!-- Loading skeleton -->
			{#if storiesStore.isLoading && sortedStories.length === 0}
				{#each Array(4) as _}
					<div class="flex flex-col items-center gap-0.5 shrink-0 animate-pulse">
						<div class="w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-muted"></div>
						<div class="w-10 h-2 rounded bg-muted"></div>
					</div>
				{/each}
			{/if}
		</div>
	</div>
{/if}

<style>
	.scrollbar-hide {
		-ms-overflow-style: none;
		scrollbar-width: none;
	}
	.scrollbar-hide::-webkit-scrollbar {
		display: none;
	}
</style>
