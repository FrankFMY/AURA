<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { groupsStore, type Group } from '$stores/groups.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { GroupList, GroupChat, CreateGroup } from '$components/groups';
	import { EmptyState } from '$components/ui/empty-state';
	import Users from 'lucide-svelte/icons/users';
	import MessageSquare from 'lucide-svelte/icons/message-square';

	let selectedGroup = $state<Group | null>(null);
	let showCreateGroup = $state(false);
	let isMobile = $state(false);

	// Check screen size for responsive layout
	function checkMobile() {
		isMobile = window.innerWidth < 768;
	}

	onMount(() => {
		checkMobile();
		window.addEventListener('resize', checkMobile);

		// Subscribe to groups
		groupsStore.subscribeToGroups();

		return () => {
			window.removeEventListener('resize', checkMobile);
		};
	});

	onDestroy(() => {
		groupsStore.cleanup();
	});

	function handleSelectGroup(group: Group) {
		selectedGroup = group;
	}

	function handleBack() {
		selectedGroup = null;
	}

	function handleCreateGroup() {
		showCreateGroup = true;
	}

	function handleGroupCreated(groupId: string) {
		// Find the newly created group and select it
		const group = groupsStore.groups.get(groupId);
		if (group) {
			selectedGroup = group;
		}
		showCreateGroup = false;
	}
</script>

<svelte:head>
	<title>Groups | AURA</title>
</svelte:head>

<div class="h-[calc(100vh-4rem)] md:h-screen flex">
	{#if !authStore.isAuthenticated}
		<!-- Not logged in state -->
		<div class="flex-1 flex items-center justify-center p-4">
			<EmptyState
				icon={Users}
				title="Sign in to view groups"
				description="Join public groups and chat with communities on Nostr."
				variant="muted"
				size="lg"
			/>
		</div>
	{:else}
		<!-- Desktop: two-panel layout -->
		{#if !isMobile}
			<!-- Groups list sidebar -->
			<div class="w-80 border-r border-border flex flex-col bg-background">
				<GroupList
					onSelectGroup={handleSelectGroup}
					onCreateGroup={handleCreateGroup}
				/>
			</div>

			<!-- Chat area -->
			<div class="flex-1 flex flex-col bg-background">
				{#if selectedGroup}
					<GroupChat
						group={selectedGroup}
						onBack={handleBack}
					/>
				{:else}
					<div class="flex-1 flex items-center justify-center p-4">
						<EmptyState
							icon={MessageSquare}
							title="Select a group"
							description="Choose a group from the list or create a new one to start chatting."
							variant="muted"
							size="md"
							actionLabel="Create Group"
							onAction={handleCreateGroup}
						/>
					</div>
				{/if}
			</div>
		{:else}
			<!-- Mobile: single-panel layout -->
			{#if selectedGroup}
				<div class="flex-1 flex flex-col">
					<GroupChat
						group={selectedGroup}
						onBack={handleBack}
					/>
				</div>
			{:else}
				<div class="flex-1 flex flex-col">
					<GroupList
						onSelectGroup={handleSelectGroup}
						onCreateGroup={handleCreateGroup}
					/>
				</div>
			{/if}
		{/if}
	{/if}
</div>

<!-- Create Group Modal -->
{#if showCreateGroup}
	<CreateGroup
		onClose={() => (showCreateGroup = false)}
		onCreated={handleGroupCreated}
	/>
{/if}
