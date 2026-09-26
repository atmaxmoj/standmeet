import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import i18nextPlugin from 'eslint-plugin-i18next';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
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
  {
    // i18n —— the widgets render on owners' pages for visitors in any language, so their UI copy
    // comes from the SDK catalog (src/i18n.ts, t('key')), never inline. The widgets once shipped
    // English-only because nothing here checked (owner, 2026-09-25). `jsx-only`, not the app's
    // `jsx-text-only`: a string in a JSX expression (`{cond ? 'a' : 'b'}`) or attribute is copy too.
    // The attributes below carry machine values (test hooks, ARIA roles, sandbox flags, card html),
    // not words a visitor reads.
    files: ['src/widgets/**/*.tsx'],
    plugins: { i18next: i18nextPlugin },
    rules: {
      'i18next/no-literal-string': ['error', {
        mode: 'jsx-only',
        'jsx-attributes': {
          exclude: [
            'className', 'style', 'type', 'key', 'id', 'width', 'height',
            'data-.*', 'role', 'sandbox', 'srcDoc', 'autoComplete', 'inputMode', 'href', 'value',
          ],
        },
      }],
    },
  },
);
