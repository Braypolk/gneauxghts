import fs from 'node:fs';
const summaries=[];
for(const file of process.argv.slice(2)) {
 const profile=JSON.parse(fs.readFileSync(file,'utf8'));
 const nodes=new Map(profile.nodes.map(n=>[n.id,n])), parents=new Map();
 for(const n of profile.nodes) for(const child of n.children??[]) parents.set(child,n.id);
 const self=new Map(),inclusive=new Map(); let idle=0,program=0;
 const key=n=>JSON.stringify([n.callFrame.functionName,n.callFrame.url,n.callFrame.lineNumber]);
 for(let i=0;i<profile.samples.length;i++) {
  const duration=profile.timeDeltas[i]/1000;let node=nodes.get(profile.samples[i]);
  const leaf=key(node);self.set(leaf,(self.get(leaf)??0)+duration);
  if(node.callFrame.functionName==='(idle)') idle+=duration;
  if(node.callFrame.functionName==='(program)') program+=duration;
  const seen=new Set();
  while(node) {const k=key(node);if(!seen.has(k)){inclusive.set(k,(inclusive.get(k)??0)+duration);seen.add(k);}node=nodes.get(parents.get(node.id));}
 }
 const total=profile.timeDeltas.reduce((a,b)=>a+b,0)/1000;
 const format=map=>[...map].sort((a,b)=>b[1]-a[1]).map(([key,ms])=>{const [name,url,line]=JSON.parse(key);return {name,url,line:line+1,ms:+ms.toFixed(2),percentSampled:+(100*ms/total).toFixed(2)};});
 summaries.push({file,elapsedMs:(profile.endTime-profile.startTime)/1000,sampledMs:total,idleMs:idle,programMs:program,activeSampledMs:total-idle,
  self:format(self).slice(0,30),inclusive:format(inclusive).slice(0,55),
  selected:format(inclusive).filter(f=>/parseImageEmbeds|buildMarkdownDecorations|dispatchFromPane|notifyMarkdownChange|handleEditorMarkdownChange|recordUserEdit|work$|advance$|inventory/.test(f.name))});
}
console.log(JSON.stringify(summaries,null,2));
