<script lang="ts">
	import { fade, fly, scale } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { Button } from '$components/ui/button';
	import { dbHelpers } from '$db';
	import Globe from 'lucide-svelte/icons/globe';
	import Key from 'lucide-svelte/icons/key';
	import Zap from 'lucide-svelte/icons/zap';
	import Shield from 'lucide-svelte/icons/shield';
	import ChevronLeft from 'lucide-svelte/icons/chevron-left';
	import ChevronRight from 'lucide-svelte/icons/chevron-right';
	import X from 'lucide-svelte/icons/x';
	import Sparkles from 'lucide-svelte/icons/sparkles';

	interface Props {
		onComplete: () => void;
	}

	let { onComplete }: Props = $props();

	let currentSlide = $state(0);

	const slides = [
		{
			icon: Globe,
			title: 'Welcome to Nostr',
			subtitle: 'A Decentralized Social Network',
			description:
				'Nostr is a censorship-resistant protocol where you own your identity and data. No company can ban you or control your content.',
			color: 'text-primary',
			bgColor: 'bg-primary/10',
		},
		{
			icon: Key,
			title: 'Your Keys, Your Identity',
			subtitle: 'Cryptographic Ownership',
			description:
				'Unlike traditional social media, your account is secured by cryptographic keys. Your public key (npub) is your identity, your private key (nsec) is your password - never share it!',
			color: 'text-accent',
			bgColor: 'bg-accent/10',
		},
		{
			icon: Zap,
			title: 'Lightning Payments',
			subtitle: 'Instant Micropayments',
			description:
				'Send "zaps" - instant Bitcoin tips to creators you appreciate. No banks, no fees, no delays. Connect your Lightning wallet and support great content.',
			color: 'text-warning',
			bgColor: 'bg-warning/10',
		},
		{
			icon: Shield,
			title: 'Privacy First',
			subtitle: 'Your Data Stays Yours',
			description:
				'AURA stores data locally on your device. Direct messages are encrypted. We never see your content or who you talk to.',
			color: 'text-success',
			bgColor: 'bg-success/10',
		},
	];

	function nextSlide() {
		if (currentSlide < slides.length - 1) {
			currentSlide++;
		}
	}

	function prevSlide() {
		if (currentSlide > 0) {
			currentSlide--;
		}
	}

	async function handleComplete() {
		await dbHelpers.setSetting('welcome_completed', true);
		onComplete();
	}

	async function handleSkip() {
		await dbHelpers.setSetting('welcome_completed', true);
		onComplete();
	}

	const isLastSlide = $derived(currentSlide === slides.length - 1);
	const currentSlideData = $derived(slides[currentSlide]);
</script>

<div
	class="fixed inset-0 z-50 flex items-center justify-center bg-background/95 backdrop-blur-sm"
	transition:fade={{ duration: 300 }}
>
	<!-- Skip button -->
	<button
		class="absolute right-4 top-4 rounded-full p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
		onclick={handleSkip}
	>
		<X class="h-5 w-5" />
		<span class="sr-only">Skip tour</span>
	</button>

	<div
		class="w-full max-w-lg px-3 sm:px-4"
		in:scale={{ duration: 400, start: 0.9, easing: cubicOut, delay: 100 }}
	>
		<!-- Slide content -->
		<div
			class="relative min-h-[320px] sm:min-h-[400px] overflow-hidden rounded-2xl border border-border bg-card p-5 sm:p-8 shadow-xl card-elevated-xl"
		>
			<!-- Decorative gradient -->
			<div
				class="absolute -top-20 -right-20 h-40 w-40 rounded-full blur-3xl opacity-30 {currentSlideData.bgColor}"
			></div>

			{#key currentSlide}
				<!-- Icon -->
				<div
					class="relative mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl {currentSlideData.bgColor} transition-colors duration-300"
					in:scale={{ duration: 300, start: 0.8, easing: cubicOut }}
				>
					{#if currentSlide === 0}
						<Globe class="h-10 w-10 {currentSlideData.color}" />
					{:else if currentSlide === 1}
						<Key class="h-10 w-10 {currentSlideData.color}" />
					{:else if currentSlide === 2}
						<Zap class="h-10 w-10 {currentSlideData.color}" />
					{:else}
						<Shield class="h-10 w-10 {currentSlideData.color}" />
					{/if}
				</div>

				<!-- Title -->
				<div
					class="text-center mb-6"
					in:fly={{
						y: 10,
						duration: 300,
						delay: 50,
						easing: cubicOut,
					}}
				>
					<h2 class="text-xl sm:text-2xl font-bold mb-2">
						{currentSlideData.title}
					</h2>
					<p class="text-sm font-medium {currentSlideData.color}">
						{currentSlideData.subtitle}
					</p>
				</div>

				<!-- Description -->
				<p
					class="text-center text-muted-foreground leading-relaxed"
					in:fly={{
						y: 10,
						duration: 300,
						delay: 100,
						easing: cubicOut,
					}}
				>
					{currentSlideData.description}
				</p>
			{/key}

			<!-- Progress dots -->
			<div class="mt-8 flex justify-center gap-2">
				{#each slides as slide, i (slide.title)}
					<button
						class="h-2 rounded-full transition-all {(
							i === currentSlide
						) ?
							'w-8 bg-primary'
						:	'w-2 bg-muted-foreground/30 hover:bg-muted-foreground/50'}"
						onclick={() => (currentSlide = i)}
					>
						<span class="sr-only">Slide {i + 1}</span>
					</button>
				{/each}
			</div>
		</div>

		<!-- Navigation -->
		<div class="mt-6 flex items-center justify-between">
			<Button
				variant="ghost"
				onclick={prevSlide}
				disabled={currentSlide === 0}
				class="gap-2"
			>
				<ChevronLeft class="h-4 w-4" />
				Back
			</Button>

			{#if isLastSlide}
				<Button
					variant="glow"
					onclick={handleComplete}
					class="gap-2"
				>
					<Sparkles class="h-4 w-4" />
					Get Started
				</Button>
			{:else}
				<Button
					variant="default"
					onclick={nextSlide}
					class="gap-2"
				>
					Next
					<ChevronRight class="h-4 w-4" />
				</Button>
			{/if}
		</div>
	</div>
</div>
