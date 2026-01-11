<script lang="ts">
	import { authStore } from '$stores/auth.svelte';
	import { walletStore } from '$stores/wallet.svelte';
	import ndkService from '$services/ndk';
	import { db, dbHelpers } from '$db';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import {
		Card,
		CardHeader,
		CardTitle,
		CardDescription,
		CardContent,
		CardFooter,
	} from '$components/ui/card';
	import { Badge } from '$components/ui/badge';
	import { Avatar, AvatarImage, AvatarFallback } from '$components/ui/avatar';
	import Settings from 'lucide-svelte/icons/settings';
	import User from 'lucide-svelte/icons/user';
	import Server from 'lucide-svelte/icons/server';
	import Database from 'lucide-svelte/icons/database';
	import Trash2 from 'lucide-svelte/icons/trash-2';
	import Plus from 'lucide-svelte/icons/plus';
	import Check from 'lucide-svelte/icons/check';
	import X from 'lucide-svelte/icons/x';
	import Shield from 'lucide-svelte/icons/shield';
	import Globe from 'lucide-svelte/icons/globe';
	import { onMount } from 'svelte';

	let relays = $state<
		Array<{
			url: string;
			connected: boolean;
			read: boolean;
			write: boolean;
		}>
	>([]);
	let newRelayUrl = $state('');
	let dbStats = $state<{
		events: number;
		profiles: number;
		conversations: number;
	} | null>(null);

	onMount(async () => {
		// Load relays
		const storedRelays = await db.relays.toArray();
		relays =
			storedRelays.length > 0 ?
				storedRelays
			:	ndkService.connectedRelays.map((url) => ({
					url,
					connected: true,
					read: true,
					write: true,
				}));

		// Load DB stats
		dbStats = await dbHelpers.getStats();
	});

	async function addRelay() {
		if (!newRelayUrl.trim() || !newRelayUrl.startsWith('wss://')) return;

		try {
			await ndkService.addRelay(newRelayUrl);
			relays = [
				...relays,
				{ url: newRelayUrl, connected: false, read: true, write: true },
			];
			newRelayUrl = '';
		} catch (e) {
			console.error('Failed to add relay:', e);
		}
	}

	async function removeRelay(url: string) {
		await ndkService.removeRelay(url);
		relays = relays.filter((r) => r.url !== url);
	}

	async function clearCache() {
		if (!confirm('This will clear all cached data. Continue?')) return;

		await db.events.clear();
		await db.profiles.clear();
		dbStats = await dbHelpers.getStats();
	}

	async function cleanupOldData() {
		const deleted = await dbHelpers.cleanupOldEvents();
		alert(`Cleaned up ${deleted} old events`);
		dbStats = await dbHelpers.getStats();
	}

	const avatarInitials = $derived(
		(authStore.displayName || 'A').slice(0, 2).toUpperCase(),
	);
</script>

<svelte:head>
	<title>Settings | AURA</title>
</svelte:head>

<div class="min-h-screen pb-16 md:pb-0">
	<header
		class="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur"
	>
		<div class="flex h-14 items-center px-4">
			<h1 class="text-xl font-bold">Settings</h1>
		</div>
	</header>

	<div class="mx-auto max-w-2xl space-y-6 p-4">
		<!-- Profile -->
		<Card>
			<CardHeader>
				<div class="flex items-center gap-2">
					<User class="h-5 w-5" />
					<CardTitle>Profile</CardTitle>
				</div>
				<CardDescription>Your Nostr identity</CardDescription>
			</CardHeader>
			<CardContent>
				{#if authStore.isAuthenticated}
					<div class="flex items-center gap-4">
						<Avatar size="xl">
							<AvatarImage src={authStore.avatar} />
							<AvatarFallback>{avatarInitials}</AvatarFallback>
						</Avatar>
						<div>
							<p class="text-lg font-semibold">
								{authStore.displayName}
							</p>
							<p class="font-mono text-sm text-muted-foreground">
								{authStore.npub?.slice(0, 20)}...
							</p>
							{#if authStore.profile?.nip05}
								<Badge
									variant="success"
									class="mt-1"
								>
									<Check class="mr-1 h-3 w-3" />
									{authStore.profile.nip05}
								</Badge>
							{/if}
						</div>
					</div>
				{:else}
					<p class="text-muted-foreground">Not logged in</p>
				{/if}
			</CardContent>
			{#if authStore.isAuthenticated}
				<CardFooter>
					<Button
						variant="outline"
						href="/profile/{authStore.pubkey}"
					>
						Edit Profile
					</Button>
				</CardFooter>
			{/if}
		</Card>

		<!-- Relays -->
		<Card>
			<CardHeader>
				<div class="flex items-center gap-2">
					<Server class="h-5 w-5" />
					<CardTitle>Relays</CardTitle>
				</div>
				<CardDescription
					>Manage your Nostr relay connections</CardDescription
				>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="flex gap-2">
					<Input
						bind:value={newRelayUrl}
						placeholder="wss://relay.example.com"
						class="font-mono text-sm"
					/>
					<Button
						variant="outline"
						onclick={addRelay}
						disabled={!newRelayUrl.startsWith('wss://')}
					>
						<Plus class="h-4 w-4" />
					</Button>
				</div>

				<div class="space-y-2">
					{#each relays as relay (relay.url)}
						<div
							class="flex items-center justify-between rounded-lg border border-border p-3"
						>
							<div class="flex items-center gap-3">
								<div
									class="h-2 w-2 rounded-full {(
										relay.connected
									) ?
										'bg-success'
									:	'bg-muted'}"
								></div>
								<span class="font-mono text-sm"
									>{relay.url}</span
								>
							</div>
							<div class="flex items-center gap-2">
								<Badge
									variant={relay.read ? 'default' : 'outline'}
									class="text-xs"
								>
									R
								</Badge>
								<Badge
									variant={relay.write ? 'default' : (
										'outline'
									)}
									class="text-xs"
								>
									W
								</Badge>
								<Button
									variant="ghost"
									size="icon"
									class="h-8 w-8 text-muted-foreground hover:text-destructive"
									onclick={() => removeRelay(relay.url)}
								>
									<X class="h-4 w-4" />
								</Button>
							</div>
						</div>
					{/each}
				</div>

				<p class="text-xs text-muted-foreground">
					Connected to {ndkService.connectedRelays.length} relays
				</p>
			</CardContent>
		</Card>

		<!-- Data & Storage -->
		<Card>
			<CardHeader>
				<div class="flex items-center gap-2">
					<Database class="h-5 w-5" />
					<CardTitle>Data & Storage</CardTitle>
				</div>
				<CardDescription>Manage cached data</CardDescription>
			</CardHeader>
			<CardContent>
				{#if dbStats}
					<div class="mb-4 grid grid-cols-3 gap-4">
						<div class="rounded-lg bg-muted p-3 text-center">
							<p class="text-2xl font-bold">{dbStats.events}</p>
							<p class="text-xs text-muted-foreground">Events</p>
						</div>
						<div class="rounded-lg bg-muted p-3 text-center">
							<p class="text-2xl font-bold">{dbStats.profiles}</p>
							<p class="text-xs text-muted-foreground">
								Profiles
							</p>
						</div>
						<div class="rounded-lg bg-muted p-3 text-center">
							<p class="text-2xl font-bold">
								{dbStats.conversations}
							</p>
							<p class="text-xs text-muted-foreground">
								Conversations
							</p>
						</div>
					</div>
				{/if}
			</CardContent>
			<CardFooter class="flex gap-3">
				<Button
					variant="outline"
					onclick={cleanupOldData}
				>
					Clean Old Data
				</Button>
				<Button
					variant="destructive"
					onclick={clearCache}
				>
					<Trash2 class="h-4 w-4" />
					Clear All Cache
				</Button>
			</CardFooter>
		</Card>

		<!-- Privacy -->
		<Card>
			<CardHeader>
				<div class="flex items-center gap-2">
					<Shield class="h-5 w-5" />
					<CardTitle>Privacy</CardTitle>
				</div>
				<CardDescription>Your data stays on your device</CardDescription
				>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="flex items-start gap-3 rounded-lg bg-muted p-4">
					<Globe class="mt-0.5 h-5 w-5 text-primary" />
					<div>
						<p class="font-medium">No Central Server</p>
						<p class="text-sm text-muted-foreground">
							AURA doesn't have a backend server. Your data is
							stored locally and synced directly with Nostr
							relays. We can't see your messages or activity.
						</p>
					</div>
				</div>
				<div class="flex items-start gap-3 rounded-lg bg-muted p-4">
					<Shield class="mt-0.5 h-5 w-5 text-success" />
					<div>
						<p class="font-medium">End-to-End Encryption</p>
						<p class="text-sm text-muted-foreground">
							Direct messages are encrypted using NIP-44. Only you
							and the recipient can read them.
						</p>
					</div>
				</div>
			</CardContent>
		</Card>

		<!-- About -->
		<Card>
			<CardHeader>
				<CardTitle>About AURA</CardTitle>
			</CardHeader>
			<CardContent class="space-y-2 text-sm text-muted-foreground">
				<p>Version: 0.1.0 (Beta)</p>
				<p>
					Built with
					<a
						href="https://svelte.dev"
						target="_blank"
						rel="noopener"
						class="text-accent hover:underline"
					>
						SvelteKit
					</a>
					and
					<a
						href="https://nostr.com"
						target="_blank"
						rel="noopener"
						class="text-accent hover:underline"
					>
						Nostr
					</a>
				</p>
				<p>
					<a
						href="https://github.com/your-repo/aura"
						target="_blank"
						rel="noopener"
						class="text-accent hover:underline"
					>
						View Source Code
					</a>
				</p>
			</CardContent>
		</Card>
	</div>
</div>
