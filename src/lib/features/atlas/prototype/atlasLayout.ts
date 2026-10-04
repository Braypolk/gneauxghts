import type { AtlasNode, VaultAtlasResponse } from '$lib/types/atlas';
export type Point = { x: number; y: number };
export const labelWorldSize = 6.5;
export function noteTitle(node: AtlasNode) {
  const name = (node.fileName || node.title).replace(/\.md$/i, '');
  return name.length > 60 ? `${name.slice(0, 59).trimEnd()}…` : name;
}
const nodeSpacing = 42;
export function titleWidth(title: string, size: number) {
  return [...title].reduce((sum, char) => sum + ('ilI.,:;!| '.includes(char) ? 0.3 : 'MW@%'.includes(char) ? 0.85 : 0.56), 0) * size;
}
export function insideWithMargin(point: Point, polygon: Point[], margin: number) {
  let inside = false, distance = Infinity;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / Math.max(0.001, dx * dx + dy * dy)));
    distance = Math.min(distance, Math.hypot(point.x - a.x - dx * t, point.y - a.y - dy * t));
  }
  return inside && distance >= margin;
}
function fitCloud(points: Point[], members: Point[]) {
  let scale = 1, fitted = points;
  for (let pass = 0; pass < 120 && members.some((point) => !insideWithMargin(point, fitted, 20)); pass++) {
    scale *= 1.04; fitted = points.map((point) => ({ x: point.x * scale, y: point.y * scale }));
  }
  return fitted;
}

function packAtlas(response: VaultAtlasResponse) {
  const coordinates = [...response.nodes.map((node) => [node.x, node.y]), ...response.clouds.flatMap((cloud) => cloud.hull)]
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const minX = coordinates.length ? Math.min(...coordinates.map(([x]) => x)) : 0;
  const maxX = coordinates.length ? Math.max(...coordinates.map(([x]) => x)) : 1;
  const minY = coordinates.length ? Math.min(...coordinates.map(([, y]) => y)) : 0;
  const maxY = coordinates.length ? Math.max(...coordinates.map(([, y]) => y)) : 1;
  const scale = Math.min(2400 / Math.max(1, maxX - minX), 1440 / Math.max(1, maxY - minY));
  const project = (x: number, y: number): Point => ({ x: (x - (minX + maxX) / 2) * scale, y: (y - (minY + maxY) / 2) * scale });
  const roots = response.clouds.filter((cloud) => !cloud.parentId);
  const rootsById = new Map(roots.map(cloud => [cloud.id, cloud]));
  const rootByNode = new Map(roots.flatMap((cloud) => cloud.memberNodeIds.map((id) => [id, cloud] as const)));
  const cloudsById = new Map(response.clouds.map((cloud) => [cloud.id, cloud]));
  const clouds = roots.map((cloud) => ({ cloud, color: `rgb(${cloud.color.slice(0, 3).join(' ')})`,
    points: cloud.hull.map(([x, y]) => project(x, y)), center: project(cloud.centroid[0], cloud.centroid[1]) }));
  const nodes = response.nodes.map((node) => {
    const root = rootsById.get(node.parentCloudId ?? '') ?? rootsById.get(node.cloudId ?? '') ?? rootByNode.get(node.id);
    const cloud = cloudsById.get(node.childCloudId ?? node.cloudId ?? node.parentCloudId ?? '');
    return { node, ...project(node.x, node.y), rootId: root?.id ?? null, color: cloud ? `rgb(${cloud.color.slice(0, 3).join(' ')})` : '#959da6' };
  });
  // Pack nearby notes once per dataset, reserving their fixed world-space
  // names. Neither camera nor selected/hovered state enters layout.
  const groups = [...new Set(nodes.map((mark) => mark.rootId ?? mark.node.id))].map((id) => {
    const root = clouds.find((item) => item.cloud.id === id);
    const originals = nodes.filter((mark) => (mark.rootId ?? mark.node.id) === id);
    const anchor = root?.center ?? originals[0];
    const placed: (typeof nodes[number] & { box: { left: number; right: number; top: number; bottom: number } })[] = [];
    // Index the label rectangle and node center; queries include the spacing envelope.
    const cells = new Map<string, typeof placed>();
    function cellKeys(box: { left: number; right: number; top: number; bottom: number }) {
      const keys: string[] = [];
      for (let x = Math.floor(box.left / nodeSpacing); x <= Math.floor(box.right / nodeSpacing); x++)
        for (let y = Math.floor(box.top / nodeSpacing); y <= Math.floor(box.bottom / nodeSpacing); y++) keys.push(`${x}:${y}`);
      return keys;
    }
    for (const mark of [...originals].sort((a, b) => a.y - b.y || a.x - b.x || a.node.id.localeCompare(b.node.id))) {
      const preferred = { x: mark.x - anchor.x, y: mark.y - anchor.y };
      const halfWidth = titleWidth(noteTitle(mark.node), labelWorldSize) * 1.12 / 2 + 3;
      const labelBox = (point: Point) => ({ left: point.x - halfWidth, right: point.x + halfWidth, top: point.y + 1, bottom: point.y + 18 });
      const collides = (point: Point) => {
        const box = labelBox(point);
        const left = Math.floor(Math.min(box.left, point.x - nodeSpacing) / nodeSpacing);
        const right = Math.floor(Math.max(box.right, point.x + nodeSpacing) / nodeSpacing);
        const top = Math.floor((point.y - nodeSpacing) / nodeSpacing);
        const bottom = Math.floor(Math.max(box.bottom, point.y + nodeSpacing) / nodeSpacing);
        for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) {
          const nearby = cells.get(`${x}:${y}`);
          if (!nearby) continue;
          for (const other of nearby) {
            const dx = point.x - other.x, dy = point.y - other.y;
            if (dx * dx + dy * dy < nodeSpacing * nodeSpacing || (box.left < other.box.right && box.right > other.box.left && box.top < other.box.bottom && box.bottom > other.box.top)) return true;
          }
        }
        return false;
      };
      let point = preferred;
      for (let ring = 1; collides(point); ring++) {
        const radius = ring * 6, attempts = Math.max(16, Math.ceil(radius / 3));
        let found = false;
        for (let i = 0; i < attempts; i++) {
          const angle = i / attempts * Math.PI * 2;
          const candidate = { x: preferred.x + Math.cos(angle) * radius, y: preferred.y + Math.sin(angle) * radius };
          if (!collides(candidate)) { point = candidate; found = true; break; }
        }
        if (found) break;
      }
      const packed = { ...mark, ...point, box: labelBox(point) };
      placed.push(packed);
      for (const key of cellKeys({ ...packed.box, top: packed.y })) {
        const bucket = cells.get(key) ?? [];
        bucket.push(packed); cells.set(key, bucket);
      }
    }
    // Keep the original mean inside the region; avoid a directional packing drift.
    const offset = { x: (placed.reduce((sum, mark) => sum + mark.x, 0) - originals.reduce((sum, mark) => sum + mark.x - anchor.x, 0)) / originals.length,
      y: (placed.reduce((sum, mark) => sum + mark.y, 0) - originals.reduce((sum, mark) => sum + mark.y - anchor.y, 0)) / originals.length };
    for (const mark of placed) {
      mark.x -= offset.x; mark.y -= offset.y;
      mark.box.left -= offset.x; mark.box.right -= offset.x; mark.box.top -= offset.y; mark.box.bottom -= offset.y;
    }
    // Retain the original blob silhouette, growing it only enough to contain
    // the separated dots. Whole regions then move apart if their envelopes meet.
    const outline = root ? fitCloud(root.points.map((point) => ({ x: point.x - anchor.x, y: point.y - anchor.y })), placed) : [];
    const envelope = outline.concat(placed.flatMap((mark) => [{ x: mark.box.left, y: mark.box.top }, { x: mark.box.right, y: mark.box.bottom }]));
    const radius = Math.max(24, ...envelope.map((point) => Math.hypot(point.x, point.y))) + 12;
    return { id, anchor, x: anchor.x, y: anchor.y, placed, outline, radius };
  });
  for (let pass = 0; pass < 240; pass++) {
    let overlapFound = false;
    for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
      const a = groups[i], b = groups[j], dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
      const overlap = a.radius + b.radius + 28 - distance;
      if (overlap <= 0) continue;
      overlapFound = true;
      const angle = (i * 7 + j * 3) * 2.4;
      const ux = distance > 0.001 ? dx / distance : Math.cos(angle), uy = distance > 0.001 ? dy / distance : Math.sin(angle);
      const shift = (overlap + 0.1) / 2;
      a.x -= ux * shift; a.y -= uy * shift; b.x += ux * shift; b.y += uy * shift;
    }
    if (!overlapFound) break;
  }
  const spacedNodes = groups.flatMap((group) => group.placed.map(({ box, ...mark }) => ({ ...mark, x: mark.x + group.x, y: mark.y + group.y })));
  const spacedClouds = clouds.map((item) => {
    const group = groups.find((group) => group.id === item.cloud.id);
    if (group) return { ...item, center: { x: group.x, y: group.y }, points: group.outline.map((point) => ({ x: point.x + group.x, y: point.y + group.y })) };
    return { ...item, points: [] };
  });
  return { nodes: spacedNodes, clouds: spacedClouds };

}

type Layout = ReturnType<typeof packAtlas>;
function captionCloud(item: Layout['clouds'][number], nodes: Layout['nodes']) {
  const text = (item.cloud.label || 'Unlabelled region').slice(0, 32);
  const top = Math.min(...item.points.map((point) => point.y));
  const bottom = Math.max(...item.points.map((point) => point.y));
  const left = Math.min(...item.points.map((point) => point.x)), right = Math.max(...item.points.map((point) => point.x));
  const middleX = (left + right) / 2;
  const occupied = nodes.filter((mark) => item.cloud.parentId ? item.cloud.memberNodeIds.includes(mark.node.id) : mark.rootId === item.cloud.id).map((mark) => {
    const halfWidth = Math.max(9, titleWidth(noteTitle(mark.node), labelWorldSize) * 1.12 / 2 + 2);
    return { left: mark.x - halfWidth, right: mark.x + halfWidth, top: mark.y - 9, bottom: mark.y + 19 };
  });
  let fallback: { labelPoint: Point; labelFontSize: number } | null = null;
  // Place the whole name inside the upper part of the original silhouette.
  // Narrow clouds can use smaller type; note positions and camera stay fixed.
  for (let size = 20; size >= 4; size--) {
    const halfWidth = titleWidth(text, size) * 1.12 / 2;
    const candidates = [item.center.x, middleX];
    for (let x = left + halfWidth + 8; x <= right - halfWidth - 8; x += 8) candidates.push(x);
    candidates.sort((a, b) => Math.abs(a - item.center.x) - Math.abs(b - item.center.x));
    for (let y = top + size + 8; y <= bottom - 8; y += 6) {
      for (const x of candidates) {
        const corners = [{ x: x - halfWidth, y: y - size }, { x: x + halfWidth, y: y - size }, { x: x - halfWidth, y: y + 4 }, { x: x + halfWidth, y: y + 4 }];
        if (!corners.every((point) => insideWithMargin(point, item.points, 4))) continue;
        const placement = { labelPoint: { x, y }, labelFontSize: size };
        fallback ??= placement;
        if (!occupied.some((box) => x - halfWidth < box.right && x + halfWidth > box.left && y - size < box.bottom && y + 4 > box.top)) return { ...item, ...placement };
      }
    }
  }
  return { ...item, ...(fallback ?? { labelPoint: item.center, labelFontSize: 4 }) };

}

// Metadata, activity and label publication must not repack an unchanged map.
export function createAtlasLayout() {
  let key = '';
  let cached: Layout | null = null;
  let captionKey = '';
  let captions: ReturnType<typeof captionCloud>[] = [];
  return (response: VaultAtlasResponse) => {
    const nextKey = JSON.stringify([
      response.nodes.map(node => [node.id, node.x, node.y, noteTitle(node), node.cloudId, node.parentCloudId, node.childCloudId]),
      response.clouds.map(cloud => [cloud.id, cloud.parentId, cloud.centroid, cloud.hull, cloud.memberNodeIds, cloud.color])
    ]);
    if (!cached || key !== nextKey) { cached = packAtlas(response); key = nextKey; captionKey = ''; }
    const nextCaptionKey = JSON.stringify(response.clouds.filter(cloud => !cloud.parentId).map(cloud => [cloud.id, cloud.label]));
    if (captionKey !== nextCaptionKey) {
      const byId = new Map(response.clouds.map(cloud => [cloud.id, cloud]));
      captions = cached.clouds.map(item => captionCloud({ ...item, cloud: byId.get(item.cloud.id)! }, cached!.nodes));
      captionKey = nextCaptionKey;
    }
    const nodes = new Map(response.nodes.map(node => [node.id, node]));
    const clouds = new Map(response.clouds.map(cloud => [cloud.id, cloud]));
    return {
      nodes: cached.nodes.map(mark => ({ ...mark, node: nodes.get(mark.node.id)! })),
      clouds: captions.map(item => ({ ...item, cloud: clouds.get(item.cloud.id)! }))
    };
  };
}
