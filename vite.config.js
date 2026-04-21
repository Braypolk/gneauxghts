import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { sveltekit } from "@sveltejs/kit/vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [sveltekit(), tailwindcss()],
  resolve: {
    alias: {
      "@codemirror/language-data": new URL("./src/lib/vendor/codemirrorLanguageData.ts", import.meta.url).pathname,
    },
  },
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

          if (id.includes("node_modules/draftly/")) {
            return "draftly-vendor";
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
