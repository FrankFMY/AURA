<script lang="ts">
	import { Skeleton } from '$components/ui/skeleton';
</script>

<div class="border-b border-border p-4">
	<div class="flex gap-3">
		<Skeleton class="h-10 w-10 shrink-0 rounded-full" />
		<div class="min-w-0 flex-1 space-y-3">
			<div class="flex items-center gap-2">
				<Skeleton class="h-4 w-24" />
				<Skeleton class="h-4 w-16" />
			</div>
			<div class="space-y-2">
				<Skeleton class="h-4 w-full" />
				<Skeleton class="h-4 w-4/5" />
				<Skeleton class="h-4 w-2/3" />
			</div>
			<div class="flex items-center gap-4 pt-2">
				<Skeleton class="h-4 w-12" />
				<Skeleton class="h-4 w-12" />
				<Skeleton class="h-4 w-12" />
				<Skeleton class="h-4 w-12" />
			</div>
		</div>
	</div>
</div>
