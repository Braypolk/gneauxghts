// Throwaway presentation lab: browser fixtures only; no native vault access.
import { createServer } from 'vite';
import { readFile } from 'node:fs/promises';

process.env.VITE_E2E_BROWSER = 'true';
const server = await createServer({
  server: { host: '127.0.0.1', port: 1424, strictPort: true },
  plugins: [{
    name: 'throwaway-related-button-prototype',
    enforce: 'pre',
    async load(id) {
      if (!id.endsWith('/src/routes/+page.svelte')) return;
      const code = await readFile(id, 'utf8');
      return code.replace('<script lang="ts">', '<script lang="ts">\n  import RelatedButtonPrototype from "$lib/features/notepad/related/RelatedButtonPrototype.svelte";')
        + '\n{#if import.meta.env.DEV}<RelatedButtonPrototype />{/if}';
    }
  }]
});
await server.listen();
console.log('Related placement lab: http://127.0.0.1:1424/?variant=A');
const close = async () => { await server.close(); process.exit(0); };
process.on('SIGINT', close);
process.on('SIGTERM', close);
