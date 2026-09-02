// app/eslint.config.mjs
//
// Shaped to match Otium web/eslint.config.mjs, with lucerna-specific restrictions pruned
// out (pg / wa-sqlite / appwrite / i18next enforcement). Keeps the generic ones:
//
//   - TS strict + type-checked rules (@typescript-eslint/*)
//   - Next.js + React + react-hooks
//   - max-lines / max-lines-per-function (350 / 70)
//   - no-console (the slog mirror; frontend goes through logger)
//   - presentation layer bans if / useMemo (business logic sinks to zustand / domain)
//   - controller (route.ts / actions) layer bans if + import restrict
//   - e2e spec files: ban page.goto / ban page.request.{post,put,delete} /
//     ban waitForTimeout / ban networkidle / ban fetch with method
//
// Business restrictions (DB-layer import allowlist) wait for a path-targeted rule until
// StandMeet actually has a repository layer.
//
// i18next isn't wired up yet, so i18next/no-literal-string stays off until it is.
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import i18nextPlugin from 'eslint-plugin-i18next';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      // Two **build artifacts** under public/: TeX fonts and the embed bundle, both source
      // from elsewhere moved in at build time — they shouldn't be linted by this repo's own
      // source rules (tsconfig doesn't include them either).
      'public/tikz-fonts/**',
      'public/embed.js',
      '**/*.test.ts',
      // Root-level config files aren't in tsconfig; typescript-eslint's typed-rules can't run
      // on them, so they're ignored separately to avoid a 'not found by project service' error.
      '*.mjs',
      '*.config.ts',
      // Same reason: scripts/ is build-time node scripts (run alongside the build), not part of app's tsconfig.
      'scripts/**',
      // next-env.d.ts is auto-maintained by next (rewritten on every build) and contains a
      // triple-slash reference — we don't touch it, so its lint errors are ignored.
      'next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: {
      '@next/next': nextPlugin,
      'react': reactPlugin,
      'react-hooks': reactHooksPlugin,
      'i18next': i18nextPlugin,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      // Next.js
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      '@next/next/no-html-link-for-pages': 'error',
      '@next/next/no-img-element': 'error',

      // React
      ...reactPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',

      // i18n —— UI copy lives in the message catalog (src/i18n/messages/), never inline.
      //
      // This rule is the **only** thing that actually holds this line: relying on the convention
      // of "remember to use t()" gets broken by the first person in a hurry, and once broken there's
      // no signal at all — the string still renders, it just can never be translated.
      //
      // Shape taken from Otium / youteacher, two already-proven projects (same plugin, same mode).
      //
      // **Say clearly where it stops covering**: `mode: 'jsx-only'` would pull attributes in too,
      // but of those ~571 occurrences roughly half (testid / h / w / href / mainTestId…) aren't
      // copy at all, and the ~304 that really are copy (label / placeholder / title / kicker / hint)
      // hit a prior blocker: several components derive data-testid **from the label prop**
      // (WritingField's `writing-field-${label}`, SkillField's `skill-field-${label}`) — swap
      // label for t() and the testid changes with it, breaking every test.
      // So the attribute cut needs testid decoupled first; it's a separate cut, not a corner of this one.
      //
      // Hence `jsx-text-only` here (the new name for markupOnly): **JSX text nodes, covered fully;
      // attributes, none of them**. Don't list ignoreAttribute here — it has zero effect in this
      // mode (the long allowlist in Otium / youteacher is dead config, verified by testing:
      // `placeholder="ask me anything"` sails through there too).
      // A config comment that doesn't hold is the same disease as an empty state that doesn't hold.
      'i18next/no-literal-string': ['error', { mode: 'jsx-text-only' }],

      // React Hooks —— set-state-in-effect / preserve-manual-memoization
      // only exist in react-hooks v7; v5 (current version) only runs recommended. Enable after upgrading to v7.
      ...reactHooksPlugin.configs.recommended.rules,

      // TypeScript strict —— once a rule is promoted to error, it must not regress.
      '@typescript-eslint/no-unused-expressions': ['error', {
        allowShortCircuit: true,
        allowTernary: true,
      }],
      '@typescript-eslint/no-unsafe-assignment': 'error',
      '@typescript-eslint/no-unsafe-member-access': 'error',
      '@typescript-eslint/no-unsafe-argument': 'error',
      '@typescript-eslint/no-unsafe-call': 'error',
      '@typescript-eslint/no-unsafe-return': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/require-await': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-assertions': ['error', { assertionStyle: 'never' }],
      '@typescript-eslint/unbound-method': 'error',

      // Frontend goes through logger (lib/logger.ts), not console.*
      'no-console': 'error',

      // catch must not be empty
      'no-empty': ['error', { allowEmptyCatch: false }],

      // files ≤ 350 lines
      'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],

      // functions ≤ 70 lines
      'max-lines-per-function': [
        'error',
        { max: 70, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],

      // Ban inline <style> in JSX + ban the style={{...}} attribute — use .css /
      // Tailwind classes instead (design tokens already live in globals.css @theme;
      // parameterized styles go in component CSS).
      //
      // For the rare truly runtime-dynamic case (CSS-variable threading; a continuous value
      // that isn't a finite set), add a single-line `// eslint-disable-next-line
      // no-restricted-syntax` with a brief reason — never bypass it for "convenient for now".
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXElement[openingElement.name.name="style"]',
          message: 'No inline `<style>` in JSX — put styles in a .css file imported once.',
        },
        {
          selector: 'JSXAttribute[name.name="style"]',
          message: 'No `style={{...}}` attribute in JSX — use Tailwind classes or a CSS file. ' +
            'Truly runtime-dynamic values (continuous, props-driven): single-line eslint-disable with a why.',
        },
      ],

      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports' },
      ],
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } },
      ],

      // Ban all relative imports, force the @/ alias (configured in tsconfig.paths).
      // Lets moving a file skip chasing a ../../ chain; grep-jumping to any symbol
      // consistently starts from @/.
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../*', './*'],
          message: 'Use the @/ alias instead of relative imports.',
        }],
      }],

      // Ban data-testid from leaking into a React component's prop API —— the test hook may
      // only attach to native DOM elements (lowercase JSX like <button>/<div>/<input>), which
      // the Next compiler then strips in prod builds. Components (uppercase JSX) shouldn't
      // expose testid as a prop.
      'react/forbid-component-props': ['error', {
        forbid: [{
          propName: 'data-testid',
          message: 'data-testid is a test concern. Put it on a raw DOM element (e.g. <button data-testid="...">), not on a component. Tests should otherwise locate components via getByRole / getByLabel.',
        }],
      }],
    },
  },

  // Presentation layer —— rendering + interaction only. No business logic, state derivation,
  // or control flow here. Applies to src/app/**/*.tsx (pages, layouts, admin subcomponents).
  {
    files: [
      'src/app/**/*.tsx',
      'src/components/**/*.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXElement[openingElement.name.name="style"]',
          message: 'No inline `<style>` in JSX — put styles in a .css file imported once.',
        },
        {
          selector: 'JSXAttribute[name.name="style"]',
          message: 'No `style={{...}}` attribute in JSX — use Tailwind classes or a CSS file. ' +
            'Truly runtime-dynamic values: single-line eslint-disable with a why.',
        },
        {
          selector: 'IfStatement',
          message:
            'Presentation layer: no `if`. ' +
            'Business logic → domain or usecase. ' +
            'State derivation → zustand selector. ' +
            'Conditional rendering → && or ternary.',
        },
        {
          selector: 'CallExpression[callee.name="useMemo"]',
          message:
            'Presentation layer: no `useMemo`. ' +
            'Derived state should be computed in zustand store actions. ' +
            'Components read pre-computed values from store — zero calculation in render.',
        },
      ],
      'complexity': ['error', { max: 3 }],
      'max-lines-per-function': [
        'error',
        { max: 70, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],
    },
  },

  // Controller layer (Next.js route handlers + server actions) —— thin glue between HTTP and
  // the usecase. No branching, no transformation, no business rules.
  {
    files: [
      'src/app/**/route.ts',
      'src/app/actions/**/*.ts',
    ],
    rules: {
      'complexity': ['error', { max: 3 }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'IfStatement',
          message:
            'Controller layer: no `if`. ' +
            'Auth checks → route guard. Validation → usecase. ' +
            'Conditional response → early return from a usecase + ternary here.',
        },
      ],
    },
  },

  // Markdown renderer —— body_md comes from owner input + the AI MCP, src is an arbitrary URL
  // (CDN / third-party / a future standmeet-asset:<id> presigned URL), with no fixed width/height
  // or domain. next/image requires width+height, which is incompatible with markdown <img>
  // semantics, so this one file allows raw <img>.
  {
    files: ['src/components/writings/WritingArticleMarkdown.tsx'],
    rules: {
      '@next/next/no-img-element': 'off',
    },
  },
);
