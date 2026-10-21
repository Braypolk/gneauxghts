import type { AtlasLink, VaultAtlasResponse } from '#lib/types/atlas.js';

const MIN_SEMANTIC_STRENGTH = 0.7;
const RELATIVE_STRENGTH_FLOOR = 0.9;

const rank = (a: AtlasLink, b: AtlasLink) =>
  Number(b.kind === 'wikilink') - Number(a.kind === 'wikilink') ||
  b.strength - a.strength || b.score - a.score || a.id.localeCompare(b.id);

/** A strength-filtered neighborhood shared by the graph and connected-note browsing. */
export function createAtlasConnections(response: Pick<VaultAtlasResponse, 'nodes' | 'links'>) {
  const ids = new Set(response.nodes.map(node => node.id));
  const neighbors = new Map<string, Map<string, AtlasLink>>();
  function add(from: string, to: string, link: AtlasLink) {
    let entries = neighbors.get(from);
    if (!entries) neighbors.set(from, entries = new Map());
    const existing = entries.get(to);
    if (!existing || rank(link, existing) < 0) entries.set(to, link);
  }
  for (const link of response.links) {
    if (link.sourceId === link.targetId || !ids.has(link.sourceId) || !ids.has(link.targetId)) continue;
    if (link.kind === 'semantic' && (!Number.isFinite(link.strength) || !Number.isFinite(link.score))) continue;
    add(link.sourceId, link.targetId, link);
    add(link.targetId, link.sourceId, link);
  }
  const ranked = new Map([...neighbors].map(([id, entries]) => [id, [...entries.values()].sort(rank)]));

  return (id: string | null | undefined, minimumStrength: number | null = null): { links: AtlasLink[]; total: number; threshold: number } => {
    const all = id ? ranked.get(id) ?? [] : [];
    const strongest = all.reduce((best, link) => link.kind === 'semantic' ? Math.max(best, link.strength) : best, 0);
    const automatic = Math.max(MIN_SEMANTIC_STRENGTH, strongest * RELATIVE_STRENGTH_FLOOR);
    const threshold = minimumStrength !== null && Number.isFinite(minimumStrength)
      ? Math.max(0, Math.min(1, minimumStrength)) : automatic;
    // Equal-strength ties all survive. An authored link represents a deliberate
    // relationship and is independent of the semantic similarity threshold.
    return { links: all.filter(link => link.kind === 'wikilink' || link.strength >= threshold), total: all.length, threshold };
  };
}
