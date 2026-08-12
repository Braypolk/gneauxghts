<script lang="ts">
	import { Collapsible } from "$lib/components/ui/collapsible/index.js";
	import { Card } from "$lib/components/ui/card/index.js";
	import { cn } from "$lib/utils";
	import type { PlanProps } from "./types.js";

	let { class: className, isStreaming: _isStreaming = false, children, ...restProps }: PlanProps = $props();
	// indexing
</script>

<Collapsible data-slot="plan" {...restProps}>
	<Card class={cn("shadow-none", className)}>
		{@render children?.()}
	</Card>
</Collapsible>
