import { defineConfig } from "vite";
import { resolve } from "path";
import { cpSync, existsSync, mkdirSync } from "fs";

function copyStaticPlugin() {
  return {
    name: "copy-static",
    closeBundle() {
      const dist = resolve(__dirname, "dist");

      cpSync(
        resolve(__dirname, "manifest.json"),
        resolve(dist, "manifest.json"),
      );

      cpSync(resolve(__dirname, "assets"), resolve(dist, "assets"), {
        recursive: true,
      });

      cpSync(resolve(__dirname, "content"), resolve(dist, "content"), {
        recursive: true,
      });
    },
  };
}

export default defineConfig({
  build: {
    outDir: "dist",
    emptyDirFirst: true,
    minify: false,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup/popup.html"),
        "offscreen/offscreen": resolve(__dirname, "offscreen/offscreen.html"),
        "background/service-worker": resolve(
          __dirname,
          "background/service-worker.js",
        ),
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
  plugins: [
    copyStaticPlugin(),
    {
      name: "strip-crossorigin",
      enforce: "post",
      generateBundle(_options, bundle) {
        for (const [, asset] of Object.entries(bundle)) {
          if (asset.type === "asset" && asset.fileName.endsWith(".html")) {
            asset.source = asset.source
              .replace(/ crossorigin/g, "")
              .replace(/ rel="modulepreload"/g, ' rel="preload" as="script"');
          }
        }
      },
    },
  ],
});
