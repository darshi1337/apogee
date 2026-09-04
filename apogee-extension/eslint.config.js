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
        process: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["vite.config.js", "tests/**/*.js", "scripts/**/*.mjs"],
    languageOptions: {
      globals: { ...globals.node },
    },
  },
  {
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
    files: ["content/content.js"],
    languageOptions: {
      globals: {
        Readability: "readonly",
        extractGeneric: "readonly",
        extractGmail: "readonly",
        extractYoutube: "readonly",
        extractBilibili: "readonly",
        extractHackerNews: "readonly",
        extractReddit: "readonly",
        extractLobsters: "readonly",
        extractGitHub: "readonly",
        extractGitLab: "readonly",
        extractWikipedia: "readonly",
        extractArxiv: "readonly",
        extractMastodon: "readonly",
        extractStackOverflow: "readonly",
        extractLemmy: "readonly",
        extractDiscourse: "readonly",
        extractBluesky: "readonly",
      },
    },
  },
  {
    files: ["content/extractors/generic.js"],
    languageOptions: {
      globals: { Readability: "readonly" },
    },
  },
  {
    files: ["content/extractors/thread.js"],
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern:
            "^(threadTruncate|buildThreadNodes|selectThreadComments|formatThreadComments|THREAD_COMMENTS_HEADER)$",
        },
      ],
    },
  },
  {
    files: [
      "content/extractors/hackernews.js",
      "content/extractors/reddit.js",
      "content/extractors/lobsters.js",
      "content/extractors/github.js",
      "content/extractors/gitlab.js",
      "content/extractors/mastodon.js",
      "content/extractors/stackoverflow.js",
      "content/extractors/lemmy.js",
      "content/extractors/discourse.js",
      "content/extractors/bluesky.js",
    ],
    languageOptions: {
      globals: {
        threadTruncate: "readonly",
        buildThreadNodes: "readonly",
        selectThreadComments: "readonly",
        formatThreadComments: "readonly",
        THREAD_COMMENTS_HEADER: "readonly",
      },
    },
  },
  prettier,
];
