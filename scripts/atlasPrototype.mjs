// Throwaway, read-only Atlas comparison server. Never writes into the vault.
import { readFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, basename, resolve, relative, isAbsolute } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const args = process.argv.slice(2);
const vaultArgument = args.indexOf('--vault');
let snapshot = null;
let vaultRoot = null;
let source = 'demo';
let snapshotNotice = '';
if (!args.includes('--demo')) {
  try {
    const config = vaultArgument >= 0 ? {notesRoot:args[vaultArgument + 1]} : await json(join(homedir(), 'Library/Application Support/com.braypolkinghorne.gneauxghts/.gneauxghts-state.json'));
    vaultRoot = resolve(vaultArgument >= 0 ? args[vaultArgument + 1] : config.notesRoot || join(homedir(), 'Documents/Gneauxghts'));
    const root = join(vaultRoot, '.gneauxghts/cache/atlas');
    const pointer = await json(join(root, 'ready-hidden.json'));
    snapshot = (await json(join(root, basename(pointer.artifactFile)))).response;
    const labelPointer = await json(join(root, 'label-ready-hidden.json')).catch(() => null);
    if (labelPointer?.structuralGeneration === snapshot.structuralGeneration) {
      const labels = await json(join(root, basename(labelPointer.artifactFile)));
      if (labels.structuralGeneration === snapshot.structuralGeneration) {
        for (const cloud of snapshot.clouds) {
          const label = labels.labels[cloud.id];
          if (label) { cloud.label = label.label; cloud.labelSource = label.source; }
        }
        snapshot.labelGeneration = labelPointer.labelGeneration;
      }
    }
    // Same missing-file suppression as the backend; no cache repair or rebuild.
    const present = await Promise.all(snapshot.nodes.map(async (node) => {
      try { await access(node.notePath); return node; } catch { return null; }
    }));
    snapshot.nodes = present.filter(Boolean);
    const ids = new Set(snapshot.nodes.map(node => node.id));
    snapshot.links = snapshot.links.filter(link => ids.has(link.sourceId) && ids.has(link.targetId));
    snapshot.clouds = snapshot.clouds.map(cloud => ({...cloud, memberNodeIds: cloud.memberNodeIds.filter(id => ids.has(id)), coreNodeIds: cloud.coreNodeIds.filter(id => ids.has(id)), outlierNodeIds: cloud.outlierNodeIds.filter(id => ids.has(id)), representativeNodeIds: cloud.representativeNodeIds.filter(id => ids.has(id)), noteCount: cloud.memberNodeIds.filter(id => ids.has(id)).length})).filter(cloud => cloud.noteCount > 0);
    try {
      const rows = JSON.parse(execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', join(vaultRoot, '.gneauxghts/app-state.sqlite3'), 'SELECT note_id, last_viewed_at_millis FROM app_state_note_activity'], {encoding:'utf8'}));
      const activity = new Map(rows.map(row => [row.note_id, row.last_viewed_at_millis]));
      for (const node of snapshot.nodes) node.lastViewedAtMillis = activity.get(node.noteId) ?? null;
    } catch { snapshotNotice = 'Open-history data unavailable; review order uses the cached timestamps.'; }
    if (!snapshot.nodes.length) throw new Error('No readable notes in the cached Atlas.');
    source = 'vault';
    console.log(`Atlas lab: ${snapshot.nodes.length} notes from a read-only vault snapshot.`);
  } catch {
    snapshot = null;
    snapshotNotice = 'No published Atlas snapshot found. Using the fictional demo vault.';
  }
}

let demo;
const bodies = new Map();
const server = await createServer({
  server: {host:'127.0.0.1',port:1422,strictPort:true,hmr:false},
  plugins: [{
    name:'throwaway-atlas-comparison',
    enforce:'pre',
    transformIndexHtml() {
      return [{tag:'script',injectTo:'head-prepend',children:`let atlasPrototypeSource='vault';window.__GNEAUXGHTS_E2E_COMMANDS__=Object.fromEntries(['get_vault_atlas','search_vault_atlas','read_note','open_note'].map(command=>[command,async args=>{if(command==='get_vault_atlas')atlasPrototypeSource=new URLSearchParams(window.location.search).get('atlasPrototypeSource')||'vault';const result=await fetch('/__atlas-prototype/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,args,source:atlasPrototypeSource})});if(!result.ok)throw new Error('Atlas comparison source unavailable');return result.json();}]));`},{tag:'script',attrs:{type:'module'},children:`const badge=document.createElement('a');badge.href='/map/prototype?variant=treemap';badge.textContent='Atlas lab · read-only comparison';badge.style.cssText='position:fixed;top:5px;left:12px;z-index:9999;font:11px system-ui;color:#74958c;text-decoration:none';document.body.append(badge);`}];
    },
    configureServer(vite) {
      vite.middlewares.use('/__atlas-prototype', async (req, res) => {
        res.setHeader('Content-Type','application/json');
        res.setHeader('Cache-Control','no-store');
        const respond = (data) => res.end(JSON.stringify(data));
        try {
          if (req.url?.startsWith('/snapshot')) return respond({response:snapshot || demo,source,notice:snapshotNotice});
          if (req.method !== 'POST' || req.url !== '/command') {res.statusCode=404; return respond({error:'Not found'});}
          let raw=''; for await (const chunk of req) raw += chunk;
          const {command,args={},source:requestedSource}=JSON.parse(raw);
          const isVault = !!snapshot && requestedSource !== 'demo';
          const response=isVault ? snapshot : demo;
          if (command === 'get_vault_atlas') return respond(response);
          if (command === 'search_vault_atlas') {
            const query=String(args.query || '').trim().toLowerCase();
            return respond({status:'ready',reason:null,query:args.query,generatedAtMillis:Date.now(),matches:response.nodes.filter(node => `${node.title} ${node.preview} ${node.tags.join(' ')}`.toLowerCase().includes(query)).map(node=>({noteId:node.noteId,notePath:node.notePath,documentKind:node.documentKind,score:1,semanticScore:0,lexicalScore:1,structuralScore:0,reasonLabels:['Text match (prototype)']}))});
          }
          const node=response.nodes.find(node => (args.noteId && node.noteId === args.noteId) || node.notePath === args.path || node.id === args.id);
          if (!node) {res.statusCode=404;return respond({error:'Note not in snapshot'});}
          let markdown=node.preview;
          if (isVault) {
            const delta=relative(vaultRoot,resolve(node.notePath));
            if (delta.startsWith('..') || isAbsolute(delta)) throw new Error('Outside vault');
            if (!bodies.has(node.id)) bodies.set(node.id, await readFile(node.notePath,'utf8'));
            markdown=bodies.get(node.id).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trimStart();
          }
          return respond({noteId:node.noteId,title:node.title,markdown,path:node.notePath,tags:node.tags});
        } catch {res.statusCode=500;respond({error:'Could not read the comparison source'});}
      });
    }
  }]
});
demo = (await server.ssrLoadModule('/src/lib/features/atlas/prototype/demo.ts')).createDemoAtlas();
await server.listen();
console.log('Open http://127.0.0.1:1422/map/prototype?variant=treemap');
console.log('Original Atlas comparison: http://127.0.0.1:1422/map');
const close=async()=>{await server.close();process.exit(0);};
process.on('SIGINT',close);process.on('SIGTERM',close);
