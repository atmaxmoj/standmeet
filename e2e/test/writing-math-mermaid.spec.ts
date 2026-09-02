// writing-math-mermaid.spec.ts —— I.2: the writings surface renders LaTeX (KaTeX) + mermaid
// diagrams. Follows the OpenWebUI approach: KaTeX 0.16 + mermaid 11, the same pipeline used
// by chat / wiki / output.
//
// Matrix:
//   - inline `$x^2$` embedded in a paragraph
//   - display `$$\\int_0^1 x\\,dx$$` as its own block
//   - ```mermaid sequenceDiagram``` fenced block
//
// Assertions:
//   - `.katex` DOM appears (math rendered)
//   - `.katex-display` DOM appears (block math on its own line)
//   - mermaid-svg testid appears (lazy chunk finished loading + render done)
//
// Mermaid is a lazy chunk + async render (~600KB); it renders a skeleton first
// (mermaid-loading) then swaps in the real SVG. The spec uses toBeVisible to wait for the
// real DOM to appear, with a generous timeout.

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'math-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'mathowner',
  fullName: 'Math Owner',
};

// MATH_MD — a body containing inline math + display math + mermaid.
// Display math has two real-world spellings, and BOTH must render as `.katex-display`
// (F-R-3):
//   (1) fenced/multi-line `$$` (each `$$` on its own line) — has always rendered fine.
//   (2) **single-line `$$…$$`** — Obsidian treats this as display, and the real vault (the 6
//       blocks in wiki/math/analysis/lagrangian, including one inside a blockquote) is
//       written entirely this way. remark-math v6+ instead treats single-line `$$x$$` as
//       **inline** → `.katex-display`=0 → tall formulas overlap the surrounding text. Fixed
//       in the shared pipeline (`markdown-helpers.promoteDisplayMath`): promote single-line
//       `$$…$$` into fenced form before rendering.
const MATH_MD = [
  'A quick energy identity: $E = mc^2$ inline.',
  '',
  'Block integral on its own line:',
  '',
  '$$',
  '\\int_0^1 x\\,dx = \\frac{1}{2}',
  '$$',
  '',
  // (2) single-line display — the Obsidian/real-vault spelling. One whole-line, one inside
  // a blockquote.
  'Single-line display (the Obsidian form the real vault uses):',
  '',
  '$$a^2 + b^2 = c^2$$',
  '',
  '> $$\\nabla_x L = 0$$',
  '',
  '## Sequence',
  '',
  '```mermaid',
  'sequenceDiagram',
  '  Visitor->>AI: ask',
  '  AI->>Visitor: answer',
  '```',
  '',
  'After the diagram.',
  '',
  // #36/#40: two currency amounts in one sentence — previously everything between $100 and
  // $200 got swallowed by KaTeX as a formula.
  'Pricing: it cost $100 up front and $200 on renewal.',
  '',
  // vault convention (raw/market/awareness/*.md): a literal dollar is authored as `\$`.
  // remark-math honors the CommonMark `\$` escape, so `\$80M on \$246M` must render as
  // literal "$80M on $246M" — NOT inline math — and the backslash must NOT leak to the
  // reader. Guards the same class the vault's notation-lint fixed, on the render side.
  'Revenue: \\$80M on \\$246M revenue this quarter.',
].join('\n');

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('writings · LaTeX + mermaid render · I.2', () => {
  test('inline + display math + mermaid block render in /writings/[slug]',
    async ({ request, page }) => {
      await mcpCreateMathWriting(request, 'math-mermaid-token');
      await goto(page, '/writings/math-mermaid-essay');
      const body = page.getByTestId('writing-article-body');
      await expect(body, 'page rendered').toBeVisible({ timeout: 10_000 });

      // KaTeX inline (e.g. E = mc^2) renders one .katex node; the display block adds
      // another .katex-display wrapper. Checking both together verifies the whole math
      // pipeline works end to end.
      await expect(body.locator('.katex').first(), 'inline math .katex')
        .toBeVisible({ timeout: 5_000 });
      await expect(body.locator('.katex-display').first(), 'display math .katex-display')
        .toBeVisible({ timeout: 5_000 });

      // F-R-3: BOTH the fenced block AND the two single-line `$$…$$` (whole-line + blockquote)
      // must render as display. On the buggy pipeline single-line `$$x$$` is parsed inline →
      // only the fenced block yields a `.katex-display` (count 1) → RED. After promoteDisplayMath
      // it is 3. This is the exact shape of the real note wiki/math/analysis/lagrangian.
      await expect
        .poll(async () => body.locator('.katex-display').count(),
          { message: 'single-line $$…$$ must render as display (Obsidian form)', timeout: 5_000 })
        .toBeGreaterThanOrEqual(3);

      // F-R-3 (visual): the display blocks must use the STANDARD katex.min.css layout —
      // centered — not a cramping custom override (`text-align: left; margin: 0.6em`) that made
      // tall equations (∑ with limits / \frac) overlap the adjacent text lines. Guards against
      // re-introducing that override.
      const align = await body.locator('.katex-display').first()
        .evaluate((el) => getComputedStyle(el).textAlign);
      expect(align, 'katex-display must use the standard centered layout, no left-align override')
        .toBe('center');

      // #36/#40: currency amounts render literally (not swallowed as a formula). Both $
      // signs stay in the text.
      await expect(body, 'currency $ rendered literally')
        .toContainText('it cost $100 up front and $200 on renewal');

      // vault `\$` convention: `\$80M on \$246M` → literal dollar signs, not inline math, and
      // the backslash must not leak out. If remark-math gets swapped for a hand-rolled regex
      // that's insensitive to `\$`, this test goes RED (the text turns into garbled math).
      await expect(body, 'escaped \\$ renders literal, no math, no backslash leak')
        .toContainText('Revenue: $80M on $246M revenue this quarter');

      // Mermaid lazy + async render: data-testid=mermaid-svg only appears after
      // MermaidBlock's useEffect finishes running setResult. Pulling in the lazy chunk
      // takes time, so allow 15s.
      await expect(body.getByTestId('mermaid-svg'), 'mermaid block 渲成 svg')
        .toBeVisible({ timeout: 15_000 });
      // the svg node is genuinely generated (mermaid produces its own <svg>)
      await expect(body.getByTestId('mermaid-svg').locator('svg'))
        .toBeVisible();
    });
});

async function mcpCreateMathWriting(
  request: APIRequestContext, tokenName: string,
): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, tokenName);
  const sid = await initMCP(request, apiToken);
  await callTool<{ writing_id: string }>(request, apiToken, sid, 'writing_create', {
    slug: 'math-mermaid-essay',
    title: 'Math + mermaid essay',
    excerpt: 'KaTeX inline + display + mermaid sequenceDiagram.',
    body_md: MATH_MD,
    cover_headline: 'math.', cover_hue: 'amber',
    tags: ['math', 'mermaid'],
    publish: true,
  });
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}
