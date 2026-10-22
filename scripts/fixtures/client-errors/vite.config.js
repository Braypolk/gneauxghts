import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import adapter from '@sveltejs/adapter-static';

const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const output = path('../../../.scratch/package-capabilities/evidence/client-errors/');

// A separate Kit application exercises real route boundaries without shipping
// a failure route, flag, global function, or IPC command in Gneauxghts.
export default defineConfig({
  cacheDir: `${output}vite`,
  plugins: [sveltekit({
    files: {
      src: path('./src'),
      routes: path('./src/routes'),
      appTemplate: path('./src/app.html'),
      hooks: { client: path('../../../src/hooks.client.ts') }
    },
    outDir: `${output}kit`,
    adapter: adapter({ pages: `${output}build`, assets: `${output}build`, fallback: 'index.html' })
  })],
  server: { host: '127.0.0.1', port: 1447, strictPort: true, hmr: false },
  preview: { host: '127.0.0.1', port: 1447, strictPort: true }
});
