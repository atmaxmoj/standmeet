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
    files: ["tests/**/*.ts", "fixtures/**/*.ts"],
    rules: {
      // Tests are exempt from line limits
      "max-lines": "off",
      "max-lines-per-function": "off",
      // Disallow importing modules that enable direct network requests.
      // Tests must go through Playwright browser actions only.
      // TODO: migrate tests from raw fetch/WebSocket to Playwright browser actions, then upgrade to "error"
      "no-restricted-imports": [
        "warn",
        {
          paths: [
            { name: "ws", message: "Use Playwright browser actions instead of raw WebSocket." },
            { name: "node-fetch", message: "Use Playwright browser actions instead of node-fetch." },
            { name: "undici", message: "Use Playwright browser actions instead of undici." },
          ],
          patterns: [
            { group: ["**/api-client*", "**/helpers*"], message: "Do not import API client helpers. Tests must go through the UI." },
          ],
        },
      ],
      "no-restricted-globals": [
        "warn",
        { name: "fetch", message: "Use Playwright browser actions instead of fetch()." },
        { name: "WebSocket", message: "Use Playwright browser actions instead of WebSocket." },
      ],
    },
  },
);
