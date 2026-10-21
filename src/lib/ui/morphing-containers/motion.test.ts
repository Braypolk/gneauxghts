import { describe, expect, it } from 'vitest';
import { containerGeometry, createContainerMotion, requestContainerMotion, sampleContainerMotion,
  interpolateContainers, clockProgress, containerMorphDuration, type ContainerSpec } from './motion';

const measure = { width: 832, circle: 40, gap: 12 };
function items(ids: string[], selected: string | null, state: 'compact' | 'expanded' = 'expanded'): ContainerSpec[] {
  return ids.map(id => ({ id, state: id === selected ? state : 'icon',
    height: id === 'tall' ? 100 : 40, iconEdge: id === 'tall' ? 'end' : 'start',
    ...(id === 'tall' ? { expandedIconSize: 30, iconInset: 23 } : {}) }));
}

describe('content-agnostic morphing containers', () => {
  it('centers capped content without centering its unequal sibling icons', () => {
    for (const order of [['search', 'chat'], ['search', 'related', 'chat']]) {
      for (const selected of order) {
        const specs = items(order, selected);
        specs.find(item => item.id === selected)!.width = 832 - (order.length - 1) * 52;
        const geometry = containerGeometry(specs, { width: 1054, circle: 40, gap: 12, alignment: 'body' });
        expect(geometry.bodyX + geometry.bodyWidth / 2).toBe(527);
        expect(geometry.icons[0].shellX).toBeGreaterThanOrEqual(0);
        expect(geometry.icons.at(-1)!.shellX + 40).toBeLessThanOrEqual(1054);
      }
    }
  });
  it('uses the full narrow width when centered content would push icons outside', () => {
    for (const selected of ['search', 'chat']) {
      const specs = items(['search', 'chat'], selected);
      specs.find(item => item.id === selected)!.width = 780;
      const geometry = containerGeometry(specs, { width: 240, circle: 40, gap: 12, alignment: 'body' });
      expect(geometry.bodyWidth).toBe(188);
      expect(geometry.icons[0].shellX).toBe(0);
      expect(Math.max(geometry.bodyX + geometry.bodyWidth, ...geometry.icons.map(icon => icon.shellX + 40))).toBe(240);
    }
  });

  for (const order of [['a', 'b'], ['x', 'tall', 'z'], ['last', 'z', 'first', 'tall', 'other']]) {
    for (const from of order) for (const to of order.filter(id => id !== from)) {
      it(`exchanges ${from} → ${to} in caller order ${order.join(',')}`, () => {
        const origin = containerGeometry(items(order, from), measure);
        const destination = containerGeometry(items(order, to), measure);
        const moving = requestContainerMotion(createContainerMotion(origin), destination, 10);
        expect(moving.transition?.easing).toBe('editor');
        expect(moving.transition?.duration).toBe(containerMorphDuration);
        expect(origin.icons.map(icon => icon.id)).toEqual(order);
        const snapshots = [0, 0.1, 0.3, 0.5, 0.7, 0.9].map(t =>
          sampleContainerMotion(moving, destination, 10 + t * containerMorphDuration).geometry);
        for (const frame of snapshots) {
          expect(frame.bodyWidth).toBe(origin.bodyWidth);
          expect(frame.bodyX).toBeGreaterThanOrEqual(0);
          expect(frame.bodyX + frame.bodyWidth).toBeLessThanOrEqual(measure.width + 0.001);
          expect(frame.icons.every(icon => icon.visibility === 1)).toBe(true);
        }
        expect(snapshots[3].neck).toBeGreaterThan(0.99);
        expect(snapshots[3].bodyHeight).toBe(measure.circle);
        expect(sampleContainerMotion(moving, destination, 10 + containerMorphDuration).geometry).toEqual(destination);
      });
    }
  }
  it('keeps compact content distinct from both circles and expanded content', () => {
    const compact = items(['a', 'b'], 'a', 'compact');
    compact[0].width = 300;
    const info = containerGeometry(compact, measure);
    const expanded = containerGeometry(items(['a', 'b'], 'a'), measure);
    const circles = containerGeometry(items(['a', 'b'], null), measure);
    expect(info.bodyWidth).toBe(300);
    expect(expanded.bodyWidth).toBe(780);
    expect(circles.mainId).toBeNull();
    expect(circles.bodyWidth).toBe(0);
    const moving = requestContainerMotion(createContainerMotion(info), expanded, 0);
    const middle = sampleContainerMotion(moving, expanded, containerMorphDuration / 2);
    expect(middle.geometry.bodyWidth).toBeCloseTo(540, 3);
    expect(middle.geometry.neck).toBe(0);
  });
  it('clamps configured sizes before interpolating and retains full-size circle shells', () => {
    const first = items(['small', 'tall', 'third'], 'small'); first[0].width = 3000;
    const from = containerGeometry(first, measure);
    const to = containerGeometry(items(['small', 'tall', 'third'], 'tall'), measure);
    expect(from.bodyWidth).toBe(728);
    const frames = Array.from({ length: 101 }, (_, i) => interpolateContainers(from, to, i / 100));
    expect(new Set(frames.map(frame => frame.bodyWidth)).size).toBe(1);
    const positions = frames.map(frame => frame.icons.find(icon => icon.id === 'tall')!.x);
    const direction = Math.sign(positions.at(-1)! - positions[0]);
    expect(positions.slice(1).every((x, i) => (x - positions[i]) * direction >= -0.001)).toBe(true);
    expect(frames.every(frame => frame.icons.every(icon => icon.visibility === 1))).toBe(true);
  });
  it('preserves configured dimensions, wrapped content height and radius', () => {
    const configured: ContainerSpec[] = [{ id: 'info', state: 'expanded', width: 350, height: 90, radius: 12 },
      { id: 'icon', state: 'icon' }];
    const geometry = containerGeometry(configured, measure);
    expect(geometry.bodyWidth).toBe(350); expect(geometry.bodyHeight).toBe(90); expect(geometry.radius).toBe(12);
    expect(geometry.icons[1].size).toBe(40);
  });
  it('compresses two tall surfaces to the circle before exchanging them', () => {
    const first = items(['one', 'two'], 'one'); first[0].height = 92;
    const second = items(['one', 'two'], 'two'); second[1].height = 116;
    const middle = interpolateContainers(containerGeometry(first, measure), containerGeometry(second, measure), 0.5);
    expect(middle.bodyHeight).toBe(40);
  });
  it('uses the editor/chat Bézier curve by default and retains explicit pinch pacing', () => {
    expect(clockProgress(60 / containerMorphDuration, 'pinch')).toBeCloseTo(0.104, 5);
    expect(clockProgress(1 - 60 / containerMorphDuration, 'pinch')).toBeCloseTo(0.896, 5);
    expect(clockProgress(0.5)).toBeCloseTo(0.5, 5);
    expect(clockProgress(0.1)).toBeLessThan(0.02);
    expect(clockProgress(0.9)).toBeGreaterThan(0.98);
    expect(clockProgress(0)).toBeCloseTo(0, 5); expect(clockProgress(1)).toBeCloseTo(1, 5);
  });
  it('retargets a third item from the current pose and ignores obsolete frames', () => {
    const order = ['a', 'tall', 'c'];
    const from = containerGeometry(items(order, 'a'), measure);
    const to = containerGeometry(items(order, 'tall'), measure);
    let moving = requestContainerMotion(createContainerMotion(from), to, 0);
    const oldId = moving.transition!.id;
    moving = sampleContainerMotion(moving, to, 160);
    const before = moving.geometry;
    const third = containerGeometry(items(order, 'c'), measure);
    moving = requestContainerMotion(moving, third, 160);
    expect(moving.geometry).toEqual(before);
    expect(sampleContainerMotion(moving, third, 10000, oldId)).toBe(moving);
    expect(sampleContainerMotion(moving, third, 10000).geometry).toEqual(third);
  });
  it('can add, remove, and reorder arbitrary item keys while moving', () => {
    const from = containerGeometry(items(['a', 'b', 'c'], 'b'), measure);
    const to = containerGeometry(items(['c', 'd', 'a', 'e'], 'd'), measure);
    const middle = interpolateContainers(from, to, 0.5);
    expect(middle.icons.find(icon => icon.id === 'b')).toBeUndefined();
    expect(middle.icons.find(icon => icon.id === 'd')?.visibility).toBe(1);
    expect(middle.icons.find(icon => icon.id === 'e')?.visibility).toBe(0.5);
    const moving = requestContainerMotion(createContainerMotion(from), to, 0);
    expect(sampleContainerMotion(moving, to, 10000).geometry.icons.map(icon => icon.id)).toEqual(['c', 'd', 'a', 'e']);
  });
  it('keeps world-space icon centers on the coordinated layout clock', () => {
    const origin = containerGeometry(items(['one', 'tall'], 'tall'), measure);
    const destination = containerGeometry(items(['one', 'replacement'], 'one'), { ...measure, width: 400 });
    for (const p of [0, 0.1, 0.4, 0.5, 0.6, 0.9, 1]) {
      const geometry = interpolateContainers(origin, destination, p, true);
      const icon = geometry.icons.find(icon => icon.id === 'replacement')!;
      const start = origin.icons[1], end = destination.icons[1];
      expect(icon.x + icon.size / 2).toBeCloseTo(start.x + start.size / 2 + (end.x + end.size / 2 - start.x - start.size / 2) * p, 5);
    }
  });
  it('settles immediately for reduced motion and resize', () => {
    const from = containerGeometry(items(['a', 'b'], 'a'), measure);
    const to = containerGeometry(items(['a', 'b'], 'b'), measure);
    expect(requestContainerMotion(createContainerMotion(from), to, 0, { immediate: true }).transition).toBeNull();
  });
});
