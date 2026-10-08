<script lang="ts">
  import type { workspaceDockGeometry } from './workspaceDockMachine';
  let { filterId, geometry, circle, radius }: {
    filterId: string;
    geometry: ReturnType<typeof workspaceDockGeometry>;
    circle: number;
    radius: number;
  } = $props();
  const centerY = $derived(geometry.bodyHeight - circle / 2);
  const leftNeckHeight = $derived(circle * 0.45 * geometry.leftNeck);
  const rightNeckHeight = $derived(circle * 0.45 * geometry.rightNeck);
</script>

<!-- One SVG paint layer owns the entire contour. Filtering HTML descendants
     can leave stale border fragments in WebKit's composited backing layers.
     Text and interactive controls remain outside the filter. -->
<svg class="dock-material" aria-hidden="true">
  <defs>
    <filter id={filterId} x="-10%" y="-50%" width="120%" height="200%" color-interpolation-filters="sRGB">
      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="soft" />
      <feColorMatrix in="soft" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 18 -8" result="joined" />
      <feMorphology in="joined" operator="dilate" radius="1" result="edge" />
      <feComposite in="edge" in2="joined" operator="out" result="outline" />
      <feFlood style="flood-color: var(--border);" flood-opacity="0.8125" result="borderColor" />
      <feComposite in="borderColor" in2="outline" operator="in" result="border" />
      <feMerge><feMergeNode in="border" /><feMergeNode in="joined" /></feMerge>
    </filter>
  </defs>
  <g data-dock-joined-shapes filter={`url(#${filterId})`}>
    <rect class="dock-body dock-material-body" x={geometry.bodyX} y="0" width={geometry.bodyWidth} height={geometry.bodyHeight} rx={radius}
      style={`x:${geometry.bodyX}px;`} />
    <circle class="dock-material-search" cx={geometry.searchCircleX + circle / 2} cy={centerY} r={circle / 2}
      style={`cx:${geometry.searchCircleX + circle / 2}px;`} />
    <circle class="dock-material-chat" cx={geometry.rightShellX + circle / 2} cy={centerY} r={circle / 2}
      style={`cx:${geometry.rightShellX + circle / 2}px;`} />
    <rect class="dock-neck--left" x={geometry.searchCircleX + circle / 2} y={centerY - leftNeckHeight / 2}
      width={Math.max(0, geometry.bodyX - geometry.searchCircleX - circle / 2 + 8)} height={leftNeckHeight} />
    <rect class="dock-neck--right" x={geometry.bodyX + geometry.bodyWidth - 8} y={centerY - rightNeckHeight / 2}
      width={Math.max(0, geometry.rightShellX + circle / 2 - geometry.bodyX - geometry.bodyWidth + 8)} height={rightNeckHeight} />
  </g>
</svg>

<style>
  .dock-material { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; z-index: -1; pointer-events: none; opacity: 0.8; }
  [data-dock-joined-shapes] { fill: var(--background); }
</style>
