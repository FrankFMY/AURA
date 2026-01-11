<script lang="ts">
	import { authStore } from '$stores/auth.svelte';
	import { profileStore } from '$stores/profile.svelte';
	import { walletStore } from '$stores/wallet.svelte';
	import ndkService from '$services/ndk';
	import { db, dbHelpers } from '$db';
	import { Button } from '$components/ui/button';
	import { Input } from '$components/ui/input';
	import { Textarea } from '$components/ui/textarea';
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
	import { Spinner } from '$components/ui/spinner';
	import { notificationsStore } from '$stores/notifications.svelte';
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
	import Save from 'lucide-svelte/icons/save';
	import RotateCcw from 'lucide-svelte/icons/rotate-ccw';
	import Image from 'lucide-svelte/icons/image';
	import AlertTriangle from 'lucide-svelte/icons/alert-triangle';
	import Zap from 'lucide-svelte/icons/zap';
	import Heart from 'lucide-svelte/icons/heart';
	import Coffee from 'lucide-svelte/icons/coffee';
	import Volume2 from 'lucide-svelte/icons/volume-2';
	import VolumeX from 'lucide-svelte/icons/volume-x';
	import { onMount } from 'svelte';
	import {
		setSoundsEnabled,
		isSoundsEnabled,
		initAudioService,
		playZapSound,
	} from '$lib/services/audio';

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

	// Panic Button state
	let showPanicConfirm = $state(false);
	let isPanicWiping = $state(false);
	let panicConfirmText = $state('');
	const PANIC_CONFIRM_PHRASE = 'WIPE ALL DATA';

	// Developer support state
	let showDonateModal = $state(false);
	let donateAmount = $state(2100);
	const DEVELOPER_LN_ADDRESS = 'classywallaby932694@getalby.com';
	const PRESET_AMOUNTS = [21, 210, 2100, 21000];

	// Sound settings
	let soundsEnabled = $state(true);

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

		// Load profile for editing
		if (authStore.isAuthenticated) {
			await profileStore.load();
		}

		// Load sound settings
		await initAudioService();
		soundsEnabled = isSoundsEnabled();
	});

	async function handleSaveProfile() {
		const success = await profileStore.save();
		if (success) {
			notificationsStore.success(
				'Profile saved',
				'Your profile has been updated',
			);
		} else {
			notificationsStore.error(
				'Failed to save',
				profileStore.error || 'Unknown error',
			);
		}
	}

	async function handleResetProfile() {
		await profileStore.reset();
	}

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

	const canConfirmPanic = $derived(panicConfirmText === PANIC_CONFIRM_PHRASE);

	async function handlePanicWipe() {
		if (!canConfirmPanic) return;
		isPanicWiping = true;
		await authStore.panicWipe();
	}

	async function handleDonate() {
		if (!walletStore.isConnected) {
			notificationsStore.error(
				'Wallet not connected',
				'Please connect your wallet first',
			);
			return;
		}

		try {
			await walletStore.sendToAddress(
				DEVELOPER_LN_ADDRESS,
				donateAmount,
				'Support AURA Development ⚡',
			);
			notificationsStore.success(
				'Thank you! 💜',
				`You sent ${donateAmount} sats to support AURA`,
			);
			showDonateModal = false;
		} catch (e) {
			notificationsStore.error(
				'Donation failed',
				e instanceof Error ? e.message : 'Unknown error',
			);
		}
	}
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
		<!-- Profile Edit -->
		<Card>
			<CardHeader>
				<div class="flex items-center gap-2">
					<User class="h-5 w-5" />
					<CardTitle>Edit Profile</CardTitle>
				</div>
				<CardDescription
					>Update your Nostr identity (kind:0 metadata)</CardDescription
				>
			</CardHeader>
			<CardContent>
				{#if authStore.isAuthenticated}
					{#if profileStore.isLoading}
						<div class="flex justify-center py-8">
							<Spinner />
						</div>
					{:else}
						<div class="space-y-6">
							<!-- Avatar & Banner Preview -->
							<div class="relative">
								<div
									class="h-24 rounded-lg bg-linear-to-br from-primary/20 to-accent/20 overflow-hidden"
								>
									{#if profileStore.profile.banner}
										<img
											src={profileStore.profile.banner}
											alt="Banner"
											class="h-full w-full object-cover"
										/>
									{/if}
								</div>
								<Avatar
									size="xl"
									class="absolute -bottom-8 left-4 h-20 w-20 border-4 border-background"
								>
									<AvatarImage
										src={profileStore.profile.picture}
									/>
									<AvatarFallback
										>{avatarInitials}</AvatarFallback
									>
								</Avatar>
							</div>

							<div class="pt-10 grid gap-4">
								<!-- Display Name -->
								<div class="space-y-2">
									<label
										for="display_name"
										class="text-sm font-medium"
										>Display Name</label
									>
									<Input
										id="display_name"
										value={profileStore.profile
											.display_name || ''}
										oninput={(e) =>
											profileStore.updateField(
												'display_name',
												e.currentTarget.value,
											)}
										placeholder="Your display name"
									/>
								</div>

								<!-- Username -->
								<div class="space-y-2">
									<label
										for="name"
										class="text-sm font-medium"
										>Username</label
									>
									<Input
										id="name"
										value={profileStore.profile.name || ''}
										oninput={(e) =>
											profileStore.updateField(
												'name',
												e.currentTarget.value,
											)}
										placeholder="username"
									/>
								</div>

								<!-- About -->
								<div class="space-y-2">
									<label
										for="about"
										class="text-sm font-medium">About</label
									>
									<Textarea
										id="about"
										value={profileStore.profile.about || ''}
										oninput={(e) =>
											profileStore.updateField(
												'about',
												e.currentTarget.value,
											)}
										placeholder="Tell us about yourself..."
										rows={3}
									/>
								</div>

								<!-- Picture URL -->
								<div class="space-y-2">
									<label
										for="picture"
										class="text-sm font-medium"
									>
										<Image class="inline h-4 w-4 mr-1" />
										Avatar URL
									</label>
									<Input
										id="picture"
										value={profileStore.profile.picture ||
											''}
										oninput={(e) =>
											profileStore.updateField(
												'picture',
												e.currentTarget.value,
											)}
										placeholder="https://example.com/avatar.jpg"
									/>
								</div>

								<!-- Banner URL -->
								<div class="space-y-2">
									<label
										for="banner"
										class="text-sm font-medium"
									>
										<Image class="inline h-4 w-4 mr-1" />
										Banner URL
									</label>
									<Input
										id="banner"
										value={profileStore.profile.banner ||
											''}
										oninput={(e) =>
											profileStore.updateField(
												'banner',
												e.currentTarget.value,
											)}
										placeholder="https://example.com/banner.jpg"
									/>
								</div>

								<!-- Website -->
								<div class="space-y-2">
									<label
										for="website"
										class="text-sm font-medium"
										>Website</label
									>
									<Input
										id="website"
										value={profileStore.profile.website ||
											''}
										oninput={(e) =>
											profileStore.updateField(
												'website',
												e.currentTarget.value,
											)}
										placeholder="https://yourwebsite.com"
									/>
								</div>

								<!-- NIP-05 -->
								<div class="space-y-2">
									<label
										for="nip05"
										class="text-sm font-medium"
									>
										<Check
											class="inline h-4 w-4 mr-1 text-success"
										/>
										NIP-05 Verification
									</label>
									<Input
										id="nip05"
										value={profileStore.profile.nip05 || ''}
										oninput={(e) =>
											profileStore.updateField(
												'nip05',
												e.currentTarget.value,
											)}
										placeholder="you@example.com"
									/>
									<p class="text-xs text-muted-foreground">
										Verify your identity with a NIP-05
										identifier
									</p>
								</div>

								<!-- Lightning Address -->
								<div class="space-y-2">
									<label
										for="lud16"
										class="text-sm font-medium"
									>
										⚡ Lightning Address
									</label>
									<Input
										id="lud16"
										value={profileStore.profile.lud16 || ''}
										oninput={(e) =>
											profileStore.updateField(
												'lud16',
												e.currentTarget.value,
											)}
										placeholder="you@getalby.com"
									/>
									<p class="text-xs text-muted-foreground">
										Receive Bitcoin via Lightning Network
									</p>
								</div>
							</div>
						</div>
					{/if}
				{:else}
					<p class="text-muted-foreground">
						Please login to edit your profile
					</p>
				{/if}
			</CardContent>
			{#if authStore.isAuthenticated && !profileStore.isLoading}
				<CardFooter class="flex gap-3">
					<Button
						variant="glow"
						onclick={handleSaveProfile}
						disabled={profileStore.isSaving ||
							!profileStore.isDirty}
					>
						{#if profileStore.isSaving}
							<Spinner class="mr-2 h-4 w-4" />
							Saving...
						{:else}
							<Save class="mr-2 h-4 w-4" />
							Save Profile
						{/if}
					</Button>
					{#if profileStore.isDirty}
						<Button
							variant="outline"
							onclick={handleResetProfile}
						>
							<RotateCcw class="mr-2 h-4 w-4" />
							Reset
						</Button>
					{/if}
					<Button
						variant="ghost"
						href="/profile/{authStore.pubkey}"
					>
						View Profile
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

		<!-- Sound Settings -->
		<Card>
			<CardHeader>
				<div class="flex items-center gap-2">
					{#if soundsEnabled}
						<Volume2 class="h-5 w-5" />
					{:else}
						<VolumeX class="h-5 w-5" />
					{/if}
					<CardTitle>Sound & Haptics</CardTitle>
				</div>
				<CardDescription>Audio feedback for actions</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div class="flex items-center justify-between">
					<div class="space-y-0.5">
						<p class="font-medium">Sound Effects</p>
						<p class="text-sm text-muted-foreground">
							Play sounds for zaps and notifications
						</p>
					</div>
					<Button
						variant={soundsEnabled ? 'default' : 'outline'}
						size="sm"
						onclick={async () => {
							soundsEnabled = !soundsEnabled;
							await setSoundsEnabled(soundsEnabled);
							if (soundsEnabled) {
								playZapSound(); // Preview sound
							}
						}}
					>
						{soundsEnabled ? 'On' : 'Off'}
					</Button>
				</div>
				<div class="flex items-start gap-3 rounded-lg bg-muted p-3">
					<Zap class="mt-0.5 h-4 w-4 text-warning" />
					<p class="text-sm text-muted-foreground">
						Sounds are generated using Web Audio API - no external
						audio files needed. Haptic feedback works on supported
						devices.
					</p>
				</div>
			</CardContent>
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

		<!-- Panic Button -->
		<Card class="border-destructive/50">
			<CardHeader>
				<div class="flex items-center gap-2">
					<AlertTriangle class="h-5 w-5 text-destructive" />
					<CardTitle class="text-destructive"
						>Emergency Wipe</CardTitle
					>
				</div>
				<CardDescription>
					Instantly delete all local data for security
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div
					class="rounded-lg bg-destructive/10 p-4 border border-destructive/20"
				>
					<p class="text-sm text-destructive font-medium mb-2">
						⚠️ This action cannot be undone!
					</p>
					<p class="text-sm text-muted-foreground">
						This will permanently delete:
					</p>
					<ul
						class="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside"
					>
						<li>All cached events and profiles</li>
						<li>
							Your login session (you'll need to re-enter keys)
						</li>
						<li>All local settings and preferences</li>
						<li>Service Worker cache</li>
					</ul>
				</div>
			</CardContent>
			<CardFooter>
				<Button
					variant="destructive"
					onclick={() => (showPanicConfirm = true)}
					class="w-full"
				>
					<AlertTriangle class="mr-2 h-4 w-4" />
					Emergency Wipe
				</Button>
			</CardFooter>
		</Card>

		<!-- Developer Support -->
		<Card
			class="border-primary/30 bg-linear-to-br from-primary/5 to-accent/5"
		>
			<CardHeader>
				<div class="flex items-center gap-2">
					<Heart class="h-5 w-5 text-primary" />
					<CardTitle>Support AURA Development</CardTitle>
				</div>
				<CardDescription>
					Help keep AURA free and open source
				</CardDescription>
			</CardHeader>
			<CardContent class="space-y-4">
				<div
					class="flex items-start gap-3 rounded-lg bg-background/50 p-4"
				>
					<Coffee class="mt-0.5 h-5 w-5 text-warning" />
					<div>
						<p class="font-medium">Value 4 Value</p>
						<p class="text-sm text-muted-foreground">
							AURA is built with love and runs on community
							support. If you find it useful, consider sending
							some sats!
						</p>
					</div>
				</div>

				<div class="space-y-3">
					<p class="text-sm font-medium">⚡ Lightning Address</p>
					<div
						class="flex items-center gap-2 rounded-lg bg-muted p-3 font-mono text-sm"
					>
						<Zap class="h-4 w-4 text-warning" />
						<span class="flex-1 truncate"
							>{DEVELOPER_LN_ADDRESS}</span
						>
						<Button
							variant="ghost"
							size="sm"
							onclick={() => {
								navigator.clipboard.writeText(
									DEVELOPER_LN_ADDRESS,
								);
								notificationsStore.success(
									'Copied!',
									'Lightning address copied to clipboard',
								);
							}}
						>
							Copy
						</Button>
					</div>
				</div>
			</CardContent>
			<CardFooter>
				<Button
					variant="glow"
					onclick={() => (showDonateModal = true)}
					class="w-full"
				>
					<Zap class="mr-2 h-4 w-4" />
					Send Sats ⚡
				</Button>
			</CardFooter>
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
						href="https://github.com/FrankFMY/AURA"
						target="_blank"
						rel="noopener"
						class="text-accent hover:underline"
					>
						View Source Code
					</a>
				</p>
				<p
					class="mt-4 pt-4 border-t border-border text-xs text-muted-foreground/70"
				>
					AURA is a client-side interface for the Nostr protocol. We
					do not host, store, or control any user content. All keys
					are stored locally on your device. Content is fetched from
					decentralized relays operated by third parties.
				</p>
			</CardContent>
		</Card>
	</div>
</div>

<!-- Panic Confirm Modal -->
{#if showPanicConfirm}
	<div
		class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
		onclick={() => (showPanicConfirm = false)}
		onkeydown={(e) => e.key === 'Escape' && (showPanicConfirm = false)}
		role="button"
		tabindex="-1"
	></div>
	<div
		class="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4"
	>
		<div
			class="rounded-lg border border-destructive bg-background shadow-lg"
		>
			<div class="p-6 text-center">
				<AlertTriangle class="mx-auto h-12 w-12 text-destructive" />
				<h2 class="mt-4 text-xl font-bold text-destructive">
					Emergency Data Wipe
				</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					This will permanently delete ALL local data. This action
					cannot be undone.
				</p>
			</div>
			<div class="border-t border-border p-4">
				<label
					for="panic-confirm-input"
					class="block text-sm font-medium mb-2"
				>
					Type "{PANIC_CONFIRM_PHRASE}" to confirm:
				</label>
				<Input
					id="panic-confirm-input"
					bind:value={panicConfirmText}
					placeholder={PANIC_CONFIRM_PHRASE}
					class="mb-4 font-mono"
				/>
				<div class="flex gap-3">
					<Button
						variant="outline"
						class="flex-1"
						onclick={() => {
							showPanicConfirm = false;
							panicConfirmText = '';
						}}
					>
						Cancel
					</Button>
					<Button
						variant="destructive"
						class="flex-1"
						disabled={!canConfirmPanic || isPanicWiping}
						onclick={handlePanicWipe}
					>
						{#if isPanicWiping}
							<Spinner class="mr-2 h-4 w-4" />
							Wiping...
						{:else}
							Wipe Everything
						{/if}
					</Button>
				</div>
			</div>
		</div>
	</div>
{/if}

<!-- Donate Modal -->
{#if showDonateModal}
	<div
		class="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm"
		onclick={() => (showDonateModal = false)}
		onkeydown={(e) => e.key === 'Escape' && (showDonateModal = false)}
		role="button"
		tabindex="-1"
	></div>
	<div
		class="fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 p-4"
	>
		<div class="rounded-lg border border-border bg-background shadow-lg">
			<div class="p-6 text-center">
				<div
					class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10"
				>
					<Zap class="h-6 w-6 text-warning" />
				</div>
				<h2 class="mt-4 text-xl font-bold">Support AURA ⚡</h2>
				<p class="mt-2 text-sm text-muted-foreground">
					Every sat helps keep AURA free and open source
				</p>
			</div>
			<div class="border-t border-border p-4 space-y-4">
				<!-- Preset amounts -->
				<div class="grid grid-cols-4 gap-2">
					{#each PRESET_AMOUNTS as amount}
						<Button
							variant={donateAmount === amount ? 'default' : (
								'outline'
							)}
							size="sm"
							onclick={() => (donateAmount = amount)}
							class="font-mono"
						>
							{amount}
						</Button>
					{/each}
				</div>

				<!-- Custom amount -->
				<div class="space-y-2">
					<label
						for="donate-amount-input"
						class="text-sm font-medium">Custom amount (sats)</label
					>
					<Input
						id="donate-amount-input"
						type="number"
						value={String(donateAmount)}
						oninput={(e) => {
							const val = parseInt(e.currentTarget.value);
							if (!isNaN(val) && val > 0) donateAmount = val;
						}}
						min="1"
						class="font-mono"
					/>
				</div>

				<!-- Action buttons -->
				<div class="flex gap-3 pt-2">
					<Button
						variant="outline"
						class="flex-1"
						onclick={() => (showDonateModal = false)}
					>
						Cancel
					</Button>
					<Button
						variant="glow"
						class="flex-1"
						onclick={handleDonate}
						disabled={!walletStore.isConnected}
					>
						<Zap class="mr-2 h-4 w-4" />
						Send {donateAmount} sats
					</Button>
				</div>

				{#if !walletStore.isConnected}
					<p class="text-xs text-center text-muted-foreground">
						<a
							href="/wallet"
							class="text-accent hover:underline"
						>
							Connect your wallet
						</a>
						to send sats directly
					</p>
				{/if}
			</div>
		</div>
	</div>
{/if}
