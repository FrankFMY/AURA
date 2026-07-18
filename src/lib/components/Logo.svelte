<script lang="ts">
	let { size = 'default', compact = false }: { size?: 'default' | 'large'; compact?: boolean } =
		$props();
</script>

<div class:large={size === 'large'} class:compact class="logo-lockup" aria-label="AURA">
	<svg class="logo-mark" viewBox="0 0 44 44" role="img" aria-hidden="true">
		<circle class="outer" cx="22" cy="22" r="18.5" />
		<path class="arc" d="M11.7 28.5c2.4-9 8.3-14.7 17.7-17.1" />
		<path class="beam" d="M17.2 30.5 22 16.2l4.8 14.3M19.3 24.4h5.4" />
		<circle class="signal" cx="31.7" cy="10.8" r="2.3" />
	</svg>
	{#if !compact}<span>AURA</span>{/if}
</div>

<style>
	.logo-lockup {
		display: inline-flex;
		align-items: center;
		gap: 0.68rem;
		color: var(--ink);
	}
	.logo-mark {
		width: 2.1rem;
		height: 2.1rem;
		overflow: visible;
	}
	.logo-lockup span {
		font-weight: 750;
		font-size: 1rem;
		letter-spacing: 0.18em;
	}
	.outer {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.25;
		opacity: 0.28;
	}
	.arc {
		fill: none;
		stroke: var(--aura);
		stroke-linecap: round;
		stroke-width: 2.2;
	}
	.beam {
		fill: none;
		stroke: currentColor;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-width: 1.65;
	}
	.signal {
		fill: var(--aura);
		filter: drop-shadow(0 0 5px color-mix(in srgb, var(--aura) 55%, transparent));
	}
	.large .logo-mark {
		width: 2.75rem;
		height: 2.75rem;
	}
	.large span {
		font-size: 1.2rem;
	}
	.compact .logo-mark {
		width: 2.45rem;
		height: 2.45rem;
	}
</style>
