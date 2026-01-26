<script lang="ts">
	import { groupsStore, type Group } from '$stores/groups.svelte';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import { Button } from '$components/ui/button';
	import { Badge } from '$components/ui/badge';
	import { Skeleton } from '$components/ui/skeleton';
	import { EmptyState } from '$components/ui/empty-state';
	import { formatRelativeTime } from '$lib/utils';
	import Users from 'lucide-svelte/icons/users';
	import Plus from 'lucide-svelte/icons/plus';
	import Hash from 'lucide-svelte/icons/hash';
	import LogIn from 'lucide-svelte/icons/log-in';
	import LogOut from 'lucide-svelte/icons/log-out';

	interface Props {
		onSelectGroup: (group: Group) => void;
		onCreateGroup: () => void;
	}

	let { onSelectGroup, onCreateGroup }: Props = $props();

	const joinedGroups = $derived(groupsStore.joinedGroups);
	const availableGroups = $derived(groupsStore.availableGroups);
</script>

<div class="flex flex-col h-full">
	<!-- Header -->
	<div class="p-4 border-b border-border flex items-center justify-between">
		<h2 class="font-semibold flex items-center gap-2">
			<Users class="h-5 w-5" />
			Groups
		</h2>
		<Button size="sm" onclick={onCreateGroup}>
			<Plus class="h-4 w-4 mr-1" />
			New
		</Button>
	</div>

	<div class="flex-1 overflow-y-auto">
		{#if groupsStore.isLoading}
			<!-- Loading skeleton -->
			<div class="p-4 space-y-3">
				{#each Array(5) as _}
					<div class="flex items-center gap-3">
						<Skeleton class="h-12 w-12 rounded-full" />
						<div class="flex-1 space-y-2">
							<Skeleton class="h-4 w-32" />
							<Skeleton class="h-3 w-48" />
						</div>
					</div>
				{/each}
			</div>
		{:else}
			<!-- Joined groups -->
			{#if joinedGroups.length > 0}
				<div class="p-2">
					<p class="px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
						Joined
					</p>
					{#each joinedGroups as group (group.id)}
						<button
							class="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors text-left"
							onclick={() => onSelectGroup(group)}
						>
							<Avatar size="md">
								{#if group.picture}
									<AvatarImage src={group.picture} alt="" />
								{/if}
								<AvatarFallback class="bg-primary/10">
									<Hash class="h-5 w-5 text-primary" />
								</AvatarFallback>
							</Avatar>
							<div class="flex-1 min-w-0">
								<div class="flex items-center gap-2">
									<span class="font-medium truncate">{group.name}</span>
								</div>
								{#if group.lastMessage}
									<p class="text-sm text-muted-foreground truncate">
										{group.lastMessage.content}
									</p>
								{:else if group.about}
									<p class="text-sm text-muted-foreground truncate">
										{group.about}
									</p>
								{/if}
							</div>
							{#if group.lastMessage}
								<span class="text-xs text-muted-foreground">
									{formatRelativeTime(group.lastMessage.createdAt)}
								</span>
							{/if}
						</button>
					{/each}
				</div>
			{/if}

			<!-- Available groups -->
			{#if availableGroups.length > 0}
				<div class="p-2 {joinedGroups.length > 0 ? 'border-t border-border' : ''}">
					<p class="px-2 py-1 text-xs font-medium text-muted-foreground uppercase">
						Discover
					</p>
					{#each availableGroups.slice(0, 10) as group (group.id)}
						<div
							class="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
						>
							<Avatar size="md">
								{#if group.picture}
									<AvatarImage src={group.picture} alt="" />
								{/if}
								<AvatarFallback class="bg-muted">
									<Hash class="h-5 w-5 text-muted-foreground" />
								</AvatarFallback>
							</Avatar>
							<div class="flex-1 min-w-0">
								<span class="font-medium truncate block">{group.name}</span>
								{#if group.about}
									<p class="text-sm text-muted-foreground truncate">
										{group.about}
									</p>
								{/if}
							</div>
							<Button
								size="sm"
								variant="outline"
								onclick={() => {
									groupsStore.joinGroup(group.id);
									onSelectGroup(group);
								}}
							>
								<LogIn class="h-4 w-4 mr-1" />
								Join
							</Button>
						</div>
					{/each}
				</div>
			{/if}

			<!-- Empty state -->
			{#if joinedGroups.length === 0 && availableGroups.length === 0}
				<EmptyState
					icon={Users}
					title="No groups yet"
					description="Create a new group or wait for groups to load from the network."
					variant="muted"
					size="md"
					actionLabel="Create Group"
					onAction={onCreateGroup}
				/>
			{/if}
		{/if}
	</div>
</div>
