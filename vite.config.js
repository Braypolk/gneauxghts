/// <reference types="vitest/config" />
// Tauri doesn't have a Node.js server to do proper SSR
// so we use adapter-static with a fallback to index.html to put the site in SPA mode
// See: https://svelte.dev/docs/kit/single-page-apps
// See: https://v2.tauri.app/start/frontend/sveltekit/ for more info
import adapter from "@sveltejs/adapter-static";

import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;

/** @returns {import("vite").Plugin} */
function e2eServerIdentity() {
  /** @param {import("vite").ViteDevServer | import("vite").PreviewServer} server */
  const attach = (server) => {
    const token = process.env.GNEAUXGHTS_E2E_SERVER_TOKEN;
    if (!token) return;
    server.middlewares.use('/__gneauxghts_e2e_reset', (_request, response) => {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      response.setHeader('Cache-Control', 'no-store');
      response.end('<!doctype html><meta charset="utf-8"><title>E2E storage reset</title>');
    });
    server.middlewares.use('/__gneauxghts_e2e_identity', (_request, response) => {
      response.setHeader('Content-Type', 'text/plain');
      response.setHeader('Cache-Control', 'no-store');
      response.end(token);
    });
  };
  return { name: 'gneauxghts:e2e-server-identity', configureServer: attach, configurePreviewServer: attach };
}

const languageDataVendorPath = new URL(
  "./src/lib/vendor/codemirrorLanguageData.ts",
  import.meta.url,
).pathname;

// Redirect `@codemirror/language-data` to the curated vendor subset, EXCEPT
// when the importer is the vendor file itself — it needs the real package.
// A plugin (rather than a static `resolve.alias`) is required because the
// vendor file imports the bare specifier it aliases; a static alias would make
// that import resolve back to the vendor file (a cycle that yields an undefined
// `languages` export under Vitest's resolver).
/** @returns {import("vite").Plugin} */
function curatedLanguageData() {
  return {
    name: "gneauxghts:curated-language-data",
    enforce: "pre",
    resolveId(source, importer) {
      if (source !== "@codemirror/language-data") {
        return null;
      }
      if (importer && importer.startsWith(languageDataVendorPath)) {
        return null;
      }
      return languageDataVendorPath;
    },
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  cacheDir: process.env.VITE_E2E_BROWSER === 'true' ? 'node_modules/.vite-e2e-browser'
    : process.env.VITE_E2E_NATIVE === 'true' ? 'node_modules/.vite-e2e-native' : undefined,

  plugins: [
    e2eServerIdentity(),
    curatedLanguageData(),
    sveltekit({
      preprocess: vitePreprocess(),
      adapter: adapter({ fallback: "index.html" }),
      // Desktop assets change with app updates, so keep deployment polling disabled.
      version: { pollInterval: 0 }
    }),
    tailwindcss()
  ],
  build: {
    rolldownOptions: {
      output: {
        // Kit 3 supplies codeSplitting groups, which take precedence over manualChunks.
        codeSplitting: {
          groups: [
            {
              name: "codemirror-vendor",
              test: /node_modules\/(?:@codemirror\/(?:view|commands|state|language|lang-|legacy-modes)|@lezer\/)/,
            },
            { name: "graph-vendor", test: /node_modules\/d3/ },
          ],
        },
      },
    },
  },
  test: {
    // Keep per-file isolation while avoiding a separate process for each worker.
    pool: "threads",
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: process.env.VITE_E2E_BROWSER === 'true' || process.env.VITE_E2E_NATIVE === 'true' ? false : host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // Native code and local issue/evaluation artifacts do not affect the UI.
      // Live E2E reports must not reload the WebView during citation checks.
      ignored: ["**/src-tauri/**", "**/.scratch/**"],
    },
  },
}));
