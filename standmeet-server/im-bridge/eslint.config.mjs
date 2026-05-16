import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  tseslint.configs.base,
  { ignores: ["dist*/", "node_modules/", "*.js", "*.mjs"] },
  {
    files: ["**/*.ts"],
    linterOptions: { noInlineConfig: true },
    languageOptions: { globals: globals.node },
    rules: {
      "max-lines": ["error", { max: 350, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["error", { max: 100, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.spec.ts", "tests/**"],
    rules: {
      "max-lines": "off",
      "max-lines-per-function": "off",
    },
  },
);
