<script lang="ts">
	import { notificationsStore } from '$stores/notifications.svelte';
	import Toast from './Toast.svelte';
</script>

<!-- Toast Container - Fixed position at top right -->
<div
	class="fixed top-4 right-4 z-100 flex flex-col gap-2 pointer-events-none"
	aria-label="Notifications"
	role="region"
>
	{#each notificationsStore.toasts as toast (toast.id)}
		<Toast {toast} />
	{/each}
</div>
