import { describe, expect, it } from 'vitest';
import { createAtlasLayout, noteTitle } from './atlasLayout';
import { createDemoAtlas } from '../../../../scripts/fixtures/atlasDemo';

const positions = (map: ReturnType<ReturnType<typeof createAtlasLayout>>) => map.nodes.map(({node, x, y}) => [node.id, x, y]);

describe('Atlas spaced layout', () => {
  it('reserves minimum spacing and keeps root notes inside their original silhouettes', () => {
    const atlas = createDemoAtlas();
    const root = atlas.clouds[0];
    // Worst case: coincident notes with long names in one region.
    atlas.nodes = Array.from({length: 80}, (_, i) => ({...atlas.nodes[0], id: `dense-${i}`, x: 0, y: 0, fileName: `${'Long note title '.repeat(5)}${i}.md`}));
    atlas.clouds = [{...root, memberNodeIds: atlas.nodes.map(node => node.id), centroid: [0,0], hull: [[-110,-100],[110,-100],[110,100],[-110,100]]}];
    const result = createAtlasLayout()(atlas);
    // This fixture stays rectangular after layout. Use independent bounds,
    // not the same containment predicate that decides whether to grow it.
    const outline = result.clouds[0].points;
    const left = Math.min(...outline.map(point => point.x));
    const right = Math.max(...outline.map(point => point.x));
    const top = Math.min(...outline.map(point => point.y));
    const bottom = Math.max(...outline.map(point => point.y));
    for (let i = 0; i < result.nodes.length; i++) {
      const a = result.nodes[i];
      expect(a.x).toBeGreaterThanOrEqual(left + 19.9);
      expect(a.x).toBeLessThanOrEqual(right - 19.9);
      expect(a.y).toBeGreaterThanOrEqual(top + 19.9);
      expect(a.y).toBeLessThanOrEqual(bottom - 19.9);
      for (const b of result.nodes.slice(i + 1)) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(41.999);
    }
    expect(positions(createAtlasLayout()(atlas))).toEqual(positions(result));
  });

  it('admits refreshed metadata and labels without moving notes or rebuilding outlines', () => {
    const atlas = createDemoAtlas(), layout = createAtlasLayout();
    const initial = layout(atlas);
    const refreshed = {...atlas, revision: atlas.revision + 1, labelGeneration: 'new-labels', nodes: atlas.nodes.map(node => ({...node, preview:'New body', tags:['changed'], effectiveOpenCount:3, lastViewedAtMillis:Date.now()})), clouds:atlas.clouds.map(cloud => ({...cloud, label:'New label'}))};
    const next = layout(refreshed);
    expect(positions(next)).toEqual(positions(initial));
    expect(next.clouds[0].points).toBe(initial.clouds[0].points);
    expect(next.nodes[0].node.preview).toBe('New body');
    expect(next.clouds[0].cloud.label).toBe('New label');
  });

  it('does not retain deleted notes, handles empty maps, and uses filename titles', () => {
    const atlas = createDemoAtlas(), layout = createAtlasLayout();
    layout(atlas);
    const remaining = {...atlas, nodes:atlas.nodes.slice(1)};
    expect(layout(remaining).nodes.some(mark => mark.node.id === atlas.nodes[0].id)).toBe(false);
    expect(layout({...atlas, nodes:[], clouds:[]}).nodes).toEqual([]);
    expect(noteTitle({...atlas.nodes[0], fileName:'Actual file.md', title:'Different heading'})).toBe('Actual file');
  });
});
