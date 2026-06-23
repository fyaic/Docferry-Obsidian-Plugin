import tsParser from "@typescript-eslint/parser";
import tseslint from "typescript-eslint";
import obsidianmd from "eslint-plugin-obsidianmd";

// Root-level lint config so the Obsidian plugin review environment can install
// and resolve the `obsidian` types from the repository root, even though the
// plugin source lives under `plugin/`. Without this, the audit cannot resolve
// Obsidian's type declarations and reports spurious `@typescript-eslint/no-unsafe-*`
// warnings across every Obsidian API call.
export default [
  { ignores: ["**/node_modules/**", "**/main.js"] },
  ...tseslint.configs.recommendedTypeChecked.map((c) => ({ ...c, files: ["plugin/src/**/*.ts"] })),
  ...obsidianmd.configs.recommended,
  {
    files: ["plugin/src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./plugin/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
];
