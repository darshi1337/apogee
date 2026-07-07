import { defineConfig } from "vite";
import { resolve } from "path";
import { cpSync, existsSync, mkdirSync } from "fs";

// Copy static assets (manifest, icons, fonts, content scripts) into dist/
function copyStaticPlugin() {
  return {
    name: "copy-static",
    closeBundle() {
      const dist = resolve(__dirname, "dist");

      // manifest.json
      cpSync(resolve(__dirname, "manifest.json"), resolve(dist, "manifest.json"));

      // assets/ (icons, fonts, SVGs)
      cpSync(resolve(__dirname, "assets"), resolve(dist, "assets"), { recursive: true });

      // content scripts (not bundled — injected on demand via chrome.scripting)
      cpSync(resolve(__dirname, "content"), resolve(dist, "content"), { recursive: true });
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist",
    emptyDirFirst: true,
    // Don't minify for easier extension review
    minify: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup/popup.html"),
        "offscreen/offscreen": resolve(__dirname, "offscreen/offscreen.html"),
        "background/service-worker": resolve(__dirname, "background/service-worker.js"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: (assetInfo) => {
          // Keep CSS alongside its entry
          if (assetInfo.name?.endsWith(".css")) {
            return "[name][extname]";
          }
          return "assets/[name]-[hash][extname]";
        },
      },
    },
  },
  plugins: [copyStaticPlugin()],
});
