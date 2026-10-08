export type Point = { x: number; y: number };

export function pointSegmentDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(0.001, dx * dx + dy * dy)));
  return Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t);
}

/** Containment and clearance use the same polygon edges in layout and routing. */
export function polygonProximity(point: Point, polygon: Point[]) {
  let inside = false, distance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    distance = Math.min(distance, pointSegmentDistance(point, a, b));
  }
  return { inside, distance };
}
