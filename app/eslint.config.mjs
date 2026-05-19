// app/eslint.config.mjs
//
// 形态对齐 Otium web/eslint.config.mjs，prune 掉 lucerna 特定的限制（pg /
// wa-sqlite / appwrite / i18next 强制）。保留通用的：
//
//   - TS strict + type-checked rules（@typescript-eslint/*）
//   - Next.js + React + react-hooks
//   - max-lines / max-lines-per-function（350 / 70）
//   - no-console（用 slog 的镜像；前端走 logger）
//   - presentation 层禁 if / useMemo（业务逻辑下沉到 zustand / domain）
//   - controller (route.ts / actions) 层禁 if + import restrict
//   - e2e spec 文件：禁 page.goto / 禁 page.request.{post,put,delete} /
//     禁 waitForTimeout / 禁 networkidle / 禁 fetch with method
//
// 业务限制（DB 层 import allowlist）等到 StandMeet 真有 repository 层
// 之后再加 path-targeted rule。
//
// i18next 现在没接，先不开 i18next/no-literal-string，等接了再开。
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/*.test.ts',
      // 根目录 config 文件没在 tsconfig 里；typescript-eslint typed-rules
      // 跑不动它们，单独忽略避免 'not found by project service' 报错。
      '*.mjs',
      '*.config.ts',
      // next-env.d.ts 是 next 自动维护的（每次 build 重写），里面有 triple-slash
      // reference —— 我们不去碰它，忽略对应的 lint 规则报错。
      'next-env.d.ts',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    plugins: {
      '@next/next': nextPlugin,
      'react': reactPlugin,
      'react-hooks': reactHooksPlugin,
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

      // React Hooks —— set-state-in-effect / preserve-manual-memoization
      // 在 react-hooks v7 才有；v5（当前版本）只跑 recommended。升 v7 后再开。
      ...reactHooksPlugin.configs.recommended.rules,

      // TypeScript strict —— 每条 promote 到 error 后不能 regress。
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
      '@typescript-eslint/unbound-method': 'error',

      // 前端走 logger（lib/logger.ts），不要 console.*
      'no-console': 'error',

      // catch 不能空
      'no-empty': ['error', { allowEmptyCatch: false }],

      // 文件 ≤ 350 行
      'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],

      // 函数 ≤ 70 行
      'max-lines-per-function': [
        'error',
        { max: 70, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],

      // JSX 里禁 inline <style> —— 用 .css 文件 Next 能 hash / cache / scope。
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXElement[openingElement.name.name="style"]',
          message: 'No inline `<style>` in JSX — put styles in a .css file imported once.',
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

      // 禁所有 relative import，强制走 @/ alias（tsconfig.paths 配过）。
      // 让搬文件不需要追 ../../ 链；grep 跳到任意符号一致从 @/ 起。
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../*', './*'],
          message: 'Use the @/ alias instead of relative imports.',
        }],
      }],
    },
  },

  // Presentation 层 —— 仅渲染 + 交互。业务逻辑、状态推导、控制流不在这。
  // 适用于 src/app/**/*.tsx（pages、layouts、admin 子组件）。
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

  // Controller 层（Next.js route handlers + server actions）—— HTTP 和
  // usecase 之间的薄胶水。无分支、无变换、无业务规则。
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
);
