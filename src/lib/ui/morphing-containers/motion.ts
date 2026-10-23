import { cubicBezierProgress } from '../motion';

/** Shared presentation only. Callers retain content, focus and application state. */
export type ContainerState = 'icon' | 'compact' | 'expanded';
export type ContainerEasing = 'pinch' | 'editor';
export interface ContainerSpec {
  id: string;
  state: ContainerState;
  /** Desired bar width; omitted means fill the available space. */
  width?: number;
  height?: number;
  radius?: number;
  iconEdge?: 'start' | 'end';
  iconInset?: number;
  expandedIconSize?: number;
}
export interface ContainerMeasure { width: number; circle: number; gap: number; alignment?: 'group' | 'body' }
export interface ContainerIconPose {
  id: string; shellX: number; x: number; size: number; selection: number; visibility: number; glyphOffset: number;
}
export interface ContainerGeometry {
  mainId: string | null;
  circle: number;
  bodyX: number; bodyWidth: number; bodyHeight: number; radius: number;
  icons: ContainerIconPose[];
  neck: number;
}
const travelDuration = 300;
const pinchExtraDuration = 80;
export const containerMorphDuration = travelDuration + pinchExtraDuration;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
export function ramp(start: number, end: number, value: number) {
  const t = clamp((value - start) / (end - start));
  return t * t * (3 - 2 * t);
}
export function clockProgress(elapsed: number, easing: ContainerEasing = 'editor') {
  if (easing === 'editor') {
    return cubicBezierProgress(elapsed, [0.65, 0, 0.35, 1]);
  }
  // Spend the extra time only around the joined neck. The smooth ramp keeps
  // speed continuous as we enter and leave it, preserving the outer pacing.
  const extra = pinchExtraDuration / travelDuration;
  let low = 0, high = 1;
  for (let i = 0; i < 20; i++) {
    const time = (low + high) / 2;
    const clock = (time + extra * ramp(0.32, 0.68, time)) / (1 + extra);
    if (clock < elapsed) low = time;
    else high = time;
  }
  return ramp(0, 1, (low + high) / 2);
}

/** Items keep caller order. At most one item presents content; all others are icons. */
export function containerGeometry(items: readonly ContainerSpec[], measure: ContainerMeasure): ContainerGeometry {
  const { circle, gap } = measure;
  const main = items.find(item => item.state === 'expanded') ?? items.find(item => item.state === 'compact');
  if (items.filter(item => item.state !== 'icon').length > 1) {
    throw new Error('MorphingContainers supports one compact or expanded content surface at a time');
  }
  const available = Math.max(circle, measure.width - Math.max(0, items.length - 1) * (circle + gap));
  const bodyWidth = main ? Math.max(circle, Math.min(main.width ?? available, available)) : 0;
  const bodyHeight = main ? Math.max(circle, main.height ?? circle) : circle;
  const total = main ? bodyWidth + (items.length - 1) * (circle + gap) : Math.max(0, items.length * (circle + gap) - gap);
  let x = (measure.width - total) / 2;
  if (main && measure.alignment === 'body') {
    // Center the content when there is spare room, then clamp the whole group
    // inside its host so narrow layouts keep their full usable input width.
    const before = items.indexOf(main) * (circle + gap);
    x = Math.max(0, Math.min(Math.max(0, measure.width - total), (measure.width - bodyWidth) / 2 - before));
  }
  let bodyX = x;
  const icons = items.map(item => {
    const selected = item === main;
    const width = selected ? bodyWidth : circle;
    if (selected) bodyX = x;
    const end = item.iconEdge === 'end';
    const shellX = x + (selected && end ? width - circle : 0);
    const size = selected ? item.expandedIconSize ?? circle : circle;
    const center = selected ? (end ? x + width - (item.iconInset ?? circle / 2) : x + (item.iconInset ?? circle / 2)) : x + circle / 2;
    const pose = { id: item.id, shellX, x: size === circle ? shellX : center - size / 2,
      glyphOffset: size === circle ? center - shellX - circle / 2 : 0, size, selection: selected ? 1 : 0, visibility: 1 };
    x += width + gap;
    return pose;
  });
  return { mainId: main?.id ?? null, circle, bodyX, bodyWidth, bodyHeight, radius: main?.radius ?? circle / 2, icons, neck: 0 };
}
export interface ContainerTransition {
  id: number; startedAt: number; duration: number; easing: ContainerEasing;
  origin: ContainerGeometry; fromId: string | null; progress: number;
}
export interface ContainerMotion {
  geometry: ContainerGeometry;
  transition: ContainerTransition | null;
  revision: number;
}
export function createContainerMotion(geometry: ContainerGeometry): ContainerMotion {
  return { geometry, transition: null, revision: 0 };
}
export function requestContainerMotion(state: ContainerMotion, destination: ContainerGeometry, now: number,
  options: { immediate?: boolean; easing?: ContainerEasing } = {}): ContainerMotion {
  const current = state;
  if (options.immediate) return { geometry: destination, transition: null, revision: state.revision + 1 };
  const id = state.revision + 1;
  // Reversals continue from the displayed pose and use the remaining travel.
  const destinationSelection = new Map(destination.icons.map(icon => [icon.id, icon.selection]));
  const distance = Math.max(0, ...current.geometry.icons.map(icon => Math.abs(icon.selection - (destinationSelection.get(icon.id) ?? 0))));
  return { geometry: current.geometry, revision: id, transition: {
    id, startedAt: now, duration: containerMorphDuration * (distance > 0 ? Math.max(0.25, distance) : 1),
    easing: options.easing ?? 'editor', origin: current.geometry, fromId: current.geometry.mainId, progress: 0
  } };
}
/** Geometry and glyphs share one clock. Stale frames cannot overwrite a newer request. */
export function sampleContainerMotion(state: ContainerMotion, destination: ContainerGeometry, now: number, id = state.transition?.id): ContainerMotion {
  const transition = state.transition;
  if (!transition || transition.id !== id) return state;
  const elapsed = clamp((now - transition.startedAt) / transition.duration);
  if (elapsed >= 1) return { ...state, geometry: destination, transition: null };
  const progress = clockProgress(elapsed, transition.easing);
  return { ...state, transition: { ...transition, progress },
    geometry: interpolateContainers(transition.origin, destination, progress) };
}
export function interpolateContainers(origin: ContainerGeometry, destination: ContainerGeometry, progress: number, coordinated = false): ContainerGeometry {
  const p = clamp(progress);
  const changing = origin.mainId !== destination.mainId;
  const base = Math.min(origin.circle, destination.circle);
  // Preserve the Chat/Search choreography: compress, exchange, then unfold.
  const height = changing ? base + (origin.bodyHeight - base) * (1 - ramp(0, 0.25, p))
    + (destination.bodyHeight - base) * ramp(0.75, 1, p) : mix(origin.bodyHeight, destination.bodyHeight, p);
  // Reuse physical icon slots when an owner replaces an item (for example a
  // pane changes kind). The new key starts at the retiring slot's painted pose.
  // Extra additions/departures still fade; keyed content is never copied.
  const removed = origin.icons.filter(icon => !destination.icons.some(end => end.id === icon.id));
  const added = destination.icons.filter(icon => !origin.icons.some(start => start.id === icon.id));
  const replacements = new Map(added.slice(0, removed.length).map((icon, index) => [icon.id, removed[index]]));
  const replaced = new Set([...replacements.values()].map(icon => icon.id));
  const ids = [...new Set([...origin.icons.filter(icon => !replaced.has(icon.id)).map(icon => icon.id), ...destination.icons.map(icon => icon.id)])];
  const icons = ids.map(id => {
    const from = origin.icons.find(icon => icon.id === id) ?? replacements.get(id);
    const to = destination.icons.find(icon => icon.id === id);
    const start = from ?? { ...to!, x: to!.shellX, size: origin.circle, selection: 0, glyphOffset: 0, visibility: 0 };
    const end = to ?? { ...start, visibility: 0, selection: 0 };
    const selection = mix(start.selection, end.selection, p);
    const shellX = mix(start.shellX, end.shellX, p);
    const glyphProgress = changing && start.size !== end.size ? ramp(0.4, 0.86, end.selection > start.selection ? p : 1 - p) : p;
    const t = changing && start.size !== end.size && end.selection < start.selection ? 1 - glyphProgress : glyphProgress;
    const size = mix(start.size, end.size, t);
    // World-space layout travel must not be run through the icon-size handoff
    // a second time. Keep its center on the surrounding layout clock.
    const x = coordinated ? mix(start.x + start.size / 2, end.x + end.size / 2, p) - size / 2 : mix(start.x, end.x, t);
    return { id, shellX, x, size, selection,
      glyphOffset: mix(start.glyphOffset, end.glyphOffset, p), visibility: mix(start.visibility, end.visibility, p) };
  });
  return { mainId: destination.mainId, circle: mix(origin.circle, destination.circle, p), bodyX: mix(origin.bodyX, destination.bodyX, p),
    bodyWidth: mix(origin.bodyWidth, destination.bodyWidth, p), bodyHeight: height,
    radius: mix(origin.radius, destination.radius, p), icons,
    neck: changing ? Math.sin(Math.PI * ramp(0, 1, p)) : 0 };
}
