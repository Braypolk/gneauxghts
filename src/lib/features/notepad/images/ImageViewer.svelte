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
  type Point = { x: number; y: number };
  const pointers = new Map<number, Point>();
  let gesture: { kind: 'pan' | 'swipe'; start: Point; x: number; y: number } |
    { kind: 'pinch'; midpoint: Point; distance: number; scale: number; x: number; y: number } | null = null;
  const image = $derived(session.images[index]);
  const fit = $derived(viewerFit(naturalWidth, naturalHeight, availableWidth, availableHeight));
  function close() { onClose(); }
  function clampPan() {
    const pan = boundedPan(x, y, naturalWidth * scale, naturalHeight * scale, availableWidth, availableHeight);
    x = pan.x; y = pan.y;
  }
  function clearGesture() {
    const captured = [...pointers.keys()];
    pointers.clear(); gesture = null; panning = false;
    for (const id of captured) if (stage?.hasPointerCapture(id)) stage.releasePointerCapture(id);
  }
  function reset() { clearGesture(); scale = fit; x = y = 0; }
  function zoom(factor: number) { scale = Math.min(8, Math.max(fit, scale * factor)); clampPan(); }
  async function load(refresh = false) {
    const generation = ++request;
    loading = true; error = ''; url = ''; clearGesture(); x = y = 0;
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
    if (event.button !== 0 || loading || error || pointers.size >= 2 || (event.pointerType === 'mouse' && scale <= fit)) return;
    event.preventDefault();
    if (!pointers.size) suppressClick = false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    stage.setPointerCapture(event.pointerId);
    if (pointers.size === 1) {
      gesture = { kind: scale > fit + .001 ? 'pan' : 'swipe', start: { x: event.clientX, y: event.clientY }, x, y };
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { kind: 'pinch', midpoint: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale, x, y };
      suppressClick = true;
    }
    panning = gesture?.kind === 'pan';
  }
  function pointerMove(event: PointerEvent) {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (gesture.kind === 'pinch') {
      const [a, b] = [...pointers.values()];
      if (!a || !b) return;
      const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      scale = Math.min(8, Math.max(fit, gesture.scale * Math.hypot(a.x - b.x, a.y - b.y) / gesture.distance));
      // Keep the image point under the fingers stable as their midpoint moves.
      const rect = stage.getBoundingClientRect();
      const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      const ratio = scale / gesture.scale;
      x = midpoint.x - center.x - (gesture.midpoint.x - center.x - gesture.x) * ratio;
      y = midpoint.y - center.y - (gesture.midpoint.y - center.y - gesture.y) * ratio;
      clampPan();
    } else {
      const dx = event.clientX - gesture.start.x, dy = event.clientY - gesture.start.y;
      suppressClick ||= Math.hypot(dx, dy) > 6;
      if (gesture.kind === 'pan') { x = gesture.x + dx; y = gesture.y + dy; clampPan(); }
    }
  }
  function pointerUp(event: PointerEvent) {
    if (!pointers.has(event.pointerId)) return;
    const current = gesture;
    pointers.delete(event.pointerId);
    if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
    if (!pointers.size) {
      gesture = null; panning = false;
      if (current?.kind === 'swipe') {
        const dx = event.clientX - current.start.x, dy = event.clientY - current.start.y;
        if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.3) { suppressClick = true; step(dx < 0 ? 1 : -1); }
      }
    } else if (pointers.size === 1) {
      // A remaining finger after pinch may pan, but cannot start a browse swipe.
      gesture = { kind: 'pan', start: [...pointers.values()][0], x, y };
      panning = true;
    }
  }
  function cancelGesture(event: PointerEvent | undefined = undefined) {
    if (event && !pointers.has(event.pointerId)) return;
    suppressClick = true;
    clearGesture();
  }
  onMount(() => {
    // Props belong to the parent conditional; capture the origin for teardown.
    const origin = session;
    const cancel = (event: Event) => { event.preventDefault(); close(); };
    dialog.addEventListener('keydown', onKey);
    dialog.addEventListener('cancel', cancel);
    dialog.showModal();
    const observer = new ResizeObserver(() => {
      if (pointers.size) cancelGesture();
      const wasFit = Math.abs(scale - fit) < .001;
      availableWidth = Math.max(1, stage.clientWidth - 48); availableHeight = Math.max(1, stage.clientHeight - 48);
      if (wasFit) reset(); else clampPan();
    });
    observer.observe(stage);
    const hidden = () => { if (document.hidden) cancelGesture(); };
    const blur = () => cancelGesture();
    window.addEventListener('blur', blur);
    document.addEventListener('visibilitychange', hidden);
    const unsubscribe = origin.subscribe(onClose);
    void load();
    return () => { alive = false; request++; clearGesture(); observer.disconnect(); unsubscribe();
      window.removeEventListener('blur', blur); document.removeEventListener('visibilitychange', hidden);
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
    onpointerup={pointerUp} onpointercancel={cancelGesture} onlostpointercapture={cancelGesture}
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
    <span class="keyboard-help">Arrow keys to browse · + / − to zoom · 0 to fit · Esc to close</span>
    <span class="touch-help">Pinch to zoom · Drag to pan · Swipe at fit to browse</span>
    <button type="button" aria-label="Next image" disabled={index === session.images.length - 1} onclick={() => step(1)}>→</button>
  </footer>
</dialog>
<style>
  .gn-image-viewer { inset:var(--app-viewport-top, 0px) 0 auto; width:100vw; height:var(--app-viewport-height, 100dvh); max-width:none; max-height:none; margin:0; padding:0; border:0; color:#eee; background:#171719; overflow:hidden; }
  .gn-image-viewer[open] { display:flex; flex-direction:column; }
  .gn-image-viewer::backdrop { background:#171719; }
  header, footer { display:flex; align-items:center; gap:.75rem; padding:.75rem 1rem; flex:none; background:#202023; z-index:1; }
  header, footer { padding-left: max(1rem, var(--app-safe-area-left)); padding-right: max(1rem, var(--app-safe-area-right)); }
  header { padding-top: max(.75rem, var(--app-safe-area-top)); }
  footer { padding-bottom: max(.75rem, var(--app-safe-area-bottom)); }
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
  .touch-help { display:none; }
  @media (any-pointer: coarse) {
    button { min-width:44px; min-height:44px; }
    header, footer { gap:.25rem; padding-block:.5rem; }
    header { padding-top:max(.5rem, var(--app-safe-area-top)); }
    footer { padding-bottom:max(.5rem, var(--app-safe-area-bottom)); }
    .keyboard-help { display:none; }
    .touch-help { display:block; text-align:center; }
  }
</style>
