// Local-only animation workbench. The ordinary Vite/Tauri build never loads it.
import { createServer } from 'vite';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

process.env.VITE_E2E_BROWSER = 'true';
const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.GNEAUXGHTS_ANIMATION_LAB_PORT || 1423);
const token = randomUUID();
const inventoryPath = '.scratch/workspace-dock-motion/animation-inventory.md';
const files = {
  morph: 'src/lib/ui/morphing-containers/motion.ts',
  surfaces: 'src/lib/ui/morphing-containers/MorphingContainers.svelte',
  search: 'src/lib/ui/search/searchMotion.ts',
  popup: 'src/lib/features/notepad/ui/searchResultsReveal.ts',
};
const source = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readFile(resolve(root, path), 'utf8')])));
const number = (text, pattern) => {
  const match = text.match(pattern);
  if (!match) throw new Error(`Animation source changed; update the lab matcher: ${pattern}`);
  return Number(match[1]);
};
const curve = (text, pattern) => {
  const match = text.match(pattern);
  if (!match) throw new Error(`Animation curve source changed: ${pattern}`);
  return match[1].split(',').map(Number);
};
const original = {
  duration: number(source.morph, /const travelDuration = ([\d.]+)/) + number(source.morph, /const pinchExtraDuration = ([\d.]+)/),
  curve: curve(source.morph, /const \[x1, y1, x2, y2\] = \[([^\]]+)\]/),
  searchDuration: number(source.search, /searchExpansionDuration = ([\d.]+)/),
  searchCurve: curve(source.search, /searchExpansionBezier = \[([^\]]+)\]/),
  fadeOut: number(source.surfaces, /transition: opacity ([\d.]+)ms/),
  fadeIn: number(source.surfaces, /transition-duration: ([\d.]+)ms/),
  reveal: number(source.surfaces, /motion.transition.progress >= ([\d.]+)/),
  popupIn: number(source.popup, /direction === 'out' \? [\d.]+ : ([\d.]+)/),
  popupOut: number(source.popup, /direction === 'out' \? ([\d.]+) : [\d.]+/),
};
let settings = structuredClone(original);
let appliedSettings = structuredClone(original);
function validate(value) {
  for (const key of ['duration', 'searchDuration', 'fadeOut', 'fadeIn', 'popupIn', 'popupOut']) {
    if (!Number.isFinite(value[key]) || value[key] < 1 || value[key] > 3000) throw new Error(`Invalid ${key}`);
  }
  if (!Number.isFinite(value.reveal) || value.reveal < 0 || value.reveal > 1) throw new Error('Invalid reveal');
  for (const key of ['curve', 'searchCurve']) {
    if (!Array.isArray(value[key]) || value[key].length !== 4 || value[key].some(x => !Number.isFinite(x) || Math.abs(x) > 4) || [0, 2].some(i => value[key][i] < 0 || value[key][i] > 1)) throw new Error(`Invalid ${key}`);
  }
  return Object.fromEntries(Object.keys(original).map(key => [key, value[key]]));
}
function replace(text, pattern, value) {
  if (!pattern.test(text)) throw new Error(`Source changed; cannot apply ${pattern}`);
  return text.replace(pattern, value);
}
function edit(key, text, values) {
  if (key === 'morph') {
    text = replace(text, /const travelDuration = [\d.]+;/, `const travelDuration = ${values.duration * 300 / 380};`);
    text = replace(text, /const pinchExtraDuration = [\d.]+;/, `const pinchExtraDuration = ${values.duration * 80 / 380};`);
    return replace(text, /const \[x1, y1, x2, y2\] = \[[^\]]+\];/, `const [x1, y1, x2, y2] = [${values.curve.join(', ')}];`);
  }
  if (key === 'surfaces') {
    text = replace(text, /motion.transition.progress >= [\d.]+/, `motion.transition.progress >= ${values.reveal}`);
    text = replace(text, /transition: opacity [\d.]+ms/, `transition: opacity ${values.fadeOut}ms`);
    return replace(text, /transition-duration: [\d.]+ms/, `transition-duration: ${values.fadeIn}ms`);
  }
  if (key === 'search') {
    text = replace(text, /searchExpansionDuration = [\d.]+/, `searchExpansionDuration = ${values.searchDuration}`);
    return replace(text, /searchExpansionBezier = \[[^\]]+\]/, `searchExpansionBezier = [${values.searchCurve.join(', ')}]`);
  }
  return replace(text, /direction === 'out' \? [\d.]+ : [\d.]+/, `direction === 'out' ? ${values.popupOut} : ${values.popupIn}`);
}
export function planMotionEdits(current, expected, values) {
  validate(values);
  for (const key of Object.keys(files)) if (current[key] !== expected[key]) throw new Error(`${files[key]} changed since launch. Restart the lab before applying.`);
  return Object.fromEntries(Object.keys(files).map(key => [key, edit(key, current[key], values)]));
}
export { original, edit, validate };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
const server = await createServer({
  server: { host: '127.0.0.1', port, strictPort: true, hmr: true },
  plugins: [{
    name: 'gneauxghts-animation-lab', enforce: 'pre',
    async load(id) {
      if (id.includes('?')) return null;
      const key = Object.keys(files).find(key => id === resolve(root, files[key]));
      if (key) return edit(key, await readFile(id, 'utf8'), settings);
    },
    transform(code, id) {
      const path = id.split('?')[0];
      if (path.endsWith('/src/lib/e2e/browserBackend.ts')) {
        return { code: `import '/src/lib/dev/animation-lab/runtime.ts';\n${code}`, map: null };
      }
    },
    configureServer(vite) {
      vite.middlewares.use('/__animation-lab', async (request, response) => {
        const pathname = (request.url || '/').split('?')[0];
        response.setHeader('Cache-Control', 'no-store');
        const send = (value, status = 200) => { response.statusCode = status; response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(value)); };
        try {
          if (pathname === '/state') return send({ settings, appliedSettings, original, token, inventory: await readFile(resolve(root, inventoryPath), 'utf8'), files });
          if (request.method === 'POST' && ['/settings', '/apply'].includes(pathname)) {
            if (request.headers.origin !== `http://127.0.0.1:${port}` || request.headers['x-animation-lab-token'] !== token) return send({ error: 'Invalid lab origin or token' }, 403);
            let raw = '';
            for await (const chunk of request) { raw += chunk; if (raw.length > 8192) throw new Error('Request too large'); }
            const values = validate(JSON.parse(raw));
            if (pathname === '/apply') {
              // Compare all files before writing any. Other chats may be editing them.
              const current = Object.fromEntries(await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readFile(resolve(root, path), 'utf8')])));
              const edits = planMotionEdits(current, source, values);
              for (const key of Object.keys(files)) {
                const next = edits[key];
                if (next !== current[key]) await writeFile(resolve(root, files[key]), next);
                source[key] = next;
              }
            }
            settings = values;
            if (pathname === '/apply') appliedSettings = structuredClone(values);
            for (const module of vite.moduleGraph.idToModuleMap.values()) {
              if (Object.values(files).some(path => module.id?.split('?')[0] === resolve(root, path))) vite.moduleGraph.invalidateModule(module);
            }
            return send({ settings, applied: pathname === '/apply' });
          }
          if (pathname !== '/' && pathname !== '') return send({ error: 'Not found' }, 404);
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(await vite.transformIndexHtml('/__animation-lab/', await readFile(resolve(root, 'src/lib/dev/animation-lab/index.html'), 'utf8')));
        } catch (error) { send({ error: String(error.message || error) }, 409); }
      });
    }
  }]
});
await server.listen();
console.log(`Animation lab: http://127.0.0.1:${port}/__animation-lab/`);
console.log('Uses in-memory fixtures. Timing edits preview in this server; Apply writes only the four listed motion sources.');
const close = async () => { await server.close(); process.exit(0); };
process.on('SIGINT', close); process.on('SIGTERM', close);

}
