import sonarjs from 'eslint-plugin-sonarjs';
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

    // no-tautological-assertion (ERROR) — an assertion that cannot fail.
    //
    // Worse than a missing assertion: the suite is green, the count goes up, and nothing is checked.
    //
    // ── What is already on the shelf, MEASURED against a probe file rather than assumed ─────────
    //
    // Four off-the-shelf sources were installed and run against six tautology shapes. Each result
    // below was confirmed with a positive control, so "no hit" means the rule ran and did not fire,
    // not that the scanner never saw the file:
    //
    //   shape                            core  sonarjs  proper-tests  playwright
    //   x === x                           ✅      ✅          –            –
    //   b && b                            –      ✅          –            –
    //   b || !b                           –       –           –            –
    //   f() === false || f()              –       –           –            –
    //   expect(true).toBe(true)           –       –           –            –
    //   expect(x).toBe(x)                 –       –           –            –
    //
    // So the shelf covers exactly one thing: BOTH SIDES LITERALLY IDENTICAL. That is what SonarLint
    // shows in an IDE, and `no-self-compare` / `sonarjs/no-identical-expressions` are kept on for it.
    // The four shapes below are invisible to all of them BY CONSTRUCTION:
    //
    //   expect(x).toBe(x)             not a binary expression at all, so no expression rule looks
    //   expect(true).toBe(true)       not a condition, so no-constant-condition never looks
    //   expect(b || !b)               `b` is a variable, so it is not a *constant* expression
    //   expect(f() === false || f())  `f()` is a call, and core cannot assume two calls agree — but
    //                                 inside ONE assertion it is a tautology whether they do or not
    //
    // eslint-plugin-proper-tests ships only no-useless-matcher-to-be-{defined,null} and two
    // unrelated rules; eslint-plugin-playwright's no-unnecessary-assertions is about repeated
    // Playwright matchers, not about vacuity. Both were installed, measured, and removed.
    //
    // Comparison is by SOURCE TEXT, not AST identity: two spellings of the same expression are
    // what a reader sees, and a false positive here is a test that deserves rewriting anyway.
    'no-tautological-assertion': {
      meta: {
        type: 'problem',
        docs: { description: 'an assertion that cannot fail is not an assertion' },
        messages: {
          sameBothSides:
            'Tautological assertion: both sides are the same expression `{{ expr }}`, so this ' +
            'passes whatever the code does. Assert the expected VALUE, not the expression again.',
          constant:
            'Tautological assertion: `{{ expr }}` is a constant, so this passes whatever the ' +
            'code does. Assert something the code produced.',
          excludedMiddle:
            'Tautological assertion: `{{ expr }}` is true for every value of its operand ' +
            '(X or not-X), so this passes whatever the code does.',
        },
      },
      create(context) {
        const src = context.sourceCode ?? context.getSourceCode();
        const text = (n) => src.getText(n).replace(/\s+/gu, ' ').trim();

        // The matchers whose argument is an expected VALUE, so that arg === expected is vacuous.
        const VALUE_MATCHERS = new Set([
          'toBe', 'toEqual', 'toStrictEqual', 'toContain', 'toContainEqual', 'toHaveLength',
        ]);
        const TRUTHY_MATCHERS = new Set(['toBeTruthy', 'toBe', 'toEqual']);

        // isNegationPair — b is a logical negation of a, or vice versa, spelled either way round.
        const negations = (n) => {
          const t = text(n);
          const out = new Set([`!${t}`, `!(${t})`, `${t} === false`, `${t} == false`,
            `${t} !== true`, `${t} != true`]);
          if (n.type === 'UnaryExpression' && n.operator === '!') out.add(text(n.argument));
          if (n.type === 'BinaryExpression' && (n.operator === '===' || n.operator === '==') &&
              text(n.right) === 'false') out.add(text(n.left));
          return out;
        };
        const isNegationPair = (a, b) => negations(a).has(text(b)) || negations(b).has(text(a));

        const isConstant = (n) =>
          n.type === 'Literal' ||
          (n.type === 'UnaryExpression' && n.operator === '!' && isConstant(n.argument));

        // The `expect(ARG)` of an `expect(ARG).matcher(...)` chain, or null.
        const expectArg = (callee) => {
          if (callee.type !== 'MemberExpression') return null;
          let obj = callee.object;
          // unwrap expect(x).not.toBe(...) and expect(x).resolves.toBe(...)
          while (obj.type === 'MemberExpression') obj = obj.object;
          if (obj.type !== 'CallExpression') return null;
          if (obj.callee.type !== 'Identifier' || obj.callee.name !== 'expect') return null;
          return obj.arguments.length === 1 ? obj.arguments[0] : null;
        };

        return {
          CallExpression(node) {
            const arg = expectArg(node.callee);
            if (arg === null) return;
            const matcher = node.callee.property?.name;

            // expect(X).toBe(X) — the same expression on both sides.
            if (VALUE_MATCHERS.has(matcher) && node.arguments.length === 1 &&
                text(arg) === text(node.arguments[0])) {
              context.report({ node, messageId: 'sameBothSides', data: { expr: text(arg) } });
              return;
            }
            // expect(true).toBe(true) / expect(1).toBeTruthy() — nothing under test is read.
            if (isConstant(arg) && (TRUTHY_MATCHERS.has(matcher) || matcher === 'toBeFalsy')) {
              context.report({ node, messageId: 'constant', data: { expr: text(arg) } });
              return;
            }
            // expect(X || !X) — true for every value of X, however X is spelled.
            if (arg.type === 'LogicalExpression' && arg.operator === '||' &&
                isNegationPair(arg.left, arg.right)) {
              context.report({ node, messageId: 'excludedMiddle', data: { expr: text(arg) } });
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
    plugins: { 'e2e-local': e2eLocal, sonarjs },
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
      'e2e-local/no-tautological-assertion': 'error',
      // sonarjs + core: the four tautology shapes the shelf already covers, measured
      // against a probe file rather than assumed (see the rule comment above).
      'sonarjs/no-identical-expressions': 'error',
      'sonarjs/no-gratuitous-expressions': 'error',
      'sonarjs/no-redundant-boolean': 'error',
      'sonarjs/no-same-argument-assert': 'error',
      'sonarjs/no-identical-conditions': 'error',
      'sonarjs/no-all-duplicated-branches': 'error',
      'no-self-compare': 'error',
      'no-constant-binary-expression': 'error',
      'no-constant-condition': ['error', { checkLoops: 'allExceptWhileTrue' }],
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
