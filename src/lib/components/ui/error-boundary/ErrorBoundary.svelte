<script lang="ts">
	import { _ } from 'svelte-i18n';
	import { Button } from '$components/ui/button';
	import AlertTriangle from 'lucide-svelte/icons/alert-triangle';
	import RefreshCw from 'lucide-svelte/icons/refresh-cw';
	import type { Snippet } from 'svelte';

	interface Props {
		children: Snippet;
		fallback?: Snippet<[Error, () => void]>;
		onError?: (error: Error) => void;
	}

	let { children, fallback, onError }: Props = $props();

	let error = $state<Error | null>(null);

	function handleError(err: unknown) {
		const errorObj = err instanceof Error ? err : new Error(String(err));
		error = errorObj;
		onError?.(errorObj);
		console.error('[ErrorBoundary] Caught error:', errorObj);
	}

	function reset() {
		error = null;
	}
</script>

<svelte:boundary onerror={handleError}>
	{#if error}
		{#if fallback}
			{@render fallback(error, reset)}
		{:else}
			<div class="flex flex-col items-center justify-center p-8 text-center">
				<div class="rounded-full bg-destructive/10 p-4 mb-4">
					<AlertTriangle class="h-8 w-8 text-destructive" />
				</div>
				<h3 class="text-lg font-semibold mb-2">{$_('errors.generic')}</h3>
				<p class="text-sm text-muted-foreground mb-4 max-w-md">
					{error.message || $_('errors.generic')}
				</p>
				<Button variant="outline" onclick={reset}>
					<RefreshCw class="h-4 w-4 mr-2" />
					{$_('common.retry')}
				</Button>
			</div>
		{/if}
	{:else}
		{@render children()}
	{/if}
</svelte:boundary>
