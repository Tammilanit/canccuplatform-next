import js from "@eslint/js";
import tseslint from "typescript-eslint";

// The page script runs in the browser, untyped, so the typed rules skip it.
const BROWSER = Object.fromEntries(
  ["document", "fetch", "location", "setTimeout", "clearTimeout", "window", "crypto"].map((name) => [
    name,
    "readonly",
  ]),
);

export default tseslint.config(
  { ignores: ["dist/", "node_modules/", "eslint.config.js"] },
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
);
