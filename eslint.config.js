import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores([
    "**/node_modules/**",
    "**/dist/**",
    "**/coverage/**",
    ".agents/**",
    ".claude/**",
    "docs/**",
    "memoria/**",
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // Programas soltos para correr com o Node no computador de quem opera
  // (ex.: apps/api/scripts/gerar-chave.mjs), fora do projecto TypeScript.
  {
    files: ["**/*.mjs"],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: { console: "readonly", process: "readonly" },
    },
  },
]);
