import { defineConfig } from "vite";
import { resolve } from "path";
import { cpSync, readFileSync, writeFileSync } from "fs";
import { ensureModelLibs } from "./scripts/model-libs.mjs";

function copyStaticPlugin(targetBrowser) {
  return {
    name: "copy-static",
    closeBundle() {
      const dist = resolve(__dirname, `dist/${targetBrowser}`);

      const manifestPath = resolve(__dirname, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

      if (targetBrowser === "firefox") {
        manifest.permissions = manifest.permissions.filter(
          (p) => p !== "offscreen",
        );
        manifest.content_security_policy = {
          extension_pages:
            "script-src 'self' 'wasm-unsafe-eval'; default-src 'self'; connect-src 'self' http://127.0.0.1:* http://localhost:* https://huggingface.co https://*.huggingface.co https://*.hf.co https://sponsor.ajay.app https://api.bilibili.com https://*.hdslb.com; img-src 'self' data:; font-src 'self'; style-src 'self'",
        };
        if (manifest.background) {
          delete manifest.background.service_worker;
        }
        delete manifest.minimum_chrome_version;
      } else {
        if (manifest.background) {
          delete manifest.background.scripts;
        }
      }

      writeFileSync(
        resolve(dist, "manifest.json"),
        JSON.stringify(manifest, null, 2),
      );

      cpSync(resolve(__dirname, "assets"), resolve(dist, "assets"), {
        recursive: true,
      });

      cpSync(resolve(__dirname, "content"), resolve(dist, "content"), {
        recursive: true,
      });

      cpSync(resolve(__dirname, "rules"), resolve(dist, "rules"), {
        recursive: true,
      });
    },
  };
}

function bundleModelLibsPlugin(targetBrowser) {
  // Edge is Chromium-based, so it shares the Chrome build path
  // (offscreen, service_worker, model libs). Only Firefox diverges.
  const isChromium = targetBrowser === "chrome" || targetBrowser === "edge";
  let libs = [];
  return {
    name: "bundle-webllm-model-libs",
    async buildStart() {
      if (!isChromium) return;
      libs = await ensureModelLibs();
    },
    closeBundle() {
      if (!isChromium) return;
      for (const { file, path } of libs) {
        cpSync(
          path,
          resolve(__dirname, `dist/${targetBrowser}/assets/model-libs/${file}`),
        );
      }
    },
  };
}

export default defineConfig(() => {
  const targetBrowser = process.env.TARGET_BROWSER || "chrome";
  const isFirefox = targetBrowser === "firefox";

  const input = {
    popup: resolve(__dirname, "popup/popup.html"),
    "background/service-worker": resolve(
      __dirname,
      "background/service-worker.js",
    ),
    "pdf.worker": resolve(
      __dirname,
      "node_modules/pdfjs-dist/build/pdf.worker.mjs",
    ),
  };

  if (!isFirefox) {
    input["offscreen/offscreen"] = resolve(
      __dirname,
      "offscreen/offscreen.html",
    );
  }

  return {
    base: "./",
    define: {
      "process.env.TARGET_BROWSER": JSON.stringify(targetBrowser),
    },
    build: {
      outDir: `dist/${targetBrowser}`,
      emptyOutDir: true,
      minify: false,
      modulePreload: false,
      target: "es2022",
      rollupOptions: {
        input,
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: (assetInfo) => {
            const name = assetInfo.names?.[0] ?? assetInfo.name;
            if (name?.endsWith(".css")) {
              return "[name][extname]";
            }
            if (/^ort-wasm.*\.wasm$/.test(name ?? "")) {
              return "assets/[name][extname]";
            }
            return "assets/[name]-[hash][extname]";
          },
        },
      },
    },
    plugins: [
      copyStaticPlugin(targetBrowser),
      bundleModelLibsPlugin(targetBrowser),

      {
        name: "strip-dev-mock",
        enforce: "pre",
        apply: "build",
        configResolved(config) {
          this._isWatch = !!config.build?.watch;
        },
        transform(code, id) {
          if (this._isWatch) return null;
          if (!id.endsWith("popup/popup.js")) return null;
          const stripped = code.replace(
            /if \(\s*typeof chrome === "undefined"[\s\S]*?await import\("\.\/mock\.js"\);\s*\}\n?/,
            "",
          );
          if (stripped === code) {
            this.warn(
              "strip-dev-mock: mock.js import guard not found in popup.js; " +
                "the strip pattern may be stale (mock chunk may still ship).",
            );
            return null;
          }
          return { code: stripped, map: null };
        },
      },

      {
        name: "strip-crossorigin",
        enforce: "post",
        generateBundle(_options, bundle) {
          for (const [, asset] of Object.entries(bundle)) {
            if (asset.type === "asset" && asset.fileName.endsWith(".html")) {
              asset.source = asset.source
                .replace(/\s*<link rel="modulepreload"[^>]*>/g, "")
                .replace(/ crossorigin/g, "");
            }
          }
        },
      },
    ],
  };
});
