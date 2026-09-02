import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  // Invariant: agent-core must not import HTTP / fs / DOM / Node globals.
  // Enforced by no-restricted-globals + no-restricted-imports. lint-grade also
  // backs the d4-agent-core-imports-pure spec with a static scan (Bash grep).
  {
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'agent-core must be HTTP-free; inject via LLMStreamer / ToolDispatcher / PromptSource ports' },
        { name: 'window', message: 'agent-core must be DOM-free' },
        { name: 'document', message: 'agent-core must be DOM-free' },
        { name: 'process', message: 'agent-core must be Node-free; let host adapter read env' },
      ],
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*', 'fs', 'fs/*', 'path', 'os', 'http', 'https', 'stream'], message: 'agent-core cannot import Node builtins; host adapter only' },
          ],
        },
      ],
    },
  },
);
