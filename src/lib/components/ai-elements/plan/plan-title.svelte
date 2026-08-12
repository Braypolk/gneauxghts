<script lang="ts">
	import { CardTitle } from "$lib/components/ui/card/index.js";
	import type { PlanTitleProps } from "./types.js";

	let { children, ...restProps }: PlanTitleProps = $props();
</script>

<CardTitle data-slot="plan-title" {...restProps}>
	{@render children()}
</CardTitle>
