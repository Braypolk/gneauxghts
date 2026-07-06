import { describe, expect, it } from 'vitest';
import { getNodePosition, getZoomTier, linkEndpoints, strongestLinksPerNode } from './atlasStore.svelte';
import type { AtlasLink, AtlasNode } from '$lib/types/atlas';

function node(id: string, x: number, y: number, driftX = x + 10, driftY = y + 10): AtlasNode {
  return {
    id,
    noteId: id,
    notePath: `/vault/${id}.md`,
    title: id,
    fileName: `${id}.md`,
    x,
    y,
    driftX,
    driftY,
    radius: 5,
    cloudId: null,
    parentCloudId: null,
    centrality: 0,
    modifiedAtMillis: 1,
    lastViewedAtMillis: null,
    staleScore: 0,
    isolated: true
  };
}

describe('atlas view helpers', () => {
  it('maps zoom values to semantic focus tiers', () => {
    expect(getZoomTier(0.25)).toBe('far');
    expect(getZoomTier(0.6)).toBe('mid');
    expect(getZoomTier(1.1)).toBe('near');
    expect(getZoomTier(2)).toBe('close');
  });

  it('switches between stable and stale-drift positions without mutating nodes', () => {
    const item = node('a', 1, 2, 30, 40);

    expect(getNodePosition(item, false)).toEqual([1, 2]);
    expect(getNodePosition(item, true)).toEqual([30, 40]);
    expect(item.x).toBe(1);
    expect(item.driftX).toBe(30);
  });

  it('resolves link endpoints from visible nodes', () => {
    const first = node('a', 1, 2);
    const second = node('b', 3, 4, 9, 10);
    const byId = new Map([
      [first.id, first],
      [second.id, second]
    ]);

    expect(
      linkEndpoints(
        { id: 'a:b', sourceId: 'a', targetId: 'b', kind: 'semantic', score: 0.5, strength: 0.5 },
        byId,
        false
      )
    ).toEqual([
      [1, 2],
      [3, 4]
    ]);
    expect(
      linkEndpoints(
        { id: 'a:b', sourceId: 'a', targetId: 'b', kind: 'semantic', score: 0.5, strength: 0.5 },
        byId,
        true
      )
    ).toEqual([
      [11, 12],
      [9, 10]
    ]);
  });

  it('caps displayed links per node while preferring wikilinks and strong semantic edges', () => {
    const links: AtlasLink[] = [
      { id: 'a:b', sourceId: 'a', targetId: 'b', kind: 'semantic', score: 0.9, strength: 0.9 },
      { id: 'a:c', sourceId: 'a', targetId: 'c', kind: 'semantic', score: 0.8, strength: 0.8 },
      { id: 'a:d', sourceId: 'a', targetId: 'd', kind: 'semantic', score: 0.7, strength: 0.7 },
      { id: 'a:e', sourceId: 'a', targetId: 'e', kind: 'wikilink', score: 1, strength: 0.82 }
    ];

    expect(strongestLinksPerNode(links, 2).map((link) => link.id)).toEqual(['a:e', 'a:b']);
  });
});
