<script lang="ts">
  import type { ContainerGeometry } from './motion';
  let { filterId, geometry, circle, borderWidth }: { filterId: string; geometry: ContainerGeometry; circle: number; borderWidth: number } = $props();
  const blur = $derived(4 * geometry.neck);
  const centerY = $derived(geometry.bodyHeight - circle / 2);
  const neckHeight = $derived(circle * 0.45 * geometry.neck);
</script>

<!-- Only SVG chrome is filtered. Filtering content leaves stale backing-layer borders in WebKit. -->
<svg class="morph-material dock-material" aria-hidden="true">
  <defs>
    <filter id={filterId} x="-10%" y="-50%" width="120%" height="200%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation={blur < 0.001 ? 0 : blur} result="soft" />
      <feColorMatrix in="soft" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8" result="joined" />
      <feMorphology in="joined" operator="dilate" radius={borderWidth} result="edge" />
      <feComposite in="edge" in2="joined" operator="out" result="outline" />
      <feFlood style="flood-color:var(--morph-border)" flood-opacity="0.8125" result="borderColor" />
      <feComposite in="borderColor" in2="outline" operator="in" result="border" />
      <feMerge><feMergeNode in="border" /><feMergeNode in="joined" /></feMerge>
    </filter>
  </defs>
  <g data-dock-joined-shapes filter={`url(#${filterId})`}>
    <rect class="dock-body dock-material-body" x={geometry.bodyX} y="0" width={geometry.bodyWidth} height={geometry.bodyHeight} rx={geometry.radius} />
    {#each geometry.icons as icon (icon.id)}
      <circle data-container-shell={icon.id} cx={icon.shellX + circle / 2} cy={centerY} r={circle / 2} opacity={icon.visibility} />
      {#if neckHeight > 0.001 && (icon.id === geometry.mainId || icon.selection > 0.001)}
        <rect data-container-neck={icon.id} x={Math.min(icon.shellX + circle / 2, geometry.bodyX + geometry.bodyWidth - 8)} y={centerY - neckHeight / 2}
          width={Math.max(0, geometry.bodyX - icon.shellX - circle / 2 + 8, icon.shellX + circle / 2 - geometry.bodyX - geometry.bodyWidth + 8)} height={neckHeight} />
      {/if}
    {/each}
  </g>
</svg>
<style>
  .morph-material { position: absolute; left: 0; bottom: var(--morph-bottom-inset); width: 100%; height: var(--morph-body-height);
    overflow: visible; z-index: -1; pointer-events: none; opacity: var(--morph-opacity, 0.8); }
  [data-dock-joined-shapes] { fill: var(--morph-background); }
</style>
