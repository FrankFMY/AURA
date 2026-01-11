<script lang="ts">
	import {
		notificationsStore,
		type Toast,
		type NotificationType,
	} from '$stores/notifications.svelte';
	import { cn } from '$lib/utils';
	import X from 'lucide-svelte/icons/x';
	import CheckCircle from 'lucide-svelte/icons/check-circle';
	import AlertCircle from 'lucide-svelte/icons/alert-circle';
	import AlertTriangle from 'lucide-svelte/icons/alert-triangle';
	import Info from 'lucide-svelte/icons/info';

	interface Props {
		toast: Toast;
	}

	let { toast }: Props = $props();

	const icons: Record<NotificationType, typeof Info> = {
		info: Info,
		success: CheckCircle,
		warning: AlertTriangle,
		error: AlertCircle,
	};

	const styles: Record<NotificationType, string> = {
		info: 'bg-card/95 backdrop-blur-sm border-border text-foreground shadow-lg',
		success:
			'bg-success/10 backdrop-blur-sm border-success/40 text-success shadow-lg shadow-success/10',
		warning:
			'bg-warning/10 backdrop-blur-sm border-warning/40 text-warning shadow-lg shadow-warning/10',
		error: 'bg-destructive/10 backdrop-blur-sm border-destructive/40 text-destructive shadow-lg shadow-destructive/10',
	};

	const Icon = $derived(icons[toast.type]);

	function handleDismiss() {
		notificationsStore.removeToast(toast.id);
	}
</script>

<div
	class={cn(
		'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border p-4 shadow-lg transition-all duration-300',
		'animate-in slide-in-from-top-2 fade-in-0',
		styles[toast.type],
	)}
	role="alert"
	aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
>
	<Icon class="h-5 w-5 shrink-0 mt-0.5" />

	<div class="flex-1 min-w-0">
		<p class="font-medium text-sm">{toast.title}</p>
		{#if toast.message}
			<p class="mt-1 text-sm opacity-90">{toast.message}</p>
		{/if}
		{#if toast.action}
			<button
				class="mt-2 text-sm font-medium underline-offset-4 hover:underline"
				onclick={toast.action.onClick}
			>
				{toast.action.label}
			</button>
		{/if}
	</div>

	{#if toast.dismissible}
		<button
			class="shrink-0 rounded-md p-1 opacity-70 transition-opacity hover:opacity-100"
			onclick={handleDismiss}
			aria-label="Dismiss notification"
		>
			<X class="h-4 w-4" />
		</button>
	{/if}
</div>
