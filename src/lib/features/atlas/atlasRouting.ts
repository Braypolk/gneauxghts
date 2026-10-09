import type { AtlasLink, AtlasNode } from '$lib/types/atlas';
import { pointSegmentDistance, polygonProximity, preparePolygonCoverage } from './atlasGeometry';
import { labelWorldSize, nodeWorldRadius, noteTitle, titleWidth, type Point } from './atlasLayout';

type Mark = Point & { rootId: string | null; node: AtlasNode };
type Cloud = { cloud: { id: string; label: string | null; parentId?: string | null }; points: Point[]; labelPoint: Point; labelFontSize: number };
type Geometry = { nodes: Mark[]; clouds: Cloud[] };
export type RoutedConnection = { path: string; branch: string; trunkId: string | null };
export type RoutedConnections = { paths: Map<string, RoutedConnection>; trunks: { id: string; path: string; kind: AtlasLink['kind']; linkIds: string[] }[] };
type SmoothPath = { path: string; length: number; clear: boolean };
type Highway = { length: number; id: string; point: Point; tangent: Point; path: string; segment: string; parentId: string | null };
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mix = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const nodeGap = 6;
const format = (p: Point) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`;

// Both spline strategies validate at the same resolution along each cubic.
function appendCubic(samples: Point[], p: Point, c1: Point, c2: Point, q: Point) {
  const count = Math.max(12, Math.ceil((distance(p, c1) + distance(c1, c2) + distance(c2, q)) / 4));
  for (let j = 1; j <= count; j++) {
    const t = j / count, u = 1 - t;
    samples.push({ x: u ** 3 * p.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t ** 3 * q.x,
      y: u ** 3 * p.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t ** 3 * q.y });
  }
  return `C${format(c1)} ${format(c2)} ${format(q)}`;
}

// World-space routing reserves room for broad splines. Notes/titles influence
// path cost, rather than forcing tiny hard turns or backward exits from a cloud.
class Router {
  private readonly step: number;
  private readonly left: number;
  private readonly top: number;
  private readonly columns: number;
  private readonly rows: number;
  private readonly cloudMask: Int32Array;
  private readonly cloudBounds: { left: number; right: number; top: number; bottom: number }[];
  private readonly noteMask: Int32Array;
  private readonly overlaps = new Map<number, number[]>();
  private readonly nodeBuckets = new Map<string, number[]>();
  private readonly maximumNodeRadius: number;
  private readonly marks: Map<string, number>;
  private readonly roots: Map<string, number>;
  private readonly routes = new Map<string, RoutedConnection>();
  private readonly highways = new Map<string, Highway>();
  private readonly unavailableHighways = new Set<string>();
  private readonly approachGroups = new Map<string, number[][]>();
  private readonly costs: Float64Array;
  private readonly parents: Int32Array;
  private readonly seen: Uint32Array;
  private readonly closed: Uint32Array;
  private generation = 0;
  constructor(private readonly geometry: Geometry) {
    this.maximumNodeRadius = geometry.nodes.reduce((radius, mark) => Math.max(radius, nodeWorldRadius(mark.node)), 0);
    this.cloudBounds = geometry.clouds.map(({ points }) => ({ left: Math.min(...points.map(p => p.x)), right: Math.max(...points.map(p => p.x)),
      top: Math.min(...points.map(p => p.y)), bottom: Math.max(...points.map(p => p.y)) }));
    this.marks = new Map(geometry.nodes.map((mark, i) => [mark.node.id, i]));
    this.roots = new Map(geometry.clouds.map((cloud, i) => [cloud.cloud.id, i + 1]));
    const points = geometry.clouds.flatMap(cloud => cloud.points).concat(geometry.nodes.flatMap(mark => {
      const width = titleWidth(noteTitle(mark.node), labelWorldSize) / 2;
      return [{ x: mark.x - width, y: mark.y - 20 }, { x: mark.x + width, y: mark.y + 25 }];
    }));
    this.left = Math.min(0, ...points.map(p => p.x)) - 80;
    this.top = Math.min(0, ...points.map(p => p.y)) - 80;
    const width = Math.max(0, ...points.map(p => p.x)) + 80 - this.left;
    const height = Math.max(0, ...points.map(p => p.y)) + 80 - this.top;
    this.step = Math.max(8, Math.sqrt(width * height / 150_000));
    this.columns = Math.ceil(width / this.step) + 1;
    this.rows = Math.ceil(height / this.step) + 1;
    const cells = this.columns * this.rows;
    this.cloudMask = new Int32Array(cells);
    this.noteMask = new Int32Array(cells);
    this.costs = new Float64Array(cells);
    this.parents = new Int32Array(cells);
    this.seen = new Uint32Array(cells);
    this.closed = new Uint32Array(cells);
    geometry.clouds.forEach((cloud, i) => {
      if (cloud.points.length < 3) return;
      this.raster(cloud.points, 28 + this.step / 2, cell => this.cloudMask[cell] = i + 1);
      const half = titleWidth((cloud.cloud.label || 'Unlabelled region').slice(0, 32), cloud.labelFontSize) * 0.56;
      this.rectangle(cloud.labelPoint.x - half - 3, cloud.labelPoint.y - cloud.labelFontSize - 3,
        cloud.labelPoint.x + half + 3, cloud.labelPoint.y + 5, geometry.nodes.length * 2 + i + 1, this.step / 2);
    });
    geometry.nodes.forEach((mark, i) => {
      const bucket = `${Math.floor(mark.x / 64)},${Math.floor(mark.y / 64)}`;
      const nearby = this.nodeBuckets.get(bucket) ?? []; nearby.push(i); this.nodeBuckets.set(bucket, nearby);
      const radius = nodeWorldRadius(mark.node) + nodeGap + this.step / 2;
      this.rectangle(mark.x - radius, mark.y - radius, mark.x + radius, mark.y + radius, i + 1);
      const half = titleWidth(noteTitle(mark.node), labelWorldSize) * 0.56 + 3;
      const y = mark.y + nodeWorldRadius(mark.node) + 3;
      this.rectangle(mark.x - half, y - 2, mark.x + half, y + labelWorldSize + 3, geometry.nodes.length + i + 1, this.step / 2);
    });
  }
  private point(cell: number): Point { return { x: this.left + (cell % this.columns) * this.step, y: this.top + Math.floor(cell / this.columns) * this.step }; }
  private cell(p: Point) {
    const x = Math.round((p.x - this.left) / this.step), y = Math.round((p.y - this.top) / this.step);
    return x < 0 || y < 0 || x >= this.columns || y >= this.rows ? -1 : y * this.columns + x;
  }
  private eachCell(left: number, top: number, right: number, bottom: number, visit: (cell: number, point: Point) => void) {
    const x0 = Math.max(0, Math.ceil((left - this.left) / this.step));
    const x1 = Math.min(this.columns - 1, Math.floor((right - this.left) / this.step));
    const y0 = Math.max(0, Math.ceil((top - this.top) / this.step));
    const y1 = Math.min(this.rows - 1, Math.floor((bottom - this.top) / this.step));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const cell = y * this.columns + x; visit(cell, this.point(cell));
    }
  }
  private rectangle(left: number, top: number, right: number, bottom: number, owner: number, padding = 0) {
    this.eachCell(left - padding, top - padding, right + padding, bottom + padding, cell => {
      const previous = this.noteMask[cell];
      if (!previous) this.noteMask[cell] = owner;
      else if (previous !== owner) {
        const owners = this.overlaps.get(cell) ?? [previous];
        if (!owners.includes(owner)) owners.push(owner);
        this.overlaps.set(cell, owners);
      }
    });
  }
  private raster(polygon: Point[], margin: number, visit: (cell: number) => void) {
    const covers = preparePolygonCoverage(polygon, margin);
    this.eachCell(Math.min(...polygon.map(p => p.x)) - margin, Math.min(...polygon.map(p => p.y)) - margin,
      Math.max(...polygon.map(p => p.x)) + margin, Math.max(...polygon.map(p => p.y)) + margin, (cell, p) => {
        if (covers(p)) visit(cell);
      });
  }
  private notePenalty(cell: number, endpoints: Set<number>): number {
    if (cell < 0) return 0;
    const owner = this.noteMask[cell];
    if (!owner) return 0;
    let penalty = 0;
    for (const id of this.overlaps.get(cell) ?? [owner]) {
      const node = (id - 1) % this.geometry.nodes.length;
      if (id <= this.geometry.nodes.length * 2 && endpoints.has(node)) continue;
      penalty = Math.max(penalty, id <= this.geometry.nodes.length ? 5 : 1.2);
    }
    return penalty;
  }
  private nodeFree(cell: number, endpoints: Set<number>) {
    const owner = this.noteMask[cell];
    return !owner || (this.overlaps.get(cell) ?? [owner]).every(id => id > this.geometry.nodes.length || endpoints.has(id - 1));
  }
  // Validate the final sampled curve segments, not only its seed/grid knots.
  // Circle clearance is independent of opacity, labels or connection strength.
  private nodesClear(points: Point[], endpoints: Set<number>, gap = nodeGap + 0.3) {
    const maximumRadius = this.maximumNodeRadius + gap;
    for (let i = 0; i < points.length; i++) {
      const a = points[Math.max(0, i - 1)], b = points[i];
      // Walk long segments through small neighborhoods rather than scanning the
      // whole vault (or every cell in a diagonal segment's bounding rectangle).
      const pieces = Math.max(1, Math.ceil(distance(a, b) / 48));
      for (let piece = 0; piece < pieces; piece++) {
        const left = mix(a, b, piece / pieces), right = mix(a, b, (piece + 1) / pieces);
        const x0 = Math.floor((Math.min(left.x, right.x) - maximumRadius) / 64), x1 = Math.floor((Math.max(left.x, right.x) + maximumRadius) / 64);
        const y0 = Math.floor((Math.min(left.y, right.y) - maximumRadius) / 64), y1 = Math.floor((Math.max(left.y, right.y) + maximumRadius) / 64);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
          for (const index of this.nodeBuckets.get(`${x},${y}`) ?? []) {
            if (endpoints.has(index)) continue;
            const mark = this.geometry.nodes[index], radius = nodeWorldRadius(mark.node) + gap;
            if (pointSegmentDistance(mark, a, b) < radius) return false;
          }
        }
      }
    }
    return true;
  }

  private cloudClear(points: Point[], allowed: Set<number>, margin = 8) {
    for (let index = 0; index < this.geometry.clouds.length; index++) {
      if (allowed.has(index + 1)) continue;
      const polygon = this.geometry.clouds[index].points;
      if (polygon.length < 3) continue;
      const bounds = this.cloudBounds[index];
      const left = bounds.left - margin, right = bounds.right + margin;
      const top = bounds.top - margin, bottom = bounds.bottom + margin;
      for (const p of points) {
        if (p.x < left || p.x > right || p.y < top || p.y > bottom) continue;
        const { inside, distance } = polygonProximity(p, polygon);
        if (inside || distance < margin) return false;
      }
    }
    return true;
  }
  private sampleLine(a: Point, b: Point): Point[] {
    const count = Math.max(2, Math.ceil(distance(a, b) / (this.step / 2)));
    return Array.from({ length: count + 1 }, (_, i) => mix(a, b, i / count));
  }
  private search(a: Point, b: Point, allowed: Set<number>, endpoints: Set<number>, relaxed: boolean): Point[] | null {
    const start = this.cell(a), end = this.cell(b);
    if (start < 0 || end < 0) return null;
    const stamp = ++this.generation, length = distance(a, b);
    // Exact free-space cost on this eight-direction grid. Euclidean distance
    // leaves a large search band on long diagonals and can exhaust the budget
    // before finding a simple nearby detour.
    const remaining = (cell: number) => {
      const dx = Math.abs(cell % this.columns - end % this.columns);
      const dy = Math.abs(Math.floor(cell / this.columns) - Math.floor(end / this.columns));
      return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
    };
    const ray = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const progress = (cell: number) => { const p = this.point(cell); return (p.x - a.x) * ray.x + (p.y - a.y) * ray.y; };
    const free = (cell: number) => this.nodeFree(cell, endpoints) && (!this.cloudMask[cell] || allowed.has(this.cloudMask[cell]) || relaxed);
    const heap: { cell: number; cost: number; remaining: number }[] = [];
    // Equal-cost diagonal grid paths form a wide plateau. Prefer progress to
    // the goal, rather than spending the bounded search on every equivalent path.
    const compare = (a: typeof heap[number], b: typeof heap[number]) =>
      Math.round(a.cost * 1e7) - Math.round(b.cost * 1e7) || a.remaining - b.remaining;
    const push = (entry: typeof heap[number]) => {
      let i = heap.length; heap.push(entry);
      while (i > 0) { const parent = (i - 1) >> 1; if (compare(heap[parent], entry) <= 0) break; heap[i] = heap[parent]; i = parent; }
      heap[i] = entry;
    };
    const pop = () => {
      const first = heap[0], last = heap.pop()!;
      if (heap.length) {
        let i = 0;
        while (i * 2 + 1 < heap.length) {
          let child = i * 2 + 1;
          if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) < 0) child++;
          if (compare(heap[child], last) >= 0) break;
          heap[i] = heap[child]; i = child;
        }
        heap[i] = last;
      }
      return first.cell;
    };
    this.seen[start] = stamp; this.costs[start] = 0; this.parents[start] = -1;
    push({ cell: start, cost: remaining(start), remaining: remaining(start) });
    let expanded = 0;
    while (heap.length && expanded++ < 30_000) {
      const cell = pop();
      if (this.closed[cell] === stamp) continue;
      this.closed[cell] = stamp;
      if (cell === end) {
        const points: Point[] = [];
        for (let cursor = cell; cursor >= 0; cursor = this.parents[cursor]) {
          if (progress(cursor) > 0 && progress(cursor) < length) points.push(this.point(cursor));
        }
        return [a, ...points.reverse(), b];
      }
      const x = cell % this.columns, y = Math.floor(cell / this.columns);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy || x + dx < 0 || x + dx >= this.columns || y + dy < 0 || y + dy >= this.rows) continue;
        const next = cell + dy * this.columns + dx;
        // A route may move sideways around an obstacle, never back toward its
        // source. Endpoint rounding gets at most one grid-cell of tolerance.
        if (progress(next) < progress(cell) - 0.001 || progress(next) < -this.step || progress(next) > length + this.step) continue;
        if (!free(next) || dx && dy && (!free(cell + dx) || !free(cell + dy * this.columns))) continue;
        if (this.closed[next] === stamp) continue;
        const foreign = this.cloudMask[next] && !allowed.has(this.cloudMask[next]);
        const cost = this.costs[cell] + (dx && dy ? Math.SQRT2 : 1) + this.notePenalty(next, endpoints) * 0.5 + (foreign ? 12 : 0);
        if (this.seen[next] === stamp && this.costs[next] <= cost) continue;
        this.seen[next] = stamp; this.costs[next] = cost; this.parents[next] = cell;
        push({ cell: next, cost: cost + remaining(next), remaining: remaining(next) });
      }
    }
    return null;
  }
  private routePoints(a: Point, b: Point, allowed: Set<number>, endpoints: Set<number>) {
    const direct = this.sampleLine(a, b);
    if (this.cloudClear(direct, allowed, 28) && this.nodesClear(direct, endpoints, nodeGap + 2)) return [a, b];
    const points = this.search(a, b, allowed, endpoints, false) ?? this.search(a, b, allowed, endpoints, true) ?? [a, b];
    const simplified = [a];
    for (let i = 0; i < points.length - 1;) {
      let next = points.length - 1;
      while (next > i + 1 && (!this.cloudClear(this.sampleLine(points[i], points[next]), allowed, 24) || !this.nodesClear([points[i], points[next]], endpoints, nodeGap + 2))) next--;
      simplified.push(points[next]); i = next;
    }
    return simplified;
  }
  private spline(points: Point[], tension: number, startTangent?: Point, endTangent?: Point) {
    const a = points[0], b = points.at(-1)!, length = distance(a, b);
    const ray = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const dot = (p: Point) => p.x * ray.x + p.y * ray.y;
    const progress = (p: Point) => dot({ x: p.x - a.x, y: p.y - a.y });
    const tangents = points.map((p, i) => {
      const before = points[Math.max(0, i - 1)], after = points[Math.min(points.length - 1, i + 1)];
      const direction = i === 0 && startTangent ? startTangent : i === points.length - 1 && endTangent ? endTangent : { x: after.x - before.x, y: after.y - before.y };
      const size = Math.hypot(direction.x, direction.y);
      const unit = size < 0.001 || dot(direction) < 0 ? ray : { x: direction.x / size, y: direction.y / size };
      const incoming = i ? distance(before, p) : Infinity, outgoing = i < points.length - 1 ? distance(p, after) : Infinity;
      return { unit, handle: Math.min(120, Math.min(incoming, outgoing) * tension) };
    });
    // Shared tangents at internal knots eliminate hard corners. Control-point
    // ordering also makes every cubic monotone along the source→destination ray.
    for (let i = 1; i < points.length; i++) {
      const span = Math.max(0, progress(points[i]) - progress(points[i - 1]));
      const used = tangents[i - 1].handle * dot(tangents[i - 1].unit) + tangents[i].handle * dot(tangents[i].unit);
      if (used > span * 0.95) {
        const ratio = span * 0.95 / used;
        tangents[i - 1].handle *= ratio; tangents[i].handle *= ratio;
      }
    }
    let path = `M${format(a)}`;
    const samples: Point[] = [a];
    for (let i = 1; i < points.length; i++) {
      const p = points[i - 1], q = points[i], before = tangents[i - 1], after = tangents[i];
      const c1 = { x: p.x + before.unit.x * before.handle, y: p.y + before.unit.y * before.handle };
      const c2 = { x: q.x - after.unit.x * after.handle, y: q.y - after.unit.y * after.handle };
      path += appendCubic(samples, p, c1, c2, q);
    }
    return { path, samples };
  }
  // Relax a string in a fixed travel frame. Its sideways displacement minimizes
  // bending and stretch, while its forward coordinate stays ordered. Endpoints
  // stay pinned; cloud clearance constrains each relaxation step.
  private elasticPoints(points: Point[], allowed: Set<number>, endpoints: Set<number>, startTangent?: Point, endTangent?: Point): Point[] {
    const a = points[0], b = points.at(-1)!, length = distance(a, b);
    const ray = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const normal = { x: -ray.y, y: ray.x };
    const project = (p: Point) => (p.x - a.x) * ray.x + (p.y - a.y) * ray.y;
    const segments = Math.max(3, Math.min(28, Math.ceil(length / 55)));
    const spacing = length / segments;
    let cursor = 1;
    const heights = Array.from({ length: segments + 1 }, (_, i) => {
      const x = i * spacing;
      while (cursor < points.length - 1 && project(points[cursor]) < x) cursor++;
      const left = points[cursor - 1], right = points[cursor];
      const t = Math.max(0, Math.min(1, (x - project(left)) / Math.max(0.001, project(right) - project(left))));
      const p = mix(left, right, t);
      return (p.x - a.x) * normal.x + (p.y - a.y) * normal.y;
    });
    heights[0] = heights[segments] = 0;
    const slope = (tangent: Point | undefined) => tangent ? (tangent.x * normal.x + tangent.y * normal.y) /
      Math.max(0.1, tangent.x * ray.x + tangent.y * ray.y) : null;
    const startSlope = slope(startTangent), endSlope = slope(endTangent);
    const firstSlope = heights[1] / spacing, lastSlope = -heights[segments - 1] / spacing;
    // A broad quintic departure/arrival profile starts with zero curvature.
    // Anchor that flow across the branch, instead of immediately returning to
    // the straight chord after a single clamped tangent at the gateway.
    const preferred = heights.map((height, i) => {
      const t = i / segments, x = i * spacing;
      return height + (startSlope === null ? 0 : (startSlope - firstSlope) * x * (1 - t) ** 3 * (1 + 3 * t)) -
        (endSlope === null ? 0 : (endSlope - lastSlope) * (length - x) * t ** 3 * (4 - 3 * t));
    });
    for (let i = 1; i < segments; i++) {
      const p = { x: a.x + ray.x * i * spacing + normal.x * preferred[i], y: a.y + ray.y * i * spacing + normal.y * preferred[i] };
      if (this.cloudClear([p], allowed, 20) && this.nodesClear([p], endpoints, nodeGap + 4)) heights[i] = preferred[i];
    }
    const point = (i: number, height: number) => ({ x: a.x + ray.x * i * spacing + normal.x * height,
      y: a.y + ray.y * i * spacing + normal.y * height });
    for (let iteration = 0; iteration < 24; iteration++) {
      const next = [...heights];
      for (let i = 1; i < segments; i++) {
        let numerator = 0.25 * (heights[i - 1] + heights[i + 1]) + 0.4 * preferred[i], denominator = 0.9;
        // Each second difference involving this knot contributes to the same
        // whole-string bending energy, including the pinned endpoint terms.
        for (let k = Math.max(1, i - 1); k <= Math.min(segments - 1, i + 1); k++) {
          const coefficient = k === i ? -2 : 1;
          const residual = heights[k - 1] - 2 * heights[k] + heights[k + 1] - coefficient * heights[i];
          numerator -= coefficient * residual; denominator += coefficient * coefficient;
        }
        const move = Math.max(-8, Math.min(8, (numerator / denominator - heights[i]) * 0.6));
        const proposed = heights[i] + move;
        const samples = [point(i, proposed), mix(point(i - 1, heights[i - 1]), point(i, proposed), 0.5),
          mix(point(i, proposed), point(i + 1, heights[i + 1]), 0.5)];
        if (this.cloudClear(samples, allowed, 20) && this.nodesClear([point(i - 1, heights[i - 1]), point(i, proposed), point(i + 1, heights[i + 1])], endpoints, nodeGap + 4)) next[i] = proposed;
      }
      for (let i = 1; i < segments; i++) heights[i] = next[i];
    }
    return heights.map((height, i) => point(i, height));
  }
  // One global cubic-spline solve produces continuous first AND second
  // derivatives. Forward position is linear per span, so smooth curvature
  // cannot introduce a U-turn. Shared junctions clamp their approach tangent.
  private naturalSpline(points: Point[], startTangent?: Point, endTangent?: Point) {
    const a = points[0], b = points.at(-1)!, length = distance(a, b);
    const ray = { x: (b.x - a.x) / length, y: (b.y - a.y) / length }, normal = { x: -ray.y, y: ray.x };
    const xs = points.map(p => (p.x - a.x) * ray.x + (p.y - a.y) * ray.y);
    const ys = points.map(p => (p.x - a.x) * normal.x + (p.y - a.y) * normal.y);
    const n = points.length, widths = xs.slice(1).map((x, i) => x - xs[i]);
    if (widths.some(width => width < 0.001)) return null;
    const slope = (tangent: Point) => {
      const forward = tangent.x * ray.x + tangent.y * ray.y;
      return forward > 0.001 ? (tangent.x * normal.x + tangent.y * normal.y) / forward : null;
    };
    const startSlope = startTangent ? slope(startTangent) : null, endSlope = endTangent ? slope(endTangent) : null;
    if (startTangent && startSlope === null || endTangent && endSlope === null) return null;
    const solve = (values: number[]) => {
      const lower = new Float64Array(n), diagonal = new Float64Array(n), upper = new Float64Array(n), rhs = new Float64Array(n);
      diagonal[0] = diagonal[n - 1] = 1;
      if (startSlope !== null) {
        diagonal[0] = 2 * widths[0]; upper[0] = widths[0]; rhs[0] = 6 * ((values[1] - values[0]) / widths[0] - startSlope);
      }
      if (endSlope !== null) {
        lower[n - 1] = widths[n - 2]; diagonal[n - 1] = 2 * widths[n - 2];
        rhs[n - 1] = 6 * (endSlope - (values[n - 1] - values[n - 2]) / widths[n - 2]);
      }
      for (let i = 1; i < n - 1; i++) {
        lower[i] = widths[i - 1]; diagonal[i] = 2 * (widths[i - 1] + widths[i]); upper[i] = widths[i];
        rhs[i] = 6 * ((values[i + 1] - values[i]) / widths[i] - (values[i] - values[i - 1]) / widths[i - 1]);
      }
      for (let i = 1; i < n; i++) {
        const factor = lower[i] / diagonal[i - 1]; diagonal[i] -= factor * upper[i - 1]; rhs[i] -= factor * rhs[i - 1];
      }
      const result = new Float64Array(n); result[n - 1] = rhs[n - 1] / diagonal[n - 1];
      for (let i = n - 2; i >= 0; i--) result[i] = (rhs[i] - upper[i] * result[i + 1]) / diagonal[i];
      return result;
    };
    let curvature = solve(ys);
    // The adjacent interpolation knots are free to move. Use that freedom to
    // match zero endpoint curvature as well as the highway's tangent. A fork
    // now begins with the same curvature as its trunk's straight approach.
    if (n >= 4 && (startSlope !== null || endSlope !== null)) {
      const first = [...ys], last = [...ys]; first[1]++; last[n - 2]++;
      const firstResponse = solve(first), lastResponse = solve(last);
      const aa = firstResponse[0] - curvature[0], ab = lastResponse[0] - curvature[0];
      const ba = firstResponse[n - 1] - curvature[n - 1], bb = lastResponse[n - 1] - curvature[n - 1];
      if (startSlope !== null && endSlope !== null) {
        const determinant = aa * bb - ab * ba;
        if (Math.abs(determinant) > 1e-12) {
          ys[1] += (-curvature[0] * bb + curvature[n - 1] * ab) / determinant;
          ys[n - 2] += (-curvature[n - 1] * aa + curvature[0] * ba) / determinant;
        }
      } else if (startSlope !== null && Math.abs(aa) > 1e-12) ys[1] -= curvature[0] / aa;
      else if (endSlope !== null && Math.abs(bb) > 1e-12) ys[n - 2] -= curvature[n - 1] / bb;
      curvature = solve(ys);
    }
    const fitted = xs.map((x, i) => ({ x: a.x + ray.x * x + normal.x * ys[i], y: a.y + ray.y * x + normal.y * ys[i] }));
    let path = `M${format(a)}`;
    const samples: Point[] = [a];
    for (let i = 0; i < n - 1; i++) {
      const p = fitted[i], q = fitted[i + 1], width = widths[i], secant = (ys[i + 1] - ys[i]) / width;
      const outgoing = secant - width * (2 * curvature[i] + curvature[i + 1]) / 6;
      const incoming = secant + width * (curvature[i] + 2 * curvature[i + 1]) / 6;
      const c1 = { x: p.x + (ray.x + normal.x * outgoing) * width / 3, y: p.y + (ray.y + normal.y * outgoing) * width / 3 };
      const c2 = { x: q.x - (ray.x + normal.x * incoming) * width / 3, y: q.y - (ray.y + normal.y * incoming) * width / 3 };
      path += appendCubic(samples, p, c1, c2, q);
    }
    return { path, samples };
  }
  private smooth(a: Point, b: Point, allowed: Set<number>, endpoints: Set<number>, startRadius = 0, endRadius = 0, startTangent?: Point, endTangent?: Point, retry = true): SmoothPath | null {
    if (distance(a, b) < 0.001) return null;
    const routed = this.routePoints(a, b, allowed, endpoints);
    const length = distance(a, b), normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
    const candidates = routed.length === 2 ? [0, 12, -12, 32, -32, 60, -60].map(offset => {
      const bend = Math.min(Math.abs(offset), length * 0.15) * Math.sign(offset);
      const mid = mix(a, b, 0.5);
      return bend ? [a, { x: mid.x + normal.x * bend, y: mid.y + normal.y * bend }, b] : [a, b];
    }) : [routed];
    let best: SmoothPath | null = null, bestCost = Infinity;
    for (const candidate of candidates) {
      const points = [...candidate];
      const end = points.length - 1;
      const outgoing = startTangent ?? { x: points[1].x - a.x, y: points[1].y - a.y };
      const incoming = endTangent ?? { x: b.x - points[end - 1].x, y: b.y - points[end - 1].y };
      const outSize = Math.hypot(outgoing.x, outgoing.y), inSize = Math.hypot(incoming.x, incoming.y);
      points[0] = { x: a.x + outgoing.x / outSize * Math.min(startRadius, length / 3), y: a.y + outgoing.y / outSize * Math.min(startRadius, length / 3) };
      points[end] = { x: b.x - incoming.x / inSize * Math.min(endRadius, length / 3), y: b.y - incoming.y / inSize * Math.min(endRadius, length / 3) };
      const relaxed = this.elasticPoints(points, allowed, endpoints, startTangent, endTangent);
      const organic = this.naturalSpline(relaxed, startTangent, endTangent);
      const curves = organic && this.cloudClear(organic.samples, allowed) && this.nodesClear(organic.samples, endpoints) ? [organic] :
        startTangent || endTangent ? [] : [0.45, 0.32, 0.2, 0.1, 0.03].map(tension => this.spline(points, tension));
      for (const curve of curves) {
        if (!this.cloudClear(curve.samples, allowed) || !this.nodesClear(curve.samples, endpoints)) continue;
        let travelled = 0, bending = 0;
        for (let i = 1; i < curve.samples.length; i++) {
          travelled += distance(curve.samples[i - 1], curve.samples[i]);
          if (i < 2) continue;
          const p = curve.samples[i - 2], q = curve.samples[i - 1], r = curve.samples[i];
          const first = Math.atan2(q.y - p.y, q.x - p.x), second = Math.atan2(r.y - q.y, r.x - q.x);
          const turn = Math.atan2(Math.sin(second - first), Math.cos(second - first));
          bending += turn * turn / Math.max(1, distance(q, r));
        }
        const cost = curve.samples.reduce((sum, p) => sum + this.notePenalty(this.cell(p), endpoints), 0) / curve.samples.length +
          travelled / length * 0.45 + bending * length * 0.08;
        if (cost < bestCost) { best = { path: curve.path, length: travelled, clear: true }; bestCost = cost; }
        break;
      }
    }
    if (best) return best;
    // Cloud avoidance can yield to dot clearance. Recompute a smooth route with
    // cloud crossings allowed, rather than silently falling back through a dot.
    if (retry) {
      const relaxed = this.smooth(a, b, new Set(this.geometry.clouds.map((_, i) => i + 1)), endpoints,
        startRadius, endRadius, startTangent, endTangent, false);
      return relaxed ? { ...relaxed, clear: false } : null;
    }
    // Both arrivals and departures must match direction AND curvature at a
    // shared junction. Let the caller try another junction or an independent
    // route rather than squeezing a tight bend into an older cubic fallback.
    if (startTangent || endTangent) return null;
    // A monotone smooth fallback keeps explicit links even for overlapping or
    // unrouteable geometry. It cannot acquire the previous router's U-turns.
    const fallback = this.spline([mix(a, b, Math.min(0.3, startRadius / length)), mix(b, a, Math.min(0.3, endRadius / length))], 0.35);
    return { path: fallback.path, clear: false, length: fallback.samples.slice(1).reduce((sum, p, i) => sum + distance(p, fallback.samples[i]), 0) };
  }
  private allowedRegions(source: number, target: number) {
    const roots = new Set([this.geometry.nodes[source].rootId, this.geometry.nodes[target].rootId]);
    return new Set(this.geometry.clouds.flatMap((item, i) =>
      roots.has(item.cloud.id) || (item.cloud.parentId && roots.has(item.cloud.parentId)) ? [i+1] : []));
  }
  private highway(source: number, target: number): Highway | null {
    const a = this.geometry.nodes[source], b = this.geometry.nodes[target];
    if (!b.rootId || a.rootId === b.rootId) return null;
    const root = this.roots.get(b.rootId);
    if (!root) return null;
    const cloud = this.geometry.clouds[root - 1];
    if (!cloud.points.length) return null;
    const center = { x: cloud.points.reduce((sum, p) => sum + p.x, 0) / cloud.points.length,
      y: cloud.points.reduce((sum, p) => sum + p.y, 0) / cloud.points.length };
    const size = distance(a, center);
    if (size < 1) return null;
    const id = JSON.stringify([a.node.id, b.rootId]);
    const eligible = (highway: Highway) => {
      const travel = { x: b.x - a.x, y: b.y - a.y }, goal = distance(a, b);
      const { point, tangent } = highway;
      const projection = ((point.x - a.x) * travel.x + (point.y - a.y) * travel.y) / goal;
      const forward = (b.x - point.x) * tangent.x + (b.y - point.y) * tangent.y;
      return projection >= 30 && projection <= goal - 20 && forward >= 10 && forward / distance(point, b) >= 0.5;
    };
    const cached = this.highways.get(id);
    if (cached) return eligible(cached) ? cached : null;
    if (this.unavailableHighways.has(id)) return null;
    const allowed = this.allowedRegions(source, target);
    const angle = Math.atan2(a.y - center.y, a.x - center.x);
    const approaches = [0, -0.3, 0.3, -0.6, 0.6, -1, 1, -1.3, 1.3].map(offset => {
      const ray = { x: Math.cos(angle + offset) * size, y: Math.sin(angle + offset) * size };
      const tangent = { x: -ray.x / size, y: -ray.y / size };
      let hit = 1;
      // Move the approach around the silhouette when the central gateway
      // leaves insufficient room to turn after an intervening cloud.
      for (let i = 0; i < cloud.points.length; i++) {
        const p = cloud.points[i], q = cloud.points[(i + 1) % cloud.points.length];
        const edge = { x: q.x - p.x, y: q.y - p.y }, determinant = ray.x * edge.y - ray.y * edge.x;
        if (Math.abs(determinant) < 0.001) continue;
        const origin = { x: p.x - center.x, y: p.y - center.y };
        const t = (origin.x * edge.y - origin.y * edge.x) / determinant;
        const u = (origin.x * ray.y - origin.y * ray.x) / determinant;
        if (t > 0 && t < hit && u >= 0 && u <= 1) hit = t;
      }
      return { point: { x: center.x + ray.x * hit - tangent.x * (40 + this.step),
        y: center.y + ray.y * hit - tangent.y * (40 + this.step) }, tangent };
    });
    // Prefer another clear approach over relaxing unrelated cloud avoidance.
    // Geometry alone determines this choice, so link order cannot move a trunk.
    for (const obstacles of [allowed, new Set(this.geometry.clouds.map((_, i) => i + 1))]) {
      let best: Highway | null = null, bestTravel = Infinity;
      for (const { point, tangent } of approaches) {
        const path = this.smooth(a, point, obstacles, new Set([source]), nodeWorldRadius(a.node), 0, undefined, tangent, false);
        if (!path) continue;
        // Feasibility alone is insufficient: a sideways entry can produce a
        // very long spline. Compare the actual smoothed trip across gateways.
        // The cloud center keeps this choice independent of visible link order.
        const travel = path.length + distance(point, center);
        if (travel < bestTravel) {
          bestTravel = travel;
          best = { id, point, tangent, path: path.path, length: path.length, segment: path.path, parentId: null };
        }
      }
      if (best) {
        this.highways.set(id, best);
        return eligible(best) ? best : null;
      }
    }
    this.unavailableHighways.add(id);
    return null;
  }

  // Plan from fixed geometry, not the currently visible links. Nearby notes can
  // share a deeper approach without shifting when the strength slider changes.
  private extendedHighway(source: number, target: number, parent: Highway): Highway | null {
    const a = this.geometry.nodes[source], b = this.geometry.nodes[target];
    let groups = this.approachGroups.get(parent.id);
    if (!groups) {
      const candidates = this.geometry.nodes.map((node, index) => ({ node, index, remaining: distance(parent.point, node) }))
        .filter(({ node, remaining }) => node.rootId === b.rootId && remaining > 40)
        .sort((left, right) => left.remaining - right.remaining || left.node.node.id.localeCompare(right.node.node.id));
      groups = [];
      const metrics: { diameter: number; remaining: number }[] = [];
      // Every pair must be close relative to the remaining journey.
      // This prevents a chain of neighbors merging a cloud
      // whose routes actually head in different directions. Grow the closest
      // compatible group in one pass, keeping planning quadratic in region size.
      for (const candidate of candidates) {
        let best = 0.55, match = -1, nextDiameter = 0;
        for (let i = 0; i < groups.length; i++) {
          const diameter = Math.max(metrics[i].diameter, ...groups[i].map(index => distance(candidate.node, this.geometry.nodes[index])));
          const score = diameter / Math.min(metrics[i].remaining, candidate.remaining);
          if (score < best) { best = score; match = i; nextDiameter = diameter; }
        }
        if (match < 0) { groups.push([candidate.index]); metrics.push({ diameter: 0, remaining: candidate.remaining }); }
        else { groups[match].push(candidate.index); metrics[match].diameter = nextDiameter; }
      }
      this.approachGroups.set(parent.id, groups);
    }
    const group = groups.find(group => group.includes(target));
    if (!group || group.length < 2) return null;
    const id = JSON.stringify([parent.id, group.map(index => this.geometry.nodes[index].node.id).sort()]);
    if (this.unavailableHighways.has(id)) return null;
    const cached = this.highways.get(id);
    if (cached) return cached;
    const members = group.map(index => this.geometry.nodes[index]);
    const center = { x: members.reduce((sum, p) => sum + p.x, 0) / members.length,
      y: members.reduce((sum, p) => sum + p.y, 0) / members.length };
    const length = distance(parent.point, center);
    const tangent = { x: (center.x - parent.point.x) / length, y: (center.y - parent.point.y) / length };
    let diameter = 0;
    for (let i = 0; i < members.length; i++) for (let j = i + 1; j < members.length; j++) {
      diameter = Math.max(diameter, distance(members[i], members[j]));
    }
    const allowed = this.allowedRegions(source, target);
    for (const multiplier of [1, 1.35, 1.7]) {
      const reserve = Math.max(40, diameter * 0.85) * multiplier;
      const point = { x: center.x - tangent.x * reserve, y: center.y - tangent.y * reserve };
      if (length - reserve < 50 || tangent.x * parent.tangent.x + tangent.y * parent.tangent.y < 0.8) continue;
      if (members.some(p => {
        const forward = (p.x - point.x) * tangent.x + (p.y - point.y) * tangent.y;
        const travel = distance(a, p);
        const progress = ((point.x - a.x) * (p.x - a.x) + (point.y - a.y) * (p.y - a.y)) / travel;
        return forward < 20 || forward / distance(point, p) < 0.5 || progress > travel - 20;
      })) continue;
      const segment = this.smooth(parent.point, point, allowed, new Set([source]), 0, 0, parent.tangent, tangent);
      if (!segment) continue;
      const highway = { id, point, tangent, length: parent.length + segment.length, segment: segment.path, parentId: parent.id,
        path: parent.path + segment.path.slice(segment.path.indexOf('C')) };
      this.highways.set(id, highway);
      return highway;
    }
    this.unavailableHighways.add(id);
    return null;
  }
  route(sourceId: string, targetId: string): RoutedConnection {
    const key = `${sourceId}\0${targetId}`, cached = this.routes.get(key);
    if (cached) return cached;
    const source = this.marks.get(sourceId), target = this.marks.get(targetId);
    if (source === undefined || target === undefined) return { path: '', branch: '', trunkId: null };
    const a = this.geometry.nodes[source], b = this.geometry.nodes[target];
    const allowed = this.allowedRegions(source, target);
    const base = this.highway(source, target);
    let highway = base ? this.extendedHighway(source, target, base) ?? base : null;
    const endpoints = new Set([source, target]);
    let branch = highway ? this.smooth(highway.point, b, allowed, endpoints, 0, nodeWorldRadius(b.node), highway.tangent) :
      this.smooth(a, b, allowed, endpoints, nodeWorldRadius(a.node), nodeWorldRadius(b.node));
    if (highway?.parentId && !branch) {
      highway = base;
      branch = this.smooth(highway!.point, b, allowed, endpoints, 0, nodeWorldRadius(b.node), highway!.tangent);
    }
    if (highway && !branch) {
      highway = null;
      branch = this.smooth(a, b, allowed, endpoints, nodeWorldRadius(a.node), nodeWorldRadius(b.node));
    }
    // Sharing may buy visual clarity at a modest travel cost, but an entry
    // tangent must not force a map-sized detour. Compare feasible full routes,
    // so unavoidable obstacle detours do not disable an otherwise good trunk.
    const sharedTravelBudget = 1.35;
    if (highway && branch && highway.length + branch.length > distance(a, b) * sharedTravelBudget) {
      const independent = this.smooth(a, b, allowed, endpoints, nodeWorldRadius(a.node), nodeWorldRadius(b.node));
      if (independent?.clear && highway.length + branch.length > independent.length * sharedTravelBudget) {
        highway = null;
        branch = independent;
      }
    }
    const branchPath = branch?.path ?? '';
    const result = { path: highway ? highway.path + branchPath.slice(branchPath.indexOf('C')) : branchPath, branch: branchPath, trunkId: highway?.id ?? null };
    this.routes.set(key, result);
    return result;
  }
  trunk(id: string) { return this.highways.get(id)!; }
  ancestors(id: string | null): Highway[] {
    const result: Highway[] = [];
    while (id) { const highway = this.trunk(id); result.push(highway); id = highway.parentId; }
    return result;
  }
}

/** Cache independent of the camera and visible connection subset. */
export function createAtlasRouting() {
  let key = '', router: Router | null = null;
  return (geometry: Geometry, links: AtlasLink[], focusId?: string | null): RoutedConnections => {
    if (!links.length) return { paths: new Map(), trunks: [] };
    const nextKey = JSON.stringify([
      geometry.nodes.map(mark => [mark.node.id, mark.x, mark.y, mark.rootId, noteTitle(mark.node), nodeWorldRadius(mark.node)]),
      geometry.clouds.map(cloud => [cloud.cloud.id, cloud.points, cloud.labelPoint, cloud.labelFontSize, cloud.cloud.label])
    ]);
    if (!router || nextKey !== key) { router = new Router(geometry); key = nextKey; }
    const common = focusId ?? [links[0].sourceId, links[0].targetId].find(id => links.every(link => link.sourceId === id || link.targetId === id));
    const paths = new Map(links.map(link => {
      const source = common && (link.sourceId === common || link.targetId === common) ? common : link.sourceId;
      const target = source === link.sourceId ? link.targetId : link.sourceId;
      return [link.id, router!.route(source, target)] as const;
    }));
    const groups = new Map<string, AtlasLink[]>();
    for (const link of links) {
      for (const { id } of router.ancestors(paths.get(link.id)!.trunkId)) {
        const group = groups.get(id) ?? []; group.push(link); groups.set(id, group);
      }
    }
    const trunks: RoutedConnections['trunks'] = [];
    for (const [id, group] of groups) {
      if (group.length > 1) trunks.push({ id, path: router.trunk(id).segment, kind: group.some(link => link.kind === 'wikilink') ? 'wikilink' : 'semantic', linkIds: group.map(link => link.id) });
    }
    for (const [id, route] of paths) {
      const shared = router.ancestors(route.trunkId).find(trunk => groups.get(trunk.id)!.length > 1);
      // Keep singleton continuations attached to the last visible shared section.
      // Only the drawing split changes; the full cached route remains identical.
      paths.set(id, { ...route, trunkId: shared?.id ?? null,
        branch: shared ? `M${format(shared.point)}` + route.path.slice(shared.path.length) : route.path });
    }
    return { paths, trunks };
  };
}
