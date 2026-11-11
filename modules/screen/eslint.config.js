import js from "@eslint/js";
import tseslint from "typescript-eslint";

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
);
