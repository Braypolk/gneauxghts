import { describe, expect, it } from 'vitest';
import sidewaysGateway from './fixtures/sidewaysGateway.json';
import type { AtlasLink } from '$lib/types/atlas';
import { createDemoAtlas } from '../../../../scripts/fixtures/atlasDemo';
import { createAtlasRouting } from './atlasRouting';
import { createAtlasLayout, nodeWorldRadius, type Point } from './atlasLayout';

const sample = createDemoAtlas().nodes[0];
const mark = (id: string, x: number, y: number, rootId: string | null = null) => ({
  x, y, rootId, node: { ...sample, id, title: id, fileName: `${id}.md`, centrality: 0 }
});
const cloud = (id: string, x: number, y: number, halfWidth: number, halfHeight: number) => ({
  cloud: { id, label: id }, labelPoint: { x, y: y - halfHeight + 15 }, labelFontSize: 8,
  points: [{ x: x - halfWidth, y: y - halfHeight }, { x: x + halfWidth, y: y - halfHeight },
    { x: x + halfWidth, y: y + halfHeight }, { x: x - halfWidth, y: y + halfHeight }]
});
const link = (sourceId = 'a', targetId = 'b'): AtlasLink => ({ id: `${sourceId}-${targetId}`, sourceId, targetId, kind: 'semantic', strength: 0.95, score: 0.9 });
const distanceFrom = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
// Sample the public cubic SVG output, including the actual smoothed curves.
function samplePath(path: string): Point[] {
  const tokens = path.match(/[MC]|-?\d+(?:\.\d+)?/g)!;
  const result: Point[] = [];
  let i = 0, previous: Point = { x: 0, y: 0 };
  const point = () => ({ x: Number(tokens[i++]), y: Number(tokens[i++]) });
  while (i < tokens.length) {
    const command = tokens[i++];
    if (command === 'M') { previous = point(); result.push(previous); continue; }
    const c1 = point(), c2 = point(), end = point();
    for (let j = 1; j <= 80; j++) {
      const t = j / 80, u = 1 - t;
      result.push({ x: u ** 3 * previous.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * end.x,
        y: u ** 3 * previous.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * end.y });
    }
    previous = end;
  }
  return result;
}
function expectForward(points: Point[], a: Point, b: Point) {
  const progress = points.map(p => ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / Math.hypot(b.x - a.x, b.y - a.y));
  expect(progress.every((value, i) => i === 0 || value >= progress[i - 1] - 0.02)).toBe(true);
}

describe('Atlas obstacle-aware connections', () => {
  it('curves around an unrelated cloud and enters the endpoint regions only once', () => {
    const geometry = { nodes: [mark('a', -220, 0, 'source'), mark('b', 220, 0, 'target')],
      clouds: [cloud('source', -220, 0, 50, 60), cloud('obstacle', 0, 0, 70, 80), cloud('target', 220, 0, 50, 60)] };
    const path = createAtlasRouting()(geometry, [link()]).paths.get('a-b')!.path;
    const points = samplePath(path);
    expect(path).toContain('C');
    expectForward(points, geometry.nodes[0], geometry.nodes[1]);
    expect(points.every(p => !(Math.abs(p.x) < 80 && Math.abs(p.y) < 90))).toBe(true);
    const transitions = (predicate: (p: Point) => boolean) => points.map(predicate).filter((value, i, values) => i === 0 || value !== values[i - 1]);
    expect(transitions(p => Math.abs(p.x + 220) <= 50 && Math.abs(p.y) <= 60)).toEqual([true, false]);
    expect(transitions(p => Math.abs(p.x - 220) <= 50 && Math.abs(p.y) <= 60)).toEqual([false, true]);
    expect(Math.hypot(points[0].x + 220, points[0].y)).toBeCloseTo(nodeWorldRadius(geometry.nodes[0].node), 1);
    expect(Math.hypot(points.at(-1)!.x - 220, points.at(-1)!.y)).toBeCloseTo(nodeWorldRadius(geometry.nodes[1].node), 1);
  });

  it('avoids unrelated dots and filenames within the same cloud', () => {
    const blocker = mark('A very long filename covering the direct path', 0, -15, 'region');
    const geometry = { nodes: [mark('a', -150, 0, 'region'), mark('b', 150, 0, 'region'), blocker],
      clouds: [cloud('region', 0, 0, 230, 110)] };
    const points = samplePath(createAtlasRouting()(geometry, [link()]).paths.get('a-b')!.path);
    expect(points.every(p => Math.hypot(p.x, p.y + 15) > 7)).toBe(true);
    expect(points.every(p => !(Math.abs(p.x) < 70 && p.y > -10 && p.y < 4))).toBe(true);
    expect(points.every(p => Math.abs(p.x) <= 230 && Math.abs(p.y) <= 110)).toBe(true);
  });

  it('retains existing routes when connections are added, reordered or metadata changes', () => {
    const route = createAtlasRouting();
    const geometry = { nodes: [mark('a', -200, 0), mark('b', 200, 0), mark('c', 200, 70)], clouds: [] };
    const first = route(geometry, [link()]).paths.get('a-b')!.path;
    expect(first).toContain('C');
    const more = route(geometry, [link('a', 'c'), link()]);
    expect(more.paths.get('a-b')!.path).toBe(first);
    expect(route({ ...geometry, nodes: geometry.nodes.map(node => ({ ...node, node: { ...node.node, preview: 'Updated excerpt' } })) }, [link()]).paths.get('a-b')!.path).toBe(first);
    expect(route(geometry, [link()]).paths.get('a-b')!.path).toBe(first);
    expect(route({ ...geometry, nodes: geometry.nodes.map(node => node.node.id === 'b' ? { ...node, x: 250 } : node) }, [link()]).paths.get('a-b')!.path).not.toBe(first);
  });

  it('uses shorter clear routes when sharing adds excessive travel and stays stable through filtering', () => {
    const geometry = { nodes: [mark('a', -220, 0, 'source'), mark('b', 220, 0, 'target'), mark('c', 220, 70, 'target')],
      clouds: [cloud('source', -220, 0, 50, 90), cloud('obstacle', 0, 80, 70, 160), cloud('target', 220, 35, 50, 100)] };
    const route = createAtlasRouting();
    const result = route(geometry, [link(), link('c', 'a')], 'a');
    // The old shared trunk travelled 812/873 units; independent clear routes
    // need about 502/552. Sharing must not force that avoidable excursion.
    expect(result.trunks).toHaveLength(0);
    const first = result.paths.get('a-b')!, second = result.paths.get('c-a')!;
    for (const [i, connection] of [first, second].entries()) {
      const points = samplePath(connection.path);
      expect(points.every(p => !(Math.abs(p.x) < 78 && p.y > -88 && p.y < 248))).toBe(true);
      const travel = points.slice(1).reduce((sum, p, j) => sum + distanceFrom(points[j], p), 0);
      expect(travel).toBeLessThan(distanceFrom(geometry.nodes[0], geometry.nodes[i + 1]) * 1.3);
    }
    expect(route(geometry, [link()], 'a').paths.get('a-b')!.path).toBe(first.path);
    const reordered = route(geometry, [link('c', 'a'), link()], 'a');
    expect(reordered.paths.get('a-b')!.path).toBe(first.path);
    expect(reordered.paths.get('c-a')!.path).toBe(second.path);
  });

  it('spreads the bend across a branch with continuous curvature and modest travel distance', () => {
    const a = mark('a', -240, 0, 'source'), b = mark('b', 240, -40, 'target'), c = mark('c', 240, 80, 'target');
    const geometry = { nodes: [a, b, c], clouds: [cloud('source', -240, 0, 90, 110), cloud('target', 240, 20, 90, 110)] };
    const result = createAtlasRouting()(geometry, [link(), link('a', 'c')], 'a');
    expect(result.trunks).toHaveLength(1);
    const branch = result.paths.get('a-c')!.branch;
    const numbers = branch.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
    const knots = [];
    let p = { x: numbers[0], y: numbers[1] };
    for (let i = 2; i < numbers.length; i += 6) {
      const c1 = { x: numbers[i], y: numbers[i + 1] }, c2 = { x: numbers[i + 2], y: numbers[i + 3] }, q = { x: numbers[i + 4], y: numbers[i + 5] };
      const curvature = (d: Point, dd: Point) => (d.x * dd.y - d.y * dd.x) / Math.hypot(d.x, d.y) ** 3;
      knots.push({ start: curvature({ x: 3 * (c1.x - p.x), y: 3 * (c1.y - p.y) }, { x: 6 * (p.x - 2 * c1.x + c2.x), y: 6 * (p.y - 2 * c1.y + c2.y) }),
        end: curvature({ x: 3 * (q.x - c2.x), y: 3 * (q.y - c2.y) }, { x: 6 * (q.x - 2 * c2.x + c1.x), y: 6 * (q.y - 2 * c2.y + c1.y) }) });
      p = q;
    }
    expect(knots.length).toBeGreaterThan(1);
    expect(knots.some(knot => Math.abs(knot.start) > 0.001)).toBe(true);
    for (let i = 1; i < knots.length; i++) expect(Math.abs(knots[i - 1].end - knots[i].start)).toBeLessThan(0.00015);
    const full = samplePath(result.paths.get('a-c')!.path);
    expectForward(full, a, c);
    const length = full.reduce((sum, p, i) => sum + (i ? Math.hypot(p.x - full[i - 1].x, p.y - full[i - 1].y) : 0), 0);
    expect(length).toBeLessThan(Math.hypot(c.x - a.x, c.y - a.y) * 1.2);
  });

  it('shares a longer approach for nearby destinations without moving routes when filtered', () => {
    const a = mark('a', -400, 0, 'source'), b = mark('b', 400, -25, 'target'), c = mark('c', 420, 25, 'target');
    const geometry = { nodes: [a, b, c, mark('d', 300, 190, 'target'), mark('e', 300, -190, 'target')],
      clouds: [cloud('source', -400, 0, 70, 70), cloud('target', 340, 0, 180, 240)] };
    const route = createAtlasRouting();
    const result = route(geometry, [link(), link('a', 'c'), link('a', 'd')], 'a');
    expect(result.trunks).toHaveLength(2);
    const extended = result.trunks.find(trunk => trunk.linkIds.length === 2)!;
    expect(extended.linkIds.sort()).toEqual(['a-b', 'a-c']);
    expect(samplePath(extended.path).at(-1)!.x).toBeGreaterThan(300);
    for (const id of ['a-b', 'a-c']) {
      const full = result.paths.get(id)!;
      expect(full.trunkId).toBe(extended.id);
      const endpoint = id === 'a-b' ? b : c;
      expectForward(samplePath(full.path), a, endpoint);
      for (const unrelated of geometry.nodes.filter(node => node !== a && node !== endpoint)) {
        expect(Math.min(...samplePath(full.path).map(p => distanceFrom(p, unrelated) - nodeWorldRadius(unrelated.node)))).toBeGreaterThan(5.98);
      }
    }
    const filtered = route(geometry, [link(), link('a', 'd')], 'a');
    expect(filtered.trunks).toHaveLength(1);
    expect(filtered.paths.get('a-b')!.path).toBe(result.paths.get('a-b')!.path);
    expect(samplePath(filtered.paths.get('a-b')!.branch)[0]).toEqual(samplePath(filtered.trunks[0].path).at(-1));
    const restored = route(geometry, [link('a', 'd'), link('a', 'c'), link()], 'a');
    expect(restored.paths.get('a-b')!.path).toBe(result.paths.get('a-b')!.path);
    expect(restored.trunks.find(trunk => trunk.id === extended.id)!.path).toBe(extended.path);
  });

  it('keeps six world units of clearance from unrelated dots along shared branches', () => {
    const a = mark('a', 0, -360, 'source'), b = mark('b', 0, 160, 'target'), c = mark('c', 100, 100, 'target');
    const blocker = mark('unrelated', 2, 140, 'target');
    const geometry = { nodes: [a, b, c, blocker], clouds: [cloud('source', 0, -360, 70, 70), cloud('target', 0, 90, 150, 170)] };
    const result = createAtlasRouting()(geometry, [link(), link('a', 'c')], 'a');
    for (const id of ['a-b', 'a-c']) {
      const samples = samplePath(result.paths.get(id)!.path);
      const gap = Math.min(...samples.map(p => Math.hypot(p.x - blocker.x, p.y - blocker.y) - nodeWorldRadius(blocker.node)));
      expect(gap).toBeGreaterThanOrEqual(5.98);
    }
  });

  it('eases into a highway fork instead of concentrating its bend at the junction', () => {
    const a = mark('a', 0, -400, 'source'), b = mark('b', -80, 170, 'target'), c = mark('c', 110, 100, 'target');
    const geometry = { nodes: [a, b, c], clouds: [cloud('source', 0, -400, 70, 70), cloud('target', 0, 90, 150, 170)] };
    const result = createAtlasRouting()(geometry, [link(), link('a', 'c')], 'a');
    expect(result.trunks).toHaveLength(1);
    for (const route of result.paths.values()) {
      const numbers = route.branch.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      const p = { x: numbers[0], y: numbers[1] }, c1 = { x: numbers[2], y: numbers[3] }, c2 = { x: numbers[4], y: numbers[5] };
      const dx = 3 * (c1.x - p.x), dy = 3 * (c1.y - p.y);
      const ddx = 6 * (p.x - 2 * c1.x + c2.x), ddy = 6 * (p.y - 2 * c1.y + c2.y);
      const curvature = Math.abs(dx * ddy - dy * ddx) / Math.hypot(dx, dy) ** 3;
      expect(curvature).toBeLessThan(0.001);
    }
  });

  it('does not force a sharp arrival into a shared highway after avoiding a cloud', () => {
    const a = mark('a', 260, 200, 'source'), b = mark('b', -260, 0, 'target'), c = mark('c', -260, 60, 'target');
    const geometry = { nodes: [a, b, c], clouds: [cloud('source', 260, 200, 50, 70),
      cloud('obstacle', -30, 20, 90, 60), cloud('target', -260, 30, 50, 90)] };
    const result = createAtlasRouting()(geometry, [link(), link('a', 'c')], 'a');
    expect(result.trunks.length).toBeGreaterThan(0);
    for (const trunk of result.trunks) {
      const n = trunk.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
      const c1 = { x: n.at(-6)!, y: n.at(-5)! }, c2 = { x: n.at(-4)!, y: n.at(-3)! }, q = { x: n.at(-2)!, y: n.at(-1)! };
      const dx = 3 * (q.x - c2.x), dy = 3 * (q.y - c2.y);
      const ddx = 6 * (q.x - 2 * c2.x + c1.x), ddy = 6 * (q.y - 2 * c2.y + c1.y);
      expect(Math.abs(dx * ddy - dy * ddx) / Math.hypot(dx, dy) ** 3).toBeLessThan(0.001);
      expect(samplePath(trunk.path).every(p => !(p.x > -128 && p.x < 68 && p.y > -48 && p.y < 88))).toBe(true);
    }
  });

  it('travels toward a western destination without a backward cloud exit', () => {
    const a = mark('a', 50, 40, 'source'), b = mark('b', -240, 70, 'target');
    const geometry = { nodes: [a, b, mark('nearby', 30, 65, 'source')],
      clouds: [cloud('source', 0, 0, 90, 120), cloud('target', -240, 70, 80, 70)] };
    const path = createAtlasRouting()(geometry, [link()], 'a').paths.get('a-b')!.path;
    expectForward(samplePath(path), a, b);
    expect(samplePath(path)[0].x).toBeLessThan(a.x);
  });

  it('keeps every requested authored route and safely handles absent/coincident endpoints', () => {
    const nodes = [mark('a', 0, 0), ...Array.from({ length: 25 }, (_, i) => mark(`n${i}`, 200 + i % 5 * 80, -160 + Math.floor(i / 5) * 80))];
    const links = nodes.slice(1).map(node => ({ ...link('a', node.node.id), kind: 'wikilink' as const }));
    const route = createAtlasRouting();
    const paths = route({ nodes, clouds: [] }, links);
    expect(paths.paths.size).toBe(25);
    expect([...paths.paths.values()].every(route => route.path.startsWith('M') && !route.path.includes('NaN'))).toBe(true);
    expect(route({ nodes, clouds: [] }, [link('a', 'missing')]).paths.get('a-missing')!.path).toBe('');
    expect(route({ nodes: [mark('a', 0, 0), mark('b', 0, 0)], clouds: [] }, [link()]).paths.get('a-b')!.path).toBe('');
  });

  it('routes the demo vault through the same packed geometry used by the map', () => {
    const atlas = createDemoAtlas();
    const geometry = createAtlasLayout()(atlas);
    const routes = createAtlasRouting()(geometry, atlas.links);
    expect(routes.paths.size).toBe(atlas.links.length);
    expect([...routes.paths.values()].every(route => route.path.startsWith('M') && !route.path.includes('NaN'))).toBe(true);
  });

  it('retains a connection when overlapping geometry makes strict cloud avoidance impossible', () => {
    const geometry = { nodes: [mark('a', -100, 0), mark('b', 100, 0)], clouds: [cloud('overlapping-region', 0, 0, 300, 200)] };
    const authored = { ...link(), kind: 'wikilink' as const, strength: 0.01 };
    const path = createAtlasRouting()(geometry, [authored]).paths.get(authored.id)!.path;
    const points = samplePath(path);
    expect(points.length).toBeGreaterThan(1);
    expect(points.every(p => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(Math.abs(points.at(-1)!.x - 100)).toBeLessThan(7);
  });
});

  it('chooses a short shared approach instead of a feasible sideways gateway with a huge loop', () => {
    // An irregular destination plus a dot near the source makes the first
    // feasible gateway require a long sideways excursion to match its tangent.
    const geometry = { ...sidewaysGateway,
      nodes: sidewaysGateway.nodes.map(n => ({ ...n, node: { ...sample, ...n.node } })) };
    const points = samplePath(createAtlasRouting()(geometry, [link()], 'a').paths.get('a-b')!.path);
    const chord = distanceFrom(geometry.nodes[0], geometry.nodes[1]);
    const travel = points.slice(1).reduce((sum, p, i) => sum + distanceFrom(points[i], p), 0);
    expect(travel / chord).toBeLessThan(1.5);
    expectForward(points, geometry.nodes[0], geometry.nodes[1]);
    expect(points.every(p => distanceFrom(p, geometry.nodes[2]) >= nodeWorldRadius(geometry.nodes[2].node) + 6)).toBe(true);
  });
