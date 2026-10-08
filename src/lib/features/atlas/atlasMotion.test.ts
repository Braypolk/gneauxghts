import { describe, expect, it } from 'vitest';
import { createDemoAtlas } from '../../../../scripts/fixtures/atlasDemo';
import { createAtlasLayout } from './atlasLayout';
import { atlasGeometryMoved, interpolateAtlas } from './atlasMotion';

describe('Atlas transitions', () => {
  it('interpolates identities from the displayed pose and removes deleted notes immediately', () => {
    const atlas = {...createDemoAtlas(), worldLayout: true};
    const layout = createAtlasLayout();
    const from = layout(atlas);
    const to = layout({...atlas, nodes: atlas.nodes.slice(1).map(node => ({...node,x:node.x+100}))});
    const halfway = interpolateAtlas(from,to,0.5);
    expect(halfway.nodes.length).toBe(to.nodes.length);
    expect(halfway.nodes[0].x).toBe(to.nodes[0].x-50);
    expect(halfway.nodes.some(mark => mark.node.id===atlas.nodes[0].id)).toBe(false);
    const interrupted = interpolateAtlas(halfway,to,0.5);
    expect(interrupted.nodes[0].x).toBe(to.nodes[0].x-25);
    expect(interpolateAtlas(from,to,1)).toBe(to);
  });
  it('does not animate metadata updates or repack an accepted world', () => {
    const atlas = {...createDemoAtlas(), worldLayout:true};
    const layout = createAtlasLayout();
    const before = layout(atlas);
    const after = layout({...atlas,nodes:atlas.nodes.map(node=>({...node,preview:'Updated'}))});
    expect(atlasGeometryMoved(before,after)).toBe(false);
    expect(after.nodes.map(mark=>[mark.x,mark.y])).toEqual(atlas.nodes.map(node=>[node.x,node.y]));
    const expanded = layout({...atlas,nodes:[...atlas.nodes,{...atlas.nodes[0],id:'far',noteId:'far',x:1e6,y:1e6,cloudId:null}]});
    expect(expanded.nodes.slice(0,-1).map(mark=>[mark.x,mark.y])).toEqual(before.nodes.map(mark=>[mark.x,mark.y]));
  });
});
