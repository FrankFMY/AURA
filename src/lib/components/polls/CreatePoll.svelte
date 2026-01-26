<script lang="ts">
	import { pollsStore } from '$stores/polls.svelte';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import { Card } from '$components/ui/card';
	import X from 'lucide-svelte/icons/x';
	import Plus from 'lucide-svelte/icons/plus';
	import BarChart from 'lucide-svelte/icons/bar-chart';
	import Clock from 'lucide-svelte/icons/clock';

	interface Props {
		onClose: () => void;
		onCreated?: (pollId: string) => void;
	}

	let { onClose, onCreated }: Props = $props();

	let question = $state('');
	let options = $state<string[]>(['', '']);
	let hasEndTime = $state(false);
	let endTime = $state('');
	let isCreating = $state(false);
	let error = $state<string | null>(null);

	const maxOptions = 4;
	const minOptions = 2;

	function addOption() {
		if (options.length < maxOptions) {
			options = [...options, ''];
		}
	}

	function removeOption(index: number) {
		if (options.length > minOptions) {
			options = options.filter((_, i) => i !== index);
		}
	}

	function updateOption(index: number, value: string) {
		const newOptions = [...options];
		newOptions[index] = value;
		options = newOptions;
	}

	function validateForm(): boolean {
		if (!question.trim()) {
			error = 'Please enter a question';
			return false;
		}

		const validOptions = options.filter((o) => o.trim());
		if (validOptions.length < minOptions) {
			error = `Please enter at least ${minOptions} options`;
			return false;
		}

		if (hasEndTime && !endTime) {
			error = 'Please select an end time';
			return false;
		}

		error = null;
		return true;
	}

	async function handleCreate() {
		if (!validateForm()) return;

		isCreating = true;
		error = null;

		try {
			const validOptions = options.filter((o) => o.trim());
			let endsAt: number | undefined;

			if (hasEndTime && endTime) {
				endsAt = Math.floor(new Date(endTime).getTime() / 1000);
			}

			const pollId = await pollsStore.createPoll({
				question: question.trim(),
				options: validOptions,
				endsAt
			});

			if (pollId) {
				onCreated?.(pollId);
				onClose();
			} else {
				error = 'Failed to create poll';
			}
		} catch (e) {
			console.error('Failed to create poll:', e);
			error = 'Failed to create poll';
		} finally {
			isCreating = false;
		}
	}

	// Get minimum datetime for end time (now + 1 hour)
	const minEndTime = $derived(() => {
		const date = new Date();
		date.setHours(date.getHours() + 1);
		return date.toISOString().slice(0, 16);
	});
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
	onclick={(e) => e.target === e.currentTarget && onClose()}
>
	<Card class="w-full max-w-md mx-4 p-0 overflow-hidden">
		<!-- Header -->
		<div class="flex items-center justify-between p-4 border-b border-border">
			<div class="flex items-center gap-2">
				<BarChart class="h-5 w-5 text-primary" />
				<h2 class="font-semibold">Create Poll</h2>
			</div>
			<Button variant="ghost" size="icon" onclick={onClose}>
				<X class="h-5 w-5" />
			</Button>
		</div>

		<!-- Content -->
		<div class="p-4 space-y-4">
			<!-- Question -->
			<div>
				<label for="poll-question" class="text-sm font-medium mb-1.5 block">
					Question
				</label>
				<Input
					id="poll-question"
					bind:value={question}
					placeholder="Ask a question..."
					maxlength={280}
				/>
			</div>

			<!-- Options -->
			<div>
				<span class="text-sm font-medium mb-1.5 block">
					Options ({options.length}/{maxOptions})
				</span>
				<div class="space-y-2">
					{#each options as option, index}
						<div class="flex items-center gap-2">
							<span
								class="w-6 h-6 flex items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-medium"
							>
								{index + 1}
							</span>
							<Input
								value={option}
								oninput={(e) => updateOption(index, e.currentTarget.value)}
								placeholder={`Option ${index + 1}`}
								maxlength={100}
								class="flex-1"
							/>
							{#if options.length > minOptions}
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 text-muted-foreground hover:text-destructive"
									onclick={() => removeOption(index)}
								>
									<X class="h-4 w-4" />
								</Button>
							{/if}
						</div>
					{/each}
				</div>

				{#if options.length < maxOptions}
					<Button
						variant="ghost"
						size="sm"
						class="mt-2 text-primary"
						onclick={addOption}
					>
						<Plus class="h-4 w-4 mr-1" />
						Add option
					</Button>
				{/if}
			</div>

			<!-- End time -->
			<div>
				<label class="flex items-center gap-2 cursor-pointer">
					<input
						type="checkbox"
						bind:checked={hasEndTime}
						class="w-4 h-4 rounded border-border"
					/>
					<Clock class="h-4 w-4 text-muted-foreground" />
					<span class="text-sm">Set end time</span>
				</label>

				{#if hasEndTime}
					<Input
						type="datetime-local"
						bind:value={endTime}
						min={minEndTime()}
						class="mt-2"
					/>
				{/if}
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
			<Button onclick={handleCreate} disabled={isCreating}>
				{#if isCreating}
					Creating...
				{:else}
					Create Poll
				{/if}
			</Button>
		</div>
	</Card>
</div>
