import tseslint from 'typescript-eslint';

// E2E-only repo.  Same TS strict spine as MainApp + every e2e-spec
// rule preserved verbatim (no waitForTimeout / setTimeout-as-sleep,
// no networkidle, no mutating page.request, no fetch with mutating
// method, no page.goto in spec).  Drops React / Next / i18n /
// presentation / controller blocks since this repo has none of
// those layers.

// e2eLocal — a local plugin holding one rule with its OWN name, so it carries its own
// severity independent of the error-level `no-restricted-syntax` below.
//
// no-goto-teleport (WARN) — the strict `page.goto` ban only matches the MEMBER form
// `page.goto(...)`. Specs sidestep it by calling the fixtures/navigate `goto(page, '/deep/url')`
// FREE function (callee is a bare Identifier, not a `.goto` member), teleporting straight into deep
// routes — exactly what the ban meant to stop (255 such call sites across 126 specs today). This
// flags every bare `goto(...)` call in a spec as a WARNING: non-blocking, so the whole backlog is
// visible at once; flip to 'error' when the specs are converted to entry-point + click-nav.
const e2eLocal = {
  rules: {
    'no-goto-teleport': {
      meta: {
        type: 'suggestion',
        docs: { description: 'no fixtures/navigate goto() teleport in spec bodies' },
        messages: {
          teleport:
            'E2E spec: no goto() teleport — reach the page via a known entry point + click-nav ' +
            '(warning for now; the fixtures/navigate goto helper is being phased out of specs).',
        },
      },
      create(context) {
        return {
          CallExpression(node) {
            if (node.callee.type === 'Identifier' && node.callee.name === 'goto') {
              context.report({ node: node.callee, messageId: 'teleport' });
            }
          },
        };
      },
    },
    // no-direct-mutating-api (WARN) — the no-restricted-syntax bans below only match the MEMBER
    // form `page.request.post(...)` and free `fetch({method})`. Specs sidestep them by seeding
    // through a bare APIRequestContext: `const api = await playwright.request.newContext();
    // api.post('/api/admin/…'); api.patch(…)` — a different receiver name, the same capability
    // ([[goto-guard-checks-name-not-capability]]). And `.patch` was never banned at all. Seeding a
    // spec through the API directly hands the implementation its own expected data and lets the test
    // pass while the real GUI/MCP path is broken ([[e2e-must-be-blackbox]]). This flags EVERY
    // `.post/.put/.patch/.delete` member call in a spec regardless of receiver: WARN for now so the
    // backlog is visible at once; flip to 'error' once specs seed via MCP/fixtures or drive the GUI.
    'no-direct-mutating-api': {
      meta: {
        type: 'suggestion',
        docs: { description: 'no direct non-GET API calls in spec bodies — seed via MCP/fixtures or drive the GUI' },
        messages: {
          mutate:
            'E2E spec: no direct non-GET API (.{{m}}()). Seeding or acting by calling the API directly ' +
            'bypasses the real GUI/MCP path, so the test can pass while that path is broken. Drive the UI, ' +
            'or seed through an MCP/fixture setup helper (warning for now).',
        },
      },
      create(context) {
        const MUTATING = new Set(['post', 'put', 'patch', 'delete']);
        // The rigging is a non-GET straight to the OWNER surface (/api/admin/*), which every one of
        // these features also exposes through the GUI. The sanctioned machine door (MCP /mcp) and
        // the login/claim/token bootstrap are NOT rigging — a spec must be allowed to sign in and to
        // drive the owner's own client. So flag only when the target URL names /api/admin/.
        const firstArgText = (node) => {
          const a = node.arguments[0];
          if (!a) return '';
          if (a.type === 'Literal' && typeof a.value === 'string') return a.value;
          if (a.type === 'TemplateLiteral') return a.quasis.map((q) => q.value.raw).join('');
          return '';
        };
        // No URL carve-outs — not even login/claim/token. A spec may reach the owner API through
        // NO direct call; bootstrap is allowed ONLY because it lives in fixtures/ (which this
        // spec-scoped rule does not lint). Excluding bootstrap by URL here would be a hole to
        // relabel a seeding call through later — confine it to a place (fixtures), not a name.
        return {
          CallExpression(node) {
            const c = node.callee;
            if (
              c.type === 'MemberExpression' &&
              c.property.type === 'Identifier' &&
              MUTATING.has(c.property.name) &&
              firstArgText(node).includes('/api/admin/')
            ) {
              context.report({ node: c.property, messageId: 'mutate', data: { m: c.property.name } });
            }
          },
        };
      },
    },
  },
};

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

      // Ban all relative imports; use the @/ alias (configured in tsconfig.paths).
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
    plugins: { 'e2e-local': e2eLocal },
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
      // Backlog cleared (all specs converted to semantic nav helpers + fixture/MCP seeds, with
      // marked eslint-disables on the action-under-test calls), so both are now ENFORCED.
      'e2e-local/no-goto-teleport': 'error',
      'e2e-local/no-direct-mutating-api': 'error',
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
