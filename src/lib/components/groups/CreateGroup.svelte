<script lang="ts">
	import { groupsStore } from '$stores/groups.svelte';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import { Textarea } from '$components/ui/textarea';
	import { Card } from '$components/ui/card';
	import X from 'lucide-svelte/icons/x';
	import Users from 'lucide-svelte/icons/users';
	import ImagePlus from 'lucide-svelte/icons/image-plus';
	import Loader2 from 'lucide-svelte/icons/loader-2';
	import Hash from 'lucide-svelte/icons/hash';

	interface Props {
		onClose: () => void;
		onCreated?: (groupId: string) => void;
	}

	let { onClose, onCreated }: Props = $props();

	let name = $state('');
	let about = $state('');
	let picture = $state('');
	let isCreating = $state(false);
	let error = $state<string | null>(null);

	const canCreate = $derived(name.trim().length >= 2);

	async function handleCreate() {
		if (!canCreate || isCreating) return;

		isCreating = true;
		error = null;

		try {
			const groupId = await groupsStore.createGroup({
				name: name.trim(),
				about: about.trim() || undefined,
				picture: picture.trim() || undefined
			});

			if (groupId) {
				onCreated?.(groupId);
				onClose();
			} else {
				error = 'Failed to create group';
			}
		} catch (e) {
			console.error('Failed to create group:', e);
			error = 'Failed to create group. Please try again.';
		} finally {
			isCreating = false;
		}
	}

	function handleKeyDown(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			onClose();
		}
	}
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
	onclick={(e) => e.target === e.currentTarget && onClose()}
>
	<Card class="w-full max-w-md mx-4 p-0 overflow-hidden">
		<!-- Header -->
		<div class="flex items-center justify-between p-4 border-b border-border">
			<div class="flex items-center gap-2">
				<Users class="h-5 w-5 text-primary" />
				<h2 class="font-semibold">Create Group</h2>
			</div>
			<Button variant="ghost" size="icon" onclick={onClose}>
				<X class="h-5 w-5" />
			</Button>
		</div>

		<!-- Content -->
		<div class="p-4 space-y-4">
			<!-- Preview -->
			<div class="flex items-center gap-4 p-4 bg-muted/30 rounded-lg">
				<div
					class="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden"
				>
					{#if picture}
						<img src={picture} alt="Group" class="w-full h-full object-cover" />
					{:else}
						<Hash class="h-8 w-8 text-primary" />
					{/if}
				</div>
				<div class="flex-1 min-w-0">
					<p class="font-medium truncate">
						{name || 'Group Name'}
					</p>
					{#if about}
						<p class="text-sm text-muted-foreground truncate">{about}</p>
					{:else}
						<p class="text-sm text-muted-foreground">Group description</p>
					{/if}
				</div>
			</div>

			<!-- Name input -->
			<div class="space-y-2">
				<label for="group-name" class="text-sm font-medium">
					Name <span class="text-destructive">*</span>
				</label>
				<Input
					id="group-name"
					bind:value={name}
					placeholder="Enter group name..."
					maxlength={50}
				/>
				<div class="flex justify-end">
					<span class="text-xs text-muted-foreground">{name.length}/50</span>
				</div>
			</div>

			<!-- About input -->
			<div class="space-y-2">
				<label for="group-about" class="text-sm font-medium">
					Description
				</label>
				<Textarea
					id="group-about"
					bind:value={about}
					placeholder="What's this group about? (optional)"
					rows={3}
					maxlength={200}
				/>
				<div class="flex justify-end">
					<span class="text-xs text-muted-foreground">{about.length}/200</span>
				</div>
			</div>

			<!-- Picture URL input -->
			<div class="space-y-2">
				<label for="group-picture" class="text-sm font-medium">
					Picture URL
				</label>
				<div class="flex gap-2">
					<Input
						id="group-picture"
						bind:value={picture}
						placeholder="https://... (optional)"
						class="flex-1"
					/>
					<Button variant="outline" size="icon" disabled>
						<ImagePlus class="h-4 w-4" />
					</Button>
				</div>
				<p class="text-xs text-muted-foreground">
					Enter a direct image URL for the group picture
				</p>
			</div>

			<!-- Info -->
			<div class="p-3 bg-muted/50 rounded-lg">
				<p class="text-xs text-muted-foreground">
					This will create a public group chat visible to everyone on the Nostr network.
					Anyone can join and see the messages.
				</p>
			</div>

			<!-- Error message -->
			{#if error}
				<p class="text-sm text-destructive">{error}</p>
			{/if}
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-end gap-2 p-4 border-t border-border bg-muted/30">
			<Button variant="outline" onclick={onClose} disabled={isCreating}>
				Cancel
			</Button>
			<Button onclick={handleCreate} disabled={!canCreate || isCreating}>
				{#if isCreating}
					<Loader2 class="h-4 w-4 mr-2 animate-spin" />
					Creating...
				{:else}
					Create Group
				{/if}
			</Button>
		</div>
	</Card>
</div>
