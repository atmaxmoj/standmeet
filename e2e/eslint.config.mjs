import tseslint from 'typescript-eslint';

// E2E-only repo.  Same TS strict spine as MainApp + every e2e-spec
// rule preserved verbatim (no waitForTimeout / setTimeout-as-sleep,
// no networkidle, no mutating page.request, no fetch with mutating
// method, no page.goto in spec).  Drops React / Next / i18n /
// presentation / controller blocks since this repo has none of
// those layers.

// SPEC_SYNTAX_RESTRICTIONS — the no-restricted-syntax selectors every spec file
// obeys.  Extracted to a const so the connector-spec block can extend (not
// replace) them with the CJK ban below.
const SPEC_SYNTAX_RESTRICTIONS = [
  {
    selector: 'CallExpression[callee.property.name="waitForTimeout"]',
    message:
      'Avoid waitForTimeout — wait for a specific event, element, or response instead.',
  },
  {
    // `await new Promise(r => setTimeout(r, X))` is the same anti-pattern.
    selector: 'CallExpression[callee.name="setTimeout"]',
    message:
      'No setTimeout-as-sleep in e2e. Wait for a specific event, response, or expose a deterministic signal.',
  },
  {
    // networkidle is unreliable (long-poll, telemetry, hot-reload all break it).
    selector:
      'CallExpression[callee.property.name="waitForLoadState"][arguments.0.value="networkidle"]',
    message:
      'Avoid waitForLoadState("networkidle") — wait for the specific response/element you actually need.',
  },
  {
    selector:
      'CallExpression[callee.property.name="post"][callee.object.property.name="request"]',
    message: 'E2E: use UI for write operations, not page.request.post().',
  },
  {
    selector:
      'CallExpression[callee.property.name="put"][callee.object.property.name="request"]',
    message: 'E2E: use UI for write operations, not page.request.put().',
  },
  {
    selector:
      'CallExpression[callee.property.name="delete"][callee.object.property.name="request"]',
    message: 'E2E: use UI for write operations, not page.request.delete().',
  },
  {
    selector:
      'CallExpression[callee.name="fetch"] Property[key.name="method"][value.value="POST"]',
    message: 'E2E: use UI for POST flows, not fetch({method:"POST"}). Click the actual button.',
  },
  {
    selector:
      'CallExpression[callee.name="fetch"] Property[key.name="method"][value.value="PUT"]',
    message: 'E2E: use UI for PUT flows, not fetch({method:"PUT"}). Click the actual button.',
  },
  {
    selector:
      'CallExpression[callee.name="fetch"] Property[key.name="method"][value.value="DELETE"]',
    message:
      'E2E: use UI for DELETE flows, not fetch({method:"DELETE"}). Click the actual button.',
  },
  {
    selector:
      'CallExpression[callee.name="fetch"] Property[key.name="method"][value.value="PATCH"]',
    message:
      'E2E: use UI for PATCH flows, not fetch({method:"PATCH"}). Click the actual button.',
  },
  {
    // Spec files don't navigate at all — they call setup helpers
    // (e.g. login(page), navigateToBookshelf(page)) that own all
    // page.goto calls.  This forces every test to start from a
    // realistic state instead of teleporting to a deep URL.
    selector: 'CallExpression[callee.property.name="goto"]',
    message:
      'E2E spec: no page.goto. Call a setup helper from fixtures/ in beforeEach/beforeAll, or click your way there from a known entry point.',
  },
];

// CJK_RESTRICTIONS — test titles and expect() assertion messages surface in CI /
// report / failure output, so they must be English (comments may stay Chinese).
// Scoped to connector specs for now; widen to all of test/ as the rest is converted.
const CJK_RESTRICTIONS = [
  {
    selector: 'CallExpression[callee.name=/^(test|it)$/] > Literal[value=/[\\u4e00-\\u9fff]/]',
    message: 'Test titles must be English (they show in CI/report output). Keep any Chinese in a comment.',
  },
  {
    selector:
      'CallExpression[callee.property.name=/^(describe|fixme|only|skip)$/] > Literal[value=/[\\u4e00-\\u9fff]/]',
    message: 'test.describe/fixme titles must be English. Keep any Chinese in a comment.',
  },
  {
    // expect(actual, 'message') — the message is a direct Literal child; assert the
    // actual against a Chinese value via .toContain('…') instead, never as expect()'s literal.
    selector: 'CallExpression[callee.name="expect"] > Literal[value=/[\\u4e00-\\u9fff]/]',
    message: 'expect() assertion messages must be English (they show on failure). Keep any Chinese in a comment.',
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/dist/**',
      '**/build/**',
    ],
  },
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-empty': ['error', { allowEmptyCatch: false }],

      // Test code may print — keep `console.log` available for ad-hoc
      // debugging during a spec run.
      'no-console': 'off',

      'max-lines': ['error', { max: 350, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': [
        'error',
        { max: 70, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],

      // 禁所有 relative import；走 @/ alias（tsconfig.paths 配过）。
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['../*', './*'],
          message: 'Use the @/ alias instead of relative imports.',
        }],
      }],
    },
  },
  // Spec-file rules — same as MainApp.  Setup primitives (page.goto,
  // login flows) live in fixtures/ and are exempt; everything else must
  // drive the UI through real user actions.
  {
    files: ['test/**/*.spec.ts'],
    rules: {
      // The strict type-checked rules from the recommended set are
      // relaxed in spec files only.  Specs read freely from JSON
      // payloads, page.evaluate returns, etc., where strict typing
      // would just produce noise.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'no-restricted-syntax': ['error', ...SPEC_SYNTAX_RESTRICTIONS],
    },
  },
  // Connector specs additionally ban Chinese in test titles + expect messages
  // (English-only, enforced).  Re-declares the full list because flat-config
  // replaces (not merges) a rule when two blocks match the same file.
  {
    files: ['test/connector-*.spec.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...SPEC_SYNTAX_RESTRICTIONS, ...CJK_RESTRICTIONS],
    },
  },
);
