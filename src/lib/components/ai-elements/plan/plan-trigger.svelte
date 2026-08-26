<script lang="ts">
	import { CollapsibleTrigger } from "$lib/components/ui/collapsible/index.js";
	import { cn } from "$lib/utils";
	import ChevronsUpDownIcon from "@lucide/svelte/icons/chevrons-up-down";
	import type { PlanTriggerProps } from "./types.js";

	let { class: className, children, ...restProps }: PlanTriggerProps = $props();
</script>

<CollapsibleTrigger {...restProps}>
	<span
		class={cn("inline-flex size-8 items-center justify-center rounded-md hover:bg-accent hover:text-accent-foreground", className)}
		data-slot="plan-trigger"
	>
		{#if children}
			{@render children()}
		{:else}
			<ChevronsUpDownIcon class="size-4" />
			<span class="sr-only">Toggle plan</span>
		{/if}
	</span>
</CollapsibleTrigger>
