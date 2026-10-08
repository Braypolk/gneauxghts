import { describe, expect, it } from 'vitest';
import type { AtlasLink } from '$lib/types/atlas';
import { createDemoAtlas } from '../../../../scripts/fixtures/atlasDemo';
import { createAtlasConnections } from './atlasConnections';

const sample = createDemoAtlas().nodes[0];
const semantic = (index: number, strength = 0.95 - index * 0.01): AtlasLink => ({
  id: `link-${index}`, sourceId: 'focus', targetId: `note-${index}`,
  kind: 'semantic', strength, score: strength - 0.1
});
const fixture = (links: AtlasLink[]) => ({
  nodes: ['focus', ...new Set(links.flatMap(link => [link.sourceId, link.targetId]))]
    .map(id => ({ ...sample, id })), links
});

describe('Atlas focused connections', () => {
  it('keeps all strong neighbors, prioritizes authored links and collapses duplicate neighbors', () => {
    const links = Array.from({ length: 50 }, (_, i) => semantic(i));
    links.push({ ...semantic(49), id: 'authored', kind: 'wikilink', strength: 0.2, score: 1 });
    const select = createAtlasConnections(fixture(links));
    const result = select('focus');
    expect(result.total).toBe(50);
    expect(result.links).toHaveLength(11);
    expect(result.links[0].id).toBe('authored');
    expect(result.links.slice(1).map(link => link.id)).toEqual(Array.from({ length: 10 }, (_, i) => `link-${i}`));
    expect(new Set(result.links.map(link => link.targetId)).size).toBe(11);
    expect(result.links.every(link => link.kind === 'wikilink' || link.strength >= 0.7)).toBe(true);
  });

  it('keeps every equally strong connection and stays stable across visits and input order', () => {
    const response = fixture(Array.from({ length: 30 }, (_, i) => semantic(i, 0.9)));
    const select = createAtlasConnections(response);
    const first = select('focus').links;
    expect(first).toHaveLength(30);
    expect(select('focus').links).toEqual(first);
    expect(createAtlasConnections({ ...response, links: [...response.links].reverse() })('focus').links).toEqual(first);
  });

  it('does not pad a sparse neighborhood with weak, missing or self connections', () => {
    const response = fixture([semantic(0), semantic(1, 0.2), semantic(2, NaN), semantic(3)]);
    response.links.push({ ...semantic(0), id: 'self', targetId: 'focus' });
    response.nodes = response.nodes.filter(node => node.id !== 'note-3');
    const select = createAtlasConnections(response);
    expect(select('focus').links.map(link => link.id)).toEqual(['link-0']);
    expect(select('note-1').links).toEqual([]);
    expect(select(null)).toEqual({ links: [], total: 0, threshold: 0.7 });
  });

  it('excludes a weaker tail relative to the strongest semantic connections', () => {
    const select = createAtlasConnections(fixture([
      ...Array.from({ length: 6 }, (_, i) => semantic(i, 0.95)),
      ...Array.from({ length: 5 }, (_, i) => semantic(i + 6, 0.71))
    ]));
    expect(select('focus').links.map(link => link.id)).toEqual(['link-0', 'link-1', 'link-2', 'link-3', 'link-4', 'link-5']);
  });

  it('keeps every authored connection regardless of strength or degree', () => {
    const select = createAtlasConnections(fixture([
      ...Array.from({ length: 30 }, (_, i) => ({ ...semantic(i, 0.01), kind: 'wikilink' as const })),
      semantic(40, 1)
    ]));
    expect(select('focus').links.filter(link => link.kind === 'wikilink')).toHaveLength(30);
    expect(select('focus').links).toHaveLength(31);
  });

  it('retains an absolute strength floor without forcing sparse notes up to hub-level strength', () => {
    const sparse = [semantic(0, 0.76), semantic(1, 0.72), semantic(2, 0.69)];
    expect(createAtlasConnections(fixture(sparse))('focus').links.map(link => link.id)).toEqual(['link-0', 'link-1']);
    expect(createAtlasConnections(fixture([...sparse, semantic(3, 0.95)]))('focus').links.map(link => link.id)).toEqual(['link-3']);
  });

  it('allows a live absolute cutoff without limiting authored links and restores the automatic policy', () => {
    const select = createAtlasConnections(fixture([
      semantic(0, 0.95), semantic(1, 0.8), semantic(2, 0.2),
      ...Array.from({ length: 30 }, (_, i) => ({ ...semantic(i + 3, 0.01), kind: 'wikilink' as const }))
    ]));
    const ids = (cutoff: number | null) => select('focus', cutoff).links.filter(link => link.kind === 'semantic').map(link => link.id);
    expect(ids(null)).toEqual(['link-0']);
    expect(ids(0.8)).toEqual(['link-0', 'link-1']);
    expect(ids(0)).toEqual(['link-0', 'link-1', 'link-2']);
    expect(ids(1)).toEqual([]);
    expect(select('focus', 1).links).toHaveLength(30);
    expect(ids(null)).toEqual(['link-0']);
    expect(select('focus', null).threshold).toBeCloseTo(0.855);
    expect(select('focus', NaN)).toEqual(select('focus'));
  });
});
