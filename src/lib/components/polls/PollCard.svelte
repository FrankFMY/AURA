<script lang="ts">
	import { pollsStore, type Poll } from '$stores/polls.svelte';
	import { authStore } from '$stores/auth.svelte';
	import { Button } from '$components/ui/button';
	import { Card } from '$components/ui/card';
	import { Badge } from '$components/ui/badge';
	import BarChart from 'lucide-svelte/icons/bar-chart';
	import Clock from 'lucide-svelte/icons/clock';
	import Check from 'lucide-svelte/icons/check';
	import Users from 'lucide-svelte/icons/users';

	interface Props {
		poll: Poll;
		compact?: boolean;
	}

	let { poll, compact = false }: Props = $props();

	let isVoting = $state(false);
	let selectedOption = $state<number | null>(null);

	const hasVoted = $derived(poll.userVote !== undefined);
	const canVote = $derived(!poll.isClosed && !hasVoted && authStore.isAuthenticated);
	const showResults = $derived(hasVoted || poll.isClosed);

	// Format remaining time
	const remainingTime = $derived(() => {
		if (!poll.endsAt) return null;

		const now = Math.floor(Date.now() / 1000);
		const diff = poll.endsAt - now;

		if (diff <= 0) return 'Ended';

		const hours = Math.floor(diff / 3600);
		const minutes = Math.floor((diff % 3600) / 60);

		if (hours > 24) {
			const days = Math.floor(hours / 24);
			return `${days}d left`;
		}
		if (hours > 0) {
			return `${hours}h ${minutes}m left`;
		}
		return `${minutes}m left`;
	});

	async function handleVote() {
		if (selectedOption === null || !canVote) return;

		isVoting = true;
		try {
			await pollsStore.vote(poll.id, selectedOption);
		} catch (e) {
			console.error('Failed to vote:', e);
		} finally {
			isVoting = false;
			selectedOption = null;
		}
	}

	function selectOption(index: number) {
		if (!canVote) return;
		selectedOption = selectedOption === index ? null : index;
	}
</script>

<Card class="p-4 {compact ? 'text-sm' : ''}">
	<!-- Header -->
	<div class="flex items-start justify-between gap-2 mb-3">
		<div class="flex items-center gap-2 text-muted-foreground">
			<BarChart class="h-4 w-4 text-primary" />
			<span class="text-xs font-medium">Poll</span>
		</div>
		{#if poll.endsAt}
			<Badge variant={poll.isClosed ? 'secondary' : 'outline'} class="text-xs">
				<Clock class="h-3 w-3 mr-1" />
				{remainingTime()}
			</Badge>
		{/if}
	</div>

	<!-- Question -->
	<p class="font-medium mb-4 {compact ? 'text-sm' : ''}">{poll.question}</p>

	<!-- Options -->
	<div class="space-y-2">
		{#each poll.options as option}
			{@const percentage = pollsStore.getVotePercentage(poll, option.index)}
			{@const isSelected = selectedOption === option.index}
			{@const isUserVote = poll.userVote === option.index}

			{#if showResults}
				<!-- Results view -->
				<div class="relative overflow-hidden rounded-lg border border-border">
					<!-- Progress bar background -->
					<div
						class="absolute inset-0 bg-primary/10 transition-all duration-500"
						style="width: {percentage}%"
					></div>

					<!-- Content -->
					<div class="relative flex items-center justify-between p-3">
						<div class="flex items-center gap-2">
							{#if isUserVote}
								<Check class="h-4 w-4 text-primary" />
							{/if}
							<span class={isUserVote ? 'font-medium' : ''}>{option.text}</span>
						</div>
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium">{percentage}%</span>
							<span class="text-xs text-muted-foreground">
								({option.votes})
							</span>
						</div>
					</div>
				</div>
			{:else}
				<!-- Voting view -->
				<button
					class="w-full p-3 rounded-lg border transition-all text-left
						{isSelected
						? 'border-primary bg-primary/5 ring-1 ring-primary'
						: 'border-border hover:border-primary/50 hover:bg-muted/50'}"
					onclick={() => selectOption(option.index)}
					disabled={!canVote}
				>
					<div class="flex items-center gap-2">
						<span
							class="w-5 h-5 rounded-full border-2 flex items-center justify-center
								{isSelected ? 'border-primary bg-primary' : 'border-muted-foreground'}"
						>
							{#if isSelected}
								<Check class="h-3 w-3 text-primary-foreground" />
							{/if}
						</span>
						<span>{option.text}</span>
					</div>
				</button>
			{/if}
		{/each}
	</div>

	<!-- Footer -->
	<div class="flex items-center justify-between mt-4 pt-3 border-t border-border">
		<div class="flex items-center gap-1 text-muted-foreground text-xs">
			<Users class="h-3 w-3" />
			<span>
				{poll.totalVotes}
				{poll.totalVotes === 1 ? 'vote' : 'votes'}
			</span>
		</div>

		{#if canVote && selectedOption !== null}
			<Button size="sm" onclick={handleVote} disabled={isVoting}>
				{#if isVoting}
					Voting...
				{:else}
					Vote
				{/if}
			</Button>
		{:else if !authStore.isAuthenticated}
			<span class="text-xs text-muted-foreground">Login to vote</span>
		{:else if poll.isClosed}
			<Badge variant="secondary">Closed</Badge>
		{:else if hasVoted}
			<span class="text-xs text-muted-foreground">You voted</span>
		{/if}
	</div>
</Card>
