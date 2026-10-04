import type { AtlasNode, AtlasCloud, AtlasLink, VaultAtlasResponse } from '$lib/types/atlas';

// Fictional, deterministic corpus for testing the interaction without a vault.
export function createDemoAtlas(): VaultAtlasResponse {
  const themes: [string, string, string[]][] = [
    ['Learning & memory', 'Recall improves when we revisit an idea in a different context. What would make this useful in everyday work?', ['Retrieval beats rereading', 'A walk after learning', 'The forgetting curve', 'Teaching as a test', 'A notebook for questions', 'Why examples stick']],
    ['Design & attention', 'A useful interface lets someone understand the choice before committing. Reduce effort without hiding the evidence.', ['The cost of a blank canvas', 'Designing for return visits', 'Readable beats beautiful', 'Progressive disclosure', 'Calm software', 'When a map helps']],
    ['Writing & ideas', 'Collecting sources is only the beginning. Compare their claims, make the disagreement visible, and write in your own words.', ['An outline is a conversation', 'From notes to an essay', 'Write the awkward first draft', 'Connecting distant ideas', 'A source is not a conclusion', 'Small daily writing']],
    ['Projects & decisions', 'A decision log records the alternatives and why we chose one. Revisit the assumption when the evidence changes.', ['Keep a decision journal', 'A small experiment first', 'Meetings need an output', 'The useful project brief', 'What should we stop doing', 'Plans versus evidence']],
    ['Gardens & systems', 'A healthy system has room for variation. Observe a small change over time before redesigning the whole environment.', ['Compost and feedback loops', 'A garden is never finished', 'Small systems grow', 'The value of wild edges', 'Seasonal rhythms', 'Observing before intervening']],
    ['Walking & observation', 'Walking gives attention a different rhythm. An unfamiliar route can reveal a detail we stopped noticing.', ['The familiar street', 'Walking without headphones', 'Notes from the river', 'Weather as a memory cue', 'A city of small stories', 'Routes and rituals']],
  ];
  const now = Date.now();
  const nodes: AtlasNode[] = [];
  const clouds: AtlasCloud[] = [];
  const links: AtlasLink[] = [];
  const colors: [number, number, number, number][] = [[90,145,120,100],[98,136,185,100],[183,126,85,100],[161,115,161,100],[139,153,77,100],[89,159,168,100]];
  themes.forEach(([label, preview, titles], topic) => {
    const id = `topic-${topic}`;
    const cx = (topic % 3) * 330 - 330, cy = Math.floor(topic / 3) * 320 - 160;
    const members: string[] = [];
    titles.forEach((title, index) => {
      const nodeId = `demo-${topic}-${index}`;
      members.push(nodeId);
      nodes.push({ id: nodeId, noteId: nodeId, notePath: `Demo/${label}/${title}.md`, title, fileName: `${title}.md`, documentKind: 'note', x: cx + Math.cos(index * Math.PI / 3) * 75, y: cy + Math.sin(index * Math.PI / 3) * 65, radius: 6, cloudId: id, parentCloudId: id, childCloudId: null, clusterId: id, subclusterId: null, centrality: .4, importance: .4, lastViewedAtMillis: index === 0 ? null : now - (topic * 13 + index * 11) * 86_400_000, createdAtMillis: now - (190 - topic * 19 - index * 11) * 86_400_000, updatedAtMillis: now - (topic * 7 + index * 6) * 86_400_000, preview: `${title}. ${preview}`, tags: [label.toLowerCase().split(' & ')[0]], isolated: false });
      if (index > 0) links.push({id: `${nodeId}-link`, sourceId: `demo-${topic}-0`, targetId: nodeId, kind: index % 3 === 0 ? 'wikilink' : 'semantic', score: .86 - index * .025, strength: .86 - index * .025});
    });
    clouds.push({id, parentId: null, level: 0, label, labelSource: 'keybert', noteCount: members.length, density: .7, color: colors[topic], centroid: [cx, cy], radius: 110, hull: [[cx-110,cy-100],[cx+110,cy-100],[cx+110,cy+100],[cx-110,cy+100]], memberNodeIds: members, coreNodeIds: members, outlierNodeIds: [], childCloudIds: [], representativeNodeIds: members.slice(0,2)});
  });
  links.push({id:'bridge-writing-memory', sourceId:'demo-0-3',targetId:'demo-2-1',kind:'semantic',score:.78,strength:.78}, {id:'bridge-design-project',sourceId:'demo-1-2',targetId:'demo-3-1',kind:'wikilink',score:1,strength:1}, {id:'bridge-garden-walking',sourceId:'demo-4-5',targetId:'demo-5-1',kind:'semantic',score:.74,strength:.74});
  for (const [index,title] of ['An unfiled thought','The question I cannot place'].entries()) {
    nodes.push({...nodes[0],id:`loose-${index}`,noteId:`loose-${index}`,notePath:`Demo/${title}.md`,title,fileName:`${title}.md`,preview:'An idea that does not fit the current topics. Unusual notes should still be easy to find.',x:-100+index*160,y:340,cloudId:null,parentCloudId:null,clusterId:null,isolated:true,tags:[]});
  }
  return {status:'ready',reason:null,revision:1,generatedAtMillis:now,structuralGeneration:'fictional-demo',labelGeneration:'fictional-demo',publishedAtMillis:now,stale:false,publishInProgress:false,nodes,links,clouds};
}
