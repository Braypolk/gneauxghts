// Read-only Atlas preview server. Never writes into the vault.
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
const demoMode = args.includes('--demo');
let source = demoMode ? 'demo' : 'unavailable';
let snapshotNotice = '';
async function loadSnapshot() {
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
      // Existing app ranking weight: one counted open per 8h, minus one per 36h idle.
      // Read separately so an older DB without counts still supplies valid timestamps.
      try {
        const countedRows = JSON.parse(execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', join(vaultRoot, '.gneauxghts/app-state.sqlite3'), 'SELECT note_id, last_viewed_at_millis, open_count FROM app_state_note_activity'], {encoding:'utf8'}));
        const counted = new Map(countedRows.map(row => [row.note_id,row]));
        const now = Date.now();
        const counts = {};
        for (const node of snapshot.nodes) {
          const row = counted.get(node.noteId);
          if (!row) continue;
          const idleSteps = row.last_viewed_at_millis > 0 ? Math.floor(Math.max(0,now - row.last_viewed_at_millis) / (36 * 60 * 60 * 1000)) : 0;
          counts[node.id] = Math.max(0,Number(row.open_count) - idleSteps);
        }
        for (const node of snapshot.nodes) node.effectiveOpenCount = counts[node.id] ?? null;

      } catch { /* Timestamp-only compatibility with earlier app-state schemas. */ }
    } catch { snapshotNotice = 'Open-history data unavailable; review order uses the cached timestamps.'; }
    if (!snapshot.nodes.length) throw new Error('No readable notes in the cached Atlas.');
    source = 'vault';
  } catch {
    snapshot = null;
    source = 'unavailable';
    snapshotNotice = 'No readable published Atlas snapshot found. Open the native app and finish indexing, or launch the lab explicitly with --demo.';
  }
}

if (!demoMode) await loadSnapshot();
let demo;
const emptyResponse = () => ({ ...demo, status: 'unavailable', reason: snapshotNotice, nodes: [], links: [], clouds: [], publishInProgress: false, stale: false });
async function noteBody(node, isVault) {
  if (!isVault) return node.preview;
  const delta = relative(vaultRoot, resolve(node.notePath));
  if (delta.startsWith('..') || isAbsolute(delta)) throw new Error('Outside vault');
  return (await readFile(node.notePath, 'utf8')).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '').trimStart();
}
const server = await createServer({
  server: {host:'127.0.0.1',port:1422,strictPort:true,hmr:false},
  plugins: [{
    name:'throwaway-atlas-comparison',
    enforce:'pre',
    transform(code, id) {
      if (!id.split('?')[0].endsWith('/src/lib/e2e/browserBackend.ts')) return;
      // SvelteKit serves its own app template; Vite's index.html hook is not run.
      // Prepend the explicit fixture adapter before the backend is installed.
      // Browser previews apply their DOM theme without a native-window theme call.
      return {map:null,code:`let atlasPrototypeSource='vault';window.__GNEAUXGHTS_E2E_COMMANDS__=Object.fromEntries(['get_vault_atlas','search_vault_atlas','read_note','open_note'].map(command=>[command,async args=>{if(command==='get_vault_atlas')atlasPrototypeSource=new URLSearchParams(window.location.search).get('atlasPrototypeSource')||'vault';const result=await fetch('/__atlas-prototype/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command,args,source:atlasPrototypeSource})});if(!result.ok)throw new Error('Atlas comparison source unavailable');return result.json();}]));window.__GNEAUXGHTS_E2E_COMMANDS__['plugin:app|set_app_theme']=async()=>null;` + '\n' + code};
    },
    configureServer(vite) {
      vite.middlewares.use('/__atlas-prototype', async (req, res) => {
        res.setHeader('Content-Type','application/json');
        res.setHeader('Cache-Control','no-store');
        const respond = (data) => res.end(JSON.stringify(data));
        try {
          if (req.url?.startsWith('/snapshot')) { if (!demoMode) await loadSnapshot(); return respond({response:snapshot || (demoMode ? demo : emptyResponse()),source,notice:snapshotNotice}); }
          if (req.method !== 'POST' || req.url !== '/command') {res.statusCode=404; return respond({error:'Not found'});}
          let raw=''; for await (const chunk of req) raw += chunk;
          const {command,args={},source:requestedSource}=JSON.parse(raw);
          const useDemo = demoMode || requestedSource === 'demo';
          if (command === 'get_vault_atlas' && !useDemo) await loadSnapshot();
          const isVault = !!snapshot && !useDemo;
          const response = useDemo ? demo : snapshot ?? emptyResponse();
          if (command === 'get_vault_atlas') return respond(response);
          if (command === 'search_vault_atlas') {
            // Offline lab adapter: full-body lexical/tag matching only. Native
            // production calls the real indexed lexical/semantic Atlas search.
            const tags = [];
            const text = String(args.query || '').replace(/(?:tag:|#)(?:"([^"]+)"|([^\s]+))/gi, (_, quoted, bare) => { tags.push((quoted || bare).toLowerCase()); return ''; }).trim().toLowerCase();
            const terms = text.split(/\s+/).filter(Boolean);
            const candidates = await Promise.all(response.nodes.map(async node => {
              if (!tags.every(tag => node.tags.some(value => value.toLowerCase().replace(/^#/, '') === tag))) return null;
              const body = await noteBody(node, isVault).catch(() => '');
              const content = `${node.title} ${node.fileName} ${body}`.toLowerCase();
              return terms.every(term => content.includes(term)) ? node : null;
            }));
            return respond({status:response.status,reason:response.reason,query:args.query,generatedAtMillis:Date.now(),matches:candidates.filter(Boolean).map(node=>({noteId:node.noteId,notePath:node.notePath,documentKind:node.documentKind,score:1,semanticScore:0,lexicalScore:1,structuralScore:tags.length ? 1 : 0,reasonLabels:['Text match (offline lab)']}))});
          }
          const node=response.nodes.find(node => (args.noteId && node.noteId === args.noteId) || node.notePath === args.path || node.id === args.id);
          if (!node) {res.statusCode=404;return respond({error:'Note not in snapshot'});}
          const markdown = await noteBody(node, isVault);
          return respond({noteId:node.noteId,title:node.title,markdown,path:node.notePath,tags:node.tags});
        } catch {res.statusCode=500;respond({error:'Could not read the comparison source'});}
      });
    }
  }]
});
demo = (await server.ssrLoadModule('/scripts/fixtures/atlasDemo.ts')).createDemoAtlas();
await server.listen();
console.log(`Atlas lab: ${source}, ${snapshot?.nodes.length ?? (demoMode ? demo.nodes.length : 0)} notes. Read-only offline snapshot; text/tag search only.`);
console.log('Open http://127.0.0.1:1422/map');
const close=async()=>{await server.close();process.exit(0);};
process.on('SIGINT',close);process.on('SIGTERM',close);
