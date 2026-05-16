import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  tseslint.configs.base,
  { ignores: ["dist*/", ".next/", "node_modules/", "*.js", "*.mjs"] },
  {
    files: ["**/*.ts", "**/*.tsx"],
    linterOptions: { noInlineConfig: true },
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "max-lines": ["error", { max: 350, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "tests/**"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
    },
  },
);
