/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";

const host = process.env.TAURI_DEV_HOST;

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
  plugins: [curatedLanguageData(), sveltekit(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        /** @param {string} id */
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return;
          }

          if (id.includes("node_modules/mermaid")) {
            return "mermaid-vendor";
          }

          if (id.includes("node_modules/@codemirror/view")) {
            return "codemirror-vendor";
          }

          if (
            id.includes("node_modules/@codemirror/commands") ||
            id.includes("node_modules/@codemirror/state")
          ) {
            return "codemirror-vendor";
          }

          if (
            id.includes("node_modules/@codemirror/language") ||
            id.includes("node_modules/@codemirror/lang-") ||
            id.includes("node_modules/@codemirror/legacy-modes") ||
            id.includes("node_modules/@lezer/")
          ) {
            return "codemirror-vendor";
          }

          if (id.includes("node_modules/d3")) {
            return "graph-vendor";
          }
        },
      },
    },
  },
  test: {
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
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
