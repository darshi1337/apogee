import js from "@eslint/js";
import globals from "globals";
import prettier from "eslint-config-prettier";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "content/Readability.js"],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        // Vite's `define` (see vite.config.js) string-replaces
        // `process.env.TARGET_BROWSER` at build time; it isn't a real
        // runtime global, but source files reference it as one.
        process: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["vite.config.js", "tests/**/*.js"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
    // Content scripts are injected as plain (non-module) scripts, one per
    // file, into the same page global scope (see popup.js's
    // extractFromActiveTab), so functions declared in one file are called
    // from another with no import/export between them.
    files: ["content/**/*.js"],
    languageOptions: { sourceType: "script" },
    rules: {
      "no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^extract" },
      ],
    },
  },
  {
    // Only content.js *consumes* the other files' globals; declaring these
    // as globals on the files that define them would make ESLint flag the
    // declarations themselves as redeclaring a global.
    files: ["content/content.js"],
    languageOptions: {
      globals: {
        Readability: "readonly",
        extractGeneric: "readonly",
        extractGmail: "readonly",
        extractYoutube: "readonly",
      },
    },
  },
  {
    // generic.js consumes Readability.js's and paywall.js's globals (both
    // loaded first, see popup.js's extractFromActiveTab injection order),
    // but doesn't declare them.
    files: ["content/extractors/generic.js"],
    languageOptions: {
      globals: { Readability: "readonly", detectPaywall: "readonly" },
    },
  },
  {
    // lib/pageExtraction.js's tryWaybackFallback passes a func to
    // chrome.scripting.executeScript that runs inside the tab, where
    // Readability.js has already been injected as a global (see
    // extractFromActiveTab's own injection above it) - not in this file's
    // own module scope, but ESLint can't tell the difference.
    files: ["lib/pageExtraction.js"],
    languageOptions: {
      globals: { Readability: "readonly" },
    },
  },
  prettier,
];
