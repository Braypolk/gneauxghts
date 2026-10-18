<script lang="ts">
  import * as Collapsible from '$lib/components/ui/collapsible';
  import { cn, type WithoutChild } from '$lib/utils';
  import type { Collapsible as CollapsiblePrimitive } from 'bits-ui';

  let { ref = $bindable(null), class: className, children, ...restProps }: WithoutChild<CollapsiblePrimitive.ContentProps> = $props();
</script>

<Collapsible.Content bind:ref data-slot="trace-collapsible-content" class={cn('min-w-0 text-muted-foreground', className)} {...restProps}>
  {@render children?.()}
</Collapsible.Content>
