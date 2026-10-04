// Search and activity display helpers for the surviving Atlas preview.
import type { AtlasNode } from '$lib/types/atlas';

export function matchesQuery(node: AtlasNode, query: string): boolean {
  const tags: string[] = [];
  const topics: string[] = [];
  const text = query.replace(/(?:tag:|#)(?:"([^"]+)"|([^\s]+))/gi, (_, quoted, bare) => { tags.push((quoted || bare).toLowerCase()); return ''; })
    .replace(/topic:([^\s]+)/g, (_, id) => { topics.push(id); return ''; }).trim().toLowerCase();
  return tags.every(tag => node.tags.some(value => value.toLowerCase().replace(/^#/, '') === tag))
    && topics.every(id => [node.cloudId,node.parentCloudId,node.childCloudId].includes(id))
    && (!text || `${node.title} ${node.preview} ${node.tags.join(' ')}`.toLowerCase().includes(text));
}

export function daysAgo(timestamp: number | null): string {
  if (!timestamp) return 'No recorded opening';
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  return days === 0 ? 'Today' : `${days} days ago`;
}
