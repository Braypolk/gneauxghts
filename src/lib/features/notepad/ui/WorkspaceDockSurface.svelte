<script lang="ts">
  import type { Snippet } from 'svelte';
  let { content, active, kind, contentHeight = $bindable(0) }: {
    content: Snippet;
    active: boolean;
    kind: 'search' | 'chat';
    contentHeight?: number;
  } = $props();

  function measureContent(node: HTMLElement) {
    const measure = () => {
      const height = node.getBoundingClientRect().height;
      if (height > 0) contentHeight = height;
    };
    measure();
    const size = new ResizeObserver(measure);
    const children = new MutationObserver(measure);
    size.observe(node);
    children.observe(node, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    return { destroy: () => { size.disconnect(); children.disconnect(); } };
  }
</script>

<div class={`dock-surface dock-${kind}-layer`} aria-hidden={!active || undefined} inert={!active}>
  <div class="dock-surface-content" use:measureContent>{@render content()}</div>
</div>
