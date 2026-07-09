import { describe, expect, it } from 'vitest';
import {
  getNodePosition,
  getZoomTier,
  isAtlasSearchHit,
  isHighConfidenceLink,
  linkEndpoints,
  strongestLinksPerNode
} from './atlasStore.svelte';
import type { AtlasLink, AtlasNode, AtlasSearchMatch } from '$lib/types/atlas';

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
    childCloudId: null,
    clusterId: null,
    subclusterId: null,
    centrality: 0,
    degree: 0,
    importance: 0,
    modifiedAtMillis: 1,
    lastViewedAtMillis: null,
    createdAtMillis: 1,
    updatedAtMillis: 1,
    staleScore: 0,
    preview: '',
    tags: [],
    isolated: true
  };
}

describe('atlas view helpers', () => {
  function searchMatch(overrides: Partial<AtlasSearchMatch>): AtlasSearchMatch {
    return {
      noteId: 'note',
      notePath: '/vault/note.md',
      score: 0,
      semanticScore: 0,
      lexicalScore: 0,
      structuralScore: 0,
      recencyScore: 0,
      reasonLabels: [],
      ...overrides
    };
  }

  it('maps zoom values to semantic focus tiers', () => {
    expect(getZoomTier(0.25)).toBe('far');
    expect(getZoomTier(0.6)).toBe('mid');
    expect(getZoomTier(1.1)).toBe('near');
    expect(getZoomTier(2)).toBe('close');
  });

  it('does not treat weak recency-only atlas matches as colored search hits', () => {
    expect(isAtlasSearchHit(null)).toBe(false);
    expect(isAtlasSearchHit(searchMatch({ score: 0.1, recencyScore: 1 }))).toBe(false);
    expect(isAtlasSearchHit(searchMatch({ score: 0.34 }))).toBe(true);
    expect(isAtlasSearchHit(searchMatch({ semanticScore: 0.52 }))).toBe(true);
    expect(isAtlasSearchHit(searchMatch({ lexicalScore: 0.7 }))).toBe(true);
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

  it('keeps weak semantic links out of high-confidence link displays', () => {
    expect(
      isHighConfidenceLink(
        { id: 'a:b', sourceId: 'a', targetId: 'b', kind: 'semantic', score: 0.7, strength: 0.69 },
        0.7
      )
    ).toBe(false);
    expect(
      isHighConfidenceLink(
        { id: 'a:c', sourceId: 'a', targetId: 'c', kind: 'semantic', score: 0.82, strength: 0.82 },
        0.7
      )
    ).toBe(true);
    expect(
      isHighConfidenceLink(
        { id: 'a:d', sourceId: 'a', targetId: 'd', kind: 'wikilink', score: 1, strength: 0.82 },
        0.95
      )
    ).toBe(true);
  });
});
