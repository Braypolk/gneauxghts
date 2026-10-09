export type Point = { x: number; y: number };

/** Caption boxes must be inside with clearance; routes cover the filled polygon
 * and its outer margin. Both reuse the same prepared edges and distance test. */
export function preparePolygonContainment(polygon: Point[], margin: number) {
  return preparePolygonTest(polygon, margin, false);
}
export function preparePolygonCoverage(polygon: Point[], margin: number) {
  return preparePolygonTest(polygon, margin, true);
}
function preparePolygonTest(polygon: Point[], margin: number, includeMargin: boolean) {
  const edges = polygon.map((a, i) => {
    const b = polygon[(i + polygon.length - 1) % polygon.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    return { a, b, dx, dy, lengthSquared: Math.max(0.001, dx * dx + dy * dy) };
  });
  const inset = includeMargin ? -margin : margin;
  const left = Math.min(...polygon.map(p => p.x)) + inset;
  const right = Math.max(...polygon.map(p => p.x)) - inset;
  const top = Math.min(...polygon.map(p => p.y)) + inset;
  const bottom = Math.max(...polygon.map(p => p.y)) - inset;
  const marginSquared = margin * margin;
  const tolerance = Math.max(1, marginSquared) * 1e-12;
  return (point: Point) => {
    if (point.x < left || point.x > right || point.y < top || point.y > bottom) return false;
    let inside = false;
    for (const { a, b, dx, dy, lengthSquared } of edges) {
      if ((a.y > point.y) !== (b.y > point.y) && point.x < dx * (point.y - a.y) / dy + a.x) inside = !inside;
      const px = point.x - a.x, py = point.y - a.y;
      const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lengthSquared));
      const ex = px - dx * t, ey = py - dy * t;
      const distanceSquared = ex * ex + ey * ey;
      if (distanceSquared < marginSquared - tolerance) return includeMargin;
      // Preserve the existing inclusive clearance rule at floating-point ties.
      if (Math.abs(distanceSquared - marginSquared) <= tolerance) {
        const distance = Math.hypot(ex, ey);
        if (includeMargin ? distance <= margin : distance < margin) return includeMargin;
      }
    }
    return inside;
  };
}

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
