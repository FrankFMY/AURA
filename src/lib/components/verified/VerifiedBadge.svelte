<script lang="ts">
	import { onMount } from 'svelte';
	import { verifyNIP05, getCachedVerification, loadCachedVerification, type NIP05VerificationResult } from '$lib/services/nip05';
	import BadgeCheck from 'lucide-svelte/icons/badge-check';

	interface Props {
		/** NIP-05 identifier (e.g., "bob@example.com") */
		nip05: string;
		/** Pubkey to verify against */
		pubkey: string;
		/** Size of the badge */
		size?: 'sm' | 'md' | 'lg';
		/** Whether to show the identifier text */
		showIdentifier?: boolean;
		/** Additional CSS classes */
		class?: string;
	}

	let {
		nip05,
		pubkey,
		size = 'sm',
		showIdentifier = false,
		class: className = ''
	}: Props = $props();

	let verification = $state<NIP05VerificationResult | null>(null);
	let isLoading = $state(true);

	const sizeClasses = {
		sm: 'h-3.5 w-3.5',
		md: 'h-4 w-4',
		lg: 'h-5 w-5'
	};

	const textSizeClasses = {
		sm: 'text-xs',
		md: 'text-sm',
		lg: 'text-base'
	};

	onMount(async () => {
		// First check in-memory cache (sync)
		const cached = getCachedVerification(nip05, pubkey);
		if (cached) {
			verification = cached;
			isLoading = false;
			return;
		}

		// Then check IndexedDB cache
		const stored = await loadCachedVerification(nip05, pubkey);
		if (stored) {
			verification = stored;
			isLoading = false;
			return;
		}

		// Finally, verify remotely
		isLoading = false; // Show unverified while loading
		const result = await verifyNIP05(nip05, pubkey);
		verification = result;
	});

	const isVerified = $derived(verification?.verified === true);
</script>

{#if isVerified}
	<span
		class="inline-flex items-center gap-1 text-accent {className}"
		title="Verified: {nip05}"
		aria-label="Verified user: {nip05}"
	>
		<BadgeCheck class="{sizeClasses[size]} fill-accent/20" />
		{#if showIdentifier}
			<span class="{textSizeClasses[size]} text-muted-foreground truncate max-w-32">
				{nip05}
			</span>
		{/if}
	</span>
{:else if showIdentifier && nip05}
	<!-- Show identifier even if not verified (useful for profile pages) -->
	<span
		class="inline-flex items-center gap-1 text-muted-foreground {className}"
		title="Unverified: {nip05}"
	>
		<span class="{textSizeClasses[size]} truncate max-w-32">
			{nip05}
		</span>
	</span>
{/if}
