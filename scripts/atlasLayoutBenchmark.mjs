// Run with pnpm exec tsx scripts/atlasLayoutBenchmark.mjs.
// Synthetic layout benchmark, including cloud captions; no vault or IPC access.
import { createAtlasLayout } from '../src/lib/features/atlas/prototype/atlasLayout.ts';
import { createDemoAtlas } from '../src/lib/features/atlas/prototype/demo.ts';
const demo = createDemoAtlas();
for (const count of [166, 1000, 2000, 5000]) {
  const roots = 18;
  const nodes = Array.from({length: count}, (_, i) => {
    const root = i % roots, offset = Math.floor(i / roots), angle = offset * 2.399963;
    const radius = 15 * Math.sqrt(offset);
    return {...demo.nodes[i % demo.nodes.length], id:`note-${i}`, cloudId:`root-${root}`, parentCloudId:`root-${root}`, childCloudId:null, x:(root % 6) * 300 + Math.cos(angle) * radius, y:Math.floor(root / 6) * 300 + Math.sin(angle) * radius};
  });
  const clouds = Array.from({length: roots}, (_, root) => {
    const x = (root % 6) * 300, y = Math.floor(root / 6) * 300;
    return {...demo.clouds[root % demo.clouds.length], id:`root-${root}`, centroid:[x,y], hull:[[-100,-100],[100,-100],[100,100],[-100,100]].map(([dx,dy])=>[x+dx,y+dy]), memberNodeIds:nodes.filter(node=>node.cloudId===`root-${root}`).map(node=>node.id)};
  });
  const atlas = {...demo, nodes, clouds};
  const layout = createAtlasLayout();
  const start = performance.now(); layout(atlas); const cold = performance.now() - start;
  const warm = performance.now(); layout({...atlas, revision:2, nodes:nodes.map(node=>({...node, preview:'Refreshed metadata'}))});
  console.log(`${count} notes / ${roots} roots: initial ${cold.toFixed(1)}ms, metadata refresh ${(performance.now()-warm).toFixed(1)}ms`);
}
