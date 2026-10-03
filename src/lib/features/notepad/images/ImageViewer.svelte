<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { boundedPan, viewerFit, type ImageViewerSession } from './imageViewerModel';
  let { session, onClose }: { session: ImageViewerSession; onClose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let stage: HTMLDivElement;
  let index = $state(untrack(() => session.index));
  let url = $state(''), error = $state(''), loading = $state(true);
  let naturalWidth = $state(1), naturalHeight = $state(1);
  let availableWidth = $state(1), availableHeight = $state(1);
  let scale = $state(1), x = $state(0), y = $state(0);
  let panning = $state(false);
  let request = 0, alive = true;
  let suppressClick = false;
  let drag: { id: number; x: number; y: number; startX: number; startY: number } | null = null;
  const image = $derived(session.images[index]);
  const fit = $derived(viewerFit(naturalWidth, naturalHeight, availableWidth, availableHeight));
  function close() { onClose(); }
  function clampPan() {
    const pan = boundedPan(x, y, naturalWidth * scale, naturalHeight * scale, availableWidth, availableHeight);
    x = pan.x; y = pan.y;
  }
  function reset() { scale = fit; x = y = 0; }
  function zoom(factor: number) { scale = Math.min(8, Math.max(fit, scale * factor)); clampPan(); }
  async function load(refresh = false) {
    const generation = ++request;
    loading = true; error = ''; url = ''; drag = null; panning = false; x = y = 0;
    const current = session.images[index];
    if (!current.assetName) { loading = false; error = current.error ?? 'Image unavailable'; return; }
    try {
      const result = await session.load(current.assetName, refresh);
      if (!alive || request !== generation) return;
      url = result;
    } catch { if (alive && request === generation) { loading = false; error = 'Image unavailable.'; } }
  }
  function step(delta: number) {
    const next = Math.max(0, Math.min(session.images.length - 1, index + delta));
    if (next !== index) { index = next; void load(); }
  }
  function onKey(event: KeyboardEvent) {
    event.stopPropagation();
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); step(1); }
    else if (event.key === 'ArrowLeft') { event.preventDefault(); step(-1); }
    else if (['=', '+', '-', '0'].includes(event.key)) {
      event.preventDefault(); if (event.key === '0') reset(); else zoom(event.key === '-' ? 1 / 1.2 : 1.2);
    }
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || scale <= fit || loading || error) return;
    event.preventDefault(); stage.setPointerCapture(event.pointerId);
    drag = { id: event.pointerId, x, y, startX: event.clientX, startY: event.clientY }; panning = true; suppressClick = false;
  }
  function pointerMove(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    x = drag.x + event.clientX - drag.startX; y = drag.y + event.clientY - drag.startY;
    suppressClick ||= Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 3;
    clampPan();
  }
  function pointerUp() { drag = null; panning = false; }
  onMount(() => {
    // Props belong to the parent conditional; capture the origin for teardown.
    const origin = session;
    const cancel = (event: Event) => { event.preventDefault(); close(); };
    dialog.addEventListener('keydown', onKey);
    dialog.addEventListener('cancel', cancel);
    dialog.showModal();
    const observer = new ResizeObserver(() => {
      const wasFit = Math.abs(scale - fit) < .001;
      availableWidth = Math.max(1, stage.clientWidth - 48); availableHeight = Math.max(1, stage.clientHeight - 48);
      if (wasFit) reset(); else clampPan();
    });
    observer.observe(stage);
    const unsubscribe = origin.subscribe(onClose);
    void load();
    return () => { alive = false; request++; observer.disconnect(); unsubscribe();
      dialog.removeEventListener('keydown', onKey); dialog.removeEventListener('cancel', cancel);
      dialog.close(); origin.restore(); };
  });
</script>

<!-- A native modal supplies focus trapping and makes the workspace inert. -->
<dialog bind:this={dialog} class="gn-image-viewer" aria-label="Image viewer">
  <header>
    <span title={image.target.fileName}>{image.target.fileName}</span>
    <span class="counter">{index + 1} / {session.images.length}</span>
    <button type="button" aria-label="Zoom out" onclick={() => zoom(1 / 1.2)} disabled={loading || !!error}>−</button>
    <button type="button" aria-label="Zoom in" onclick={() => zoom(1.2)} disabled={loading || !!error}>+</button>
    <button type="button" aria-label="Fit image" onclick={reset} disabled={loading || !!error}>Fit</button>
    <button type="button" aria-label="Close image viewer" onclick={onClose}>×</button>
  </header>
  <div bind:this={stage} class="stage" class:panning class:zoomed={scale > fit}
    role="presentation" onpointerdown={pointerDown} onpointermove={pointerMove}
    onpointerup={pointerUp} onpointercancel={pointerUp} onlostpointercapture={pointerUp}
    onclick={(event) => { if (event.target === stage && !suppressClick) onClose(); suppressClick = false; }}>
    {#if url}
      <img src={url} alt={image.target.fileName} draggable="false"
        style={`width:${naturalWidth}px;height:${naturalHeight}px;transform:translate(${x}px,${y}px) scale(${scale})`}
        onload={(event) => { const element = event.currentTarget as HTMLImageElement; naturalWidth = element.naturalWidth; naturalHeight = element.naturalHeight; loading = false; reset(); }}
        onerror={() => { loading = false; error = 'Image could not be decoded.'; }} />
    {/if}
    {#if loading}<p role="status">Loading image…</p>{/if}
    {#if error}<div class="error" role="status">{error} {#if image.assetName}<button type="button" onclick={() => load(true)}>Retry</button>{/if}</div>{/if}
  </div>
  <footer>
    <button type="button" aria-label="Previous image" disabled={index === 0} onclick={() => step(-1)}>←</button>
    <span>Arrow keys to browse · + / − to zoom · 0 to fit · Esc to close</span>
    <button type="button" aria-label="Next image" disabled={index === session.images.length - 1} onclick={() => step(1)}>→</button>
  </footer>
</dialog>
<style>
  .gn-image-viewer { inset:0; width:100vw; height:100dvh; max-width:none; max-height:none; margin:0; padding:0; border:0; color:#eee; background:#171719; overflow:hidden; }
  .gn-image-viewer[open] { display:flex; flex-direction:column; }
  .gn-image-viewer::backdrop { background:#171719; }
  header, footer { display:flex; align-items:center; gap:.75rem; padding:.75rem 1rem; flex:none; background:#202023; z-index:1; }
  header > span:first-child { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .counter, footer span { color:#bbb; font-size:.8rem; }
  button { border:1px solid #555; border-radius:.4rem; padding:.25rem .65rem; background:#303034; color:inherit; cursor:pointer; }
  button:disabled { opacity:.35; cursor:default; }
  button:focus-visible { outline:2px solid #a8bfff; outline-offset:3px; }
  .stage { position:relative; flex:1; min-height:0; display:flex; align-items:center; justify-content:center; overflow:hidden; touch-action:none; }
  .stage.zoomed { cursor:grab; } .stage.panning { cursor:grabbing; }
  img { max-width:none; max-height:none; flex:none; object-fit:contain; user-select:none; transform-origin:center; }
  p, .error { position:absolute; padding:1rem; background:#202023; border-radius:.4rem; }
  footer { justify-content:space-between; }
</style>
