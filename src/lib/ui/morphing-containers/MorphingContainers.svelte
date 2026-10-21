<script module lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import type { ContainerSpec, ContainerGeometry, ContainerTransition, ContainerEasing } from './motion';

  export interface ContainerPresentation {
    state: ContainerSpec['state'];
    selection: number;
    textVisible: boolean;
    transitioning: boolean;
  }
  export interface MorphingContainerItem extends ContainerSpec {
    label: string;
    icon: Snippet<[ContainerPresentation]>;
    content?: Snippet<[ContainerPresentation]>;
    onActivate: () => void;
    disabled?: boolean;
    controls?: string;
    class?: string;
    toggleClass?: string;
  }
  export interface ContainerGroupPresentation {
    geometry: ContainerGeometry;
    transition: ContainerTransition | null;
    textVisible: boolean;
    contentHeights: Record<string, number>;
  }
  interface Props extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
    items: MorphingContainerItem[];
    circleSize?: number;
    /** Center the group, or its content when sibling icons leave enough room. */
    alignment?: 'group' | 'body';
    gap?: number;
    radius?: number;
    borderWidth?: number;
    element?: HTMLDivElement | null;
    presentation?: ContainerGroupPresentation | null;
    overlay?: Snippet;
    /** Optional synchronization with a caller's surrounding layout animation. */
    transitionContext?: () => { coordinated?: boolean; easing?: ContainerEasing; immediate?: boolean };
    layoutEndpoint?: { id: number; left: number; width: number } | null;
  }
</script>

<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { containerGeometry, createContainerMotion, requestContainerMotion, sampleContainerMotion,
    interpolateContainers } from './motion';
  import MorphingMaterial from './MorphingMaterial.svelte';

  let { items, circleSize = 40, gap = 12, alignment = 'group', radius, borderWidth = 1, element = $bindable(null), presentation = $bindable(null), overlay,
    transitionContext, layoutEndpoint, class: className = '', style = '', ...attributes }: Props = $props();
  const componentId = $props.id();
  const filterId = `${componentId}-morph`;
  let heights = $state<Record<string, number>>({});
  let availableWidth = $state(384);
  const measure = $derived({ width: availableWidth, circle: circleSize, gap, alignment });
  let motion = $state.raw(untrack(() => createContainerMotion(containerGeometry(items, measure))));
  let worldOrigin = $state<number | null>(null);
  let coordinated = $state(false);
  let reduced = false;
  let frame: number | undefined;
  let readMeasure: (() => void) | undefined;
  const signature = $derived(JSON.stringify(items.map(({ id, state }) => [id, state])));
  const specs = $derived(items.map(item => ({ ...item, height: item.height ?? heights[item.id], radius: item.radius ?? radius })));
  const destination = $derived(containerGeometry(specs, measure));
  const geometry = $derived.by(() => {
    const transition = motion.transition;
    if (!transition) return destination;
    if (!coordinated || worldOrigin === null) return motion.geometry;
    const left = element?.getBoundingClientRect().left ?? 0;
    const endpoint = layoutEndpoint?.id === transition.id ? layoutEndpoint : null;
    const target = endpoint ? containerGeometry(specs, { ...measure, width: endpoint.width }) : transition.origin;
    const shift = endpoint ? endpoint.left - worldOrigin : 0;
    const projected = interpolateContainers(transition.origin, { ...target, bodyX: target.bodyX + shift,
      icons: target.icons.map(icon => ({ ...icon, shellX: icon.shellX + shift, x: icon.x + shift })) }, transition.progress, true);
    const offset = worldOrigin - left;
    return { ...projected, bodyX: projected.bodyX + offset,
      icons: projected.icons.map(icon => ({ ...icon, shellX: icon.shellX + offset, x: icon.x + offset })) };
  });
  const textVisible = $derived(!motion.transition || motion.transition.fromId === destination.mainId || motion.transition.progress >= 0.9);
  const styles = $derived(`${style};--morph-body-x:${geometry.bodyX}px;--morph-body-width:${geometry.bodyWidth}px;--morph-body-height:${geometry.bodyHeight}px;--morph-body-radius:${geometry.radius}px;--morph-circle:${measure.circle}px;--dock-body-x:${geometry.bodyX}px;--dock-body-width:${geometry.bodyWidth}px;--dock-body-height:${geometry.bodyHeight}px;--dock-body-radius:${geometry.radius}px`);

  function itemPresentation(item: MorphingContainerItem): ContainerPresentation {
    return { state: item.state, selection: geometry.icons.find(icon => icon.id === item.id)?.selection ?? 0,
      textVisible: textVisible && destination.mainId === item.id, transitioning: !!motion.transition };
  }
  function cancel() { if (frame !== undefined) cancelAnimationFrame(frame); frame = undefined; }
  function animate() {
    cancel();
    const id = motion.transition?.id;
    if (id === undefined) return;
    const advance = (now: number) => {
      readMeasure?.();
      motion = sampleContainerMotion(motion, destination, now, id);
      if (motion.transition?.id === id) frame = requestAnimationFrame(advance);
      else frame = undefined;
    };
    frame = requestAnimationFrame(advance);
  }
  let previousSignature: string | undefined;
  let paintedGeometry = untrack(() => motion.geometry);
  $effect.pre(() => {
    const next = signature;
    untrack(() => {
      if (previousSignature === undefined) { previousSignature = next; return; }
      if (next === previousSignature) return;
      previousSignature = next;
      const context = transitionContext?.();
      // Capture the painted geometry before new size constraints reach the DOM.
      const body = element?.querySelector<HTMLElement>(':scope > .morph-body');
      const bounds = body?.getBoundingClientRect();
      const left = element?.getBoundingClientRect().left ?? 0;
      const origin = { ...paintedGeometry, bodyX: bounds ? bounds.left - left : geometry.bodyX,
        bodyWidth: bounds?.width ?? geometry.bodyWidth, bodyHeight: bounds?.height ?? geometry.bodyHeight };
      coordinated = !!context?.coordinated;
      worldOrigin = left;
      motion = requestContainerMotion({ ...motion, geometry: origin, transition: null }, destination, performance.now(),
        { easing: context?.easing, immediate: reduced || context?.immediate });
      animate();
    });
  });
  $effect(() => {
    paintedGeometry = geometry;
    presentation = { geometry, transition: motion.transition, textVisible, contentHeights: heights };
  });
  function observe(node: HTMLDivElement) {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = media.matches;
    const read = () => {
      availableWidth = node.clientWidth;
    };
    readMeasure = read;
    read();
    const observer = new ResizeObserver(read);
    observer.observe(node);
    const finish = () => {
      cancel(); reduced = media.matches;
      read(); motion = { ...motion, geometry: destination, transition: null };
    };
    window.addEventListener('resize', finish);
    media.addEventListener('change', finish);
    return { destroy() { observer.disconnect(); readMeasure = undefined;
      window.removeEventListener('resize', finish); media.removeEventListener('change', finish); } };
  }
  function measureContent(node: HTMLElement, id: string) {
    const read = () => {
      const height = node.getBoundingClientRect().height;
      if (height && heights[id] !== height) heights = { ...heights, [id]: height };
    };
    const observer = new ResizeObserver(read);
    observer.observe(node); read();
    return { destroy: () => observer.disconnect() };
  }
  onDestroy(cancel);
</script>

<div bind:this={element} use:observe class={`morphing-containers ${className}`} style={styles} {...attributes}
  data-dock-motion={motion.transition?.id} data-dock-started-at={motion.transition?.startedAt}
  data-dock-duration={motion.transition?.duration} data-dock-easing={motion.transition?.easing}
  data-dock-results-ready-at={motion.transition ? motion.transition.startedAt + motion.transition.duration : undefined}
  data-dock-text-reveal={textVisible || undefined} data-container-count={items.length}>
  <MorphingMaterial {filterId} {geometry} {borderWidth} circle={measure.circle} />
  {#each items as item (item.id)}
    {@const icon = geometry.icons.find(icon => icon.id === item.id)}
    {@const selected = destination.mainId === item.id}
    {#if icon}
      <button class={`morph-toggle workspace-input-toggle ${item.toggleClass ?? ''}`} data-container-toggle={item.id}
        type="button" aria-label={item.label} title={item.label} aria-expanded={item.state === 'expanded'}
        aria-controls={item.controls} aria-hidden={selected || item.disabled || undefined} tabindex={selected || item.disabled ? -1 : 0}
        disabled={item.disabled} onmousedown={event => event.preventDefault()} onclick={item.onActivate}
        style={`left:${icon.x}px;width:${icon.size}px;height:${icon.size}px;opacity:${icon.visibility};--morph-glyph-offset:${icon.glyphOffset}px`}>
        {@render item.icon(itemPresentation(item))}
      </button>
    {/if}
  {/each}
  <div class="morph-body dock-body">
    {#each items as item (item.id)}
      {@const view = itemPresentation(item)}
      <div class={`morph-surface dock-surface ${item.class ?? ''}`} data-container-surface={item.id} data-container-state={item.state}
        aria-hidden={destination.mainId !== item.id || undefined} inert={destination.mainId !== item.id}
        style:opacity={view.textVisible ? 1 : 0}>
        <div class="morph-content" use:measureContent={item.id}>{@render item.content?.(view)}</div>
      </div>
    {/each}
    {@render overlay?.()}
  </div>

</div>

<style>
  .morphing-containers {
    --morph-bottom-inset: 0px;
    --morph-background: var(--background);
    --morph-border: var(--border);
    position: relative; isolation: isolate; min-width: 0;
    height: calc(var(--morph-body-height) + var(--morph-bottom-inset));
  }
  .morph-body { position: absolute; left: var(--morph-body-x); bottom: var(--morph-bottom-inset);
    width: var(--morph-body-width); height: var(--morph-body-height); border-radius: var(--morph-body-radius); }
  .morph-surface { position: absolute; bottom: 0; left: 0; width: 100%; transition: opacity 100ms ease-out; }
  [data-dock-text-reveal] .morph-surface { transition-duration: 280ms; }
  .morph-surface[aria-hidden='true'] { pointer-events: none; }
  .morph-toggle {
    position: absolute; bottom: calc(var(--morph-bottom-inset) + var(--morph-circle) / 2);
    transform: translateY(50%); min-width: 0; min-height: 0; display: inline-flex;
    align-items: center; justify-content: center; border-radius: 9999px; color: var(--muted-foreground);
    background: transparent; box-shadow: none;
  }
  .morph-toggle :global(svg) { transform: translateX(var(--morph-glyph-offset, 0px)); }
  .morph-toggle[aria-hidden='true'] { pointer-events: none; }
  .morph-toggle:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
  .morphing-containers:not([data-dock-motion]) .morph-toggle:not([aria-hidden='true']):hover { background: var(--accent); color: var(--foreground); }
  @media (prefers-reduced-motion: reduce) { .morph-surface { transition: none !important; } }
</style>
