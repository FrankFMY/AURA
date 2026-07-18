<script lang="ts">
	import '@fontsource-variable/manrope/index.css';
	import '@fontsource-variable/newsreader/index.css';
	import '../app.css';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href="/aura-mark.svg" type="image/svg+xml" />
	<link rel="manifest" href="/manifest.webmanifest" />
</svelte:head>

{@render children()}
