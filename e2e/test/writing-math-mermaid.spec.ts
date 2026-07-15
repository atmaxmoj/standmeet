// writing-math-mermaid.spec.ts —— I.2: writings surface 渲 LaTeX (KaTeX)
// + mermaid 图。OpenWebUI 路线：KaTeX 0.16 + mermaid 11，跟 chat / wiki /
// output 同套 pipeline。
//
// 矩阵:
//   - inline `$x^2$` 嵌入段落
//   - display `$$\\int_0^1 x\\,dx$$` 独立块
//   - ```mermaid sequenceDiagram``` fenced block
//
// 断言:
//   - `.katex` DOM 出现 (math 渲了)
//   - `.katex-display` DOM 出现 (block math 单独行)
//   - mermaid-svg testid 出现 (lazy chunk 拉完 + render done)
//
// Mermaid 是 lazy chunk + 异步 render (~600KB)；先渲 skeleton
// (mermaid-loading) 后切真 SVG。spec 用 toBeVisible 等真 DOM 出现，
// timeout 留余量。

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

// MATH_MD —— 一段含 inline math + display math + mermaid 的 body。
// 注意 display math `$$ ... $$` 必须换行 (remark-math v6+ 单行 `$$x$$`
// 会被当 inline 处理；要 .katex-display 必须 fenced 风格)。
const MATH_MD = [
  'A quick energy identity: $E = mc^2$ inline.',
  '',
  'Block integral on its own line:',
  '',
  '$$',
  '\\int_0^1 x\\,dx = \\frac{1}{2}',
  '$$',
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
  // #36/#40:一句话里两个货币金额,之前 $100..$200 之间被 KaTeX 当公式吃掉。
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

      // KaTeX inline (e.g. E = mc^2) 渲一个 .katex 节点；display 块再加
      // 一个 .katex-display 包裹。两个一起验证 math 整条线通。
      await expect(body.locator('.katex').first(), 'inline math .katex')
        .toBeVisible({ timeout: 5_000 });
      await expect(body.locator('.katex-display').first(), 'display math .katex-display')
        .toBeVisible({ timeout: 5_000 });

      // #36/#40:货币金额按字面渲(不被当公式吃掉)。两个 $ 都还在文本里。
      await expect(body, 'currency $ rendered literally')
        .toContainText('it cost $100 up front and $200 on renewal');

      // vault `\$` convention:`\$80M on \$246M` → 字面美元,不是行内数学,反斜杠不外泄。
      // 若 remark-math 被换成对 \$ 不敏感的手搓正则,这条会 RED(文本变成乱码数学)。
      await expect(body, 'escaped \\$ renders literal, no math, no backslash leak')
        .toContainText('Revenue: $80M on $246M revenue this quarter');

      // Mermaid lazy + 异步 render：MermaidBlock useEffect 跑完 setResult
      // 后才出 data-testid=mermaid-svg。lazy chunk 拉过来要时间，留 15s。
      await expect(body.getByTestId('mermaid-svg'), 'mermaid block 渲成 svg')
        .toBeVisible({ timeout: 15_000 });
      // svg 节点真生成 (mermaid 自带 <svg>)
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
