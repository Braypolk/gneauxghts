<script lang="ts">
	import { CardDescription } from "$lib/components/ui/card/index.js";
	import { cn } from "$lib/utils";
	import type { PlanDescriptionProps } from "./types.js";

	let { class: className, children, ...restProps }: PlanDescriptionProps = $props();
</script>

<CardDescription class={cn("text-balance", className)} data-slot="plan-description" {...restProps}>
	{@render children()}
</CardDescription>
