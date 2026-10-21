<!-- Throwaway comparison controls; loaded only by prototype launchers. -->
<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  let { variants, current, detail, state }: {
    variants: Array<{ key: string; name: string }>;
    current: string;
    detail: string;
    state: string;
  } = $props();
  function cycle(direction: number) {
    const index = variants.findIndex(item => item.key === current);
    const next = variants[(index + direction + variants.length) % variants.length];
    const url = new URL(page.url.href);
    url.searchParams.set('variant', next.key);
    void goto(url, { replace: true, reset: false });
  }
  function keydown(event: KeyboardEvent) {
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    cycle(event.key === 'ArrowLeft' ? -1 : 1);
  }
</script>

<svelte:window onkeydown={keydown} />
{#if import.meta.env.DEV}
  <div class="prototype-switcher">
    <div class="controls">
      <button aria-label="Previous layout" onclick={() => cycle(-1)}>←</button>
      <strong>{current} · {variants.find(item => item.key === current)?.name}</strong>
      <button aria-label="Next layout" onclick={() => cycle(1)}>→</button>
    </div>
    <p>{detail}</p>
    <small>PROTOTYPE · {state}</small>
  </div>
{/if}

<style>
  .prototype-switcher { position: fixed; z-index: 100; bottom: 7px; left: 50%; transform: translateX(-50%); width: min(530px, calc(100vw - 16px)); padding: 7px 12px; border: 1px solid #53688a; border-radius: 18px; color: #edf4ff; background: #172337; box-shadow: 0 4px 24px #0004; text-align: center; font: 12px/1.4 system-ui; }
  .controls { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  button { padding: 3px 12px; font-size: 18px; border-radius: 999px; background: #ffffff15; cursor: pointer; }
  p { margin: 3px 0; }
  small { color: #b4c6e2; font-size: 10px; }
</style>
