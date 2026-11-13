import js from "@eslint/js";
import tseslint from "typescript-eslint";

// The browser globals static/studio.js uses; it runs in the page, untyped, so the typed rules skip it.
const BROWSER = Object.fromEntries(
  [
    "document",
    "window",
    "location",
    "history",
    "sessionStorage",
    "fetch",
    "FormData",
    "DOMParser",
    "IntersectionObserver",
    "ResizeObserver",
    "CSS",
    "setTimeout",
    "setInterval",
    "structuredClone",
    "encodeURIComponent",
    "decodeURIComponent",
    "XMLHttpRequest",
  ].map((name) => [name, "readonly"]),
);

export default tseslint.config(
  // The render smoke runs inside the built image against dist/, and the stack tests in the stack
  // (test/stack/client.mjs), both outside the TypeScript project.
  {
    ignores: [
      "dist/",
      "node_modules/",
      "eslint.config.js",
      "test/render-smoke.mjs",
      "test/stack/*.mjs",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/restrict-template-expressions": ["error", { allowNumber: true }],
    },
  },
  {
    files: ["static/**/*.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      sourceType: "script",
      globals: BROWSER,
    },
  },
  // The Content page's script is a module, so it may import the replace plan it shares with tests.
  {
    files: [
      "static/studio-content.js",
      "static/studio-replace-plan.js",
      "static/studio-playlists.js",
      "static/studio-playlist-builder.js",
      "static/studio-playlist-editor.js",
      "static/studio-playlist-item.js",
    ],
    languageOptions: { sourceType: "module" },
  },
);
