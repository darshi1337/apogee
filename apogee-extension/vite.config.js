import { defineConfig } from "vite";
import { resolve } from "path";
import { cpSync, readFileSync, writeFileSync } from "fs";

function copyStaticPlugin(targetBrowser) {
  return {
    name: "copy-static",
    closeBundle() {
      const dist = resolve(__dirname, `dist/${targetBrowser}`);

      const manifestPath = resolve(__dirname, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

      if (targetBrowser === "firefox") {
        // Remove offscreen permission and simplify CSP for Firefox
        manifest.permissions = manifest.permissions.filter((p) => p !== "offscreen");
        manifest.content_security_policy = {
          extension_pages:
            "script-src 'self'; default-src 'self'; connect-src http://127.0.0.1:* http://localhost:*; img-src 'self' data:; font-src 'self'; style-src 'self'",
        };
        if (manifest.background) {
          delete manifest.background.service_worker;
        }
        // Chrome-only key (Firefox has no offscreen API, so no floor to
        // declare); browser_specific_settings.gecko already covers Firefox.
        delete manifest.minimum_chrome_version;
      } else {
        // Chrome MV3 doesn't support background.scripts
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
  };

  if (!isFirefox) {
    input["offscreen/offscreen"] = resolve(__dirname, "offscreen/offscreen.html");
  }

  return {
    define: {
      "process.env.TARGET_BROWSER": JSON.stringify(targetBrowser),
    },
    build: {
      outDir: `dist/${targetBrowser}`,
      emptyOutDir: true,
      minify: false,
      // Default esbuild target (~Chrome 87/Firefox 78) predates top-level
      // await. The extension already requires MV3 offscreen (Chrome 109+)
      // and WebGPU-capable browsers, so target the browsers this actually
      // runs on instead.
      target: "es2022",
      rollupOptions: {
        input,
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "chunks/[name]-[hash].js",
          assetFileNames: (assetInfo) => {
            // assetInfo.name is deprecated in Rollup 4 in favor of the
            // (possibly multi-entry) .names array.
            const name = assetInfo.names?.[0] ?? assetInfo.name;
            // Keep CSS alongside its entry
            if (name?.endsWith(".css")) {
              return "[name][extname]";
            }
            return "assets/[name]-[hash][extname]";
          },
        },
      },
    },
    plugins: [
      copyStaticPlugin(targetBrowser),

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
  };
});
