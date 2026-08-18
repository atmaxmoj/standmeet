// visitor-chat-answer-render.spec.ts —— G-X: mock provider 流出含
// markdown / katex / mermaid 的 reply → 真 visitor chat 路径
// (PageShell → ConversationDeck → AnswerParas → ChatMarkdown) 渲染对。
//
// 之前 chat-render-* / document-render 系列都走 wiki landing 或者删
// 掉的 /dev/chat-render fixture path；从来没人验过"agent 文本回复带
// markdown" 这条线 (会过 splitParas 把 body 拆成多段、每段 ChatMarkdown
// 分别渲)。这个 spec 把 mock reply 设为含 5 个 markdown feature 的一段
// 体，verify 答案区里每个 feature 都正确渲染。
//
// next_reply scripting endpoint 是 next_tool 的对称扩展 (同一套 keyword KV，按
// 消息里嵌的 keyword 隔离)，不是新加 test-only endpoint —— mock provider 整个
// codepath 已经是 env-gated 的 dev/test 路径。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Browser } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { enterCodeSession } from '@/fixtures/navigate';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'INTRO-001';

// MARKDOWN_REPLY —— 一段含 5 大 feature 的 mock reply。注意每个块要被
// `\n\n` 隔开因为 useChat.splitParas 是按段拆 (mermaid fenced + math
// display 各自一段，避免跨段)。
const MARKDOWN_REPLY = [
  '# Heading',
  '',
  'A paragraph with **bold**, *italic*, and `inline code`.',
  '',
  '| col1 | col2 |',
  '| ---- | ---- |',
  '| a    | b    |',
  '',
  'Inline math: $E = mc^2$',
  '',
  '$$',
  '\\int_0^1 x^2 dx',
  '$$',
  '',
  '```mermaid',
  'graph LR; A-->B',
  '```',
  '',
  '[link](https://example.com)',
].join('\n');

test.describe('visitor chat answer 真路径 ChatMarkdown 渲染', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createAPIToken(request, csrf, 'answer-render-token');
    await createCode(request, csrf, {
      code: CODE, label: 'intro', purpose: 'answer-render spec',
    });
    await request.dispose();
  });

  test('mock reply 含 markdown/gfm/katex/mermaid → answer-body 全渲染对',
    async ({ browser, request }) => {
      // script mock reply 在 next /inference/stream 时流出
      const tag = await scriptMockReplyText(request, MARKDOWN_REPLY);

      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const skip = page.getByTestId('visitor-name-skip');
      if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skip.click();
      }

      const input = page.locator('[data-testid="chat-input-field"]');
      await input.fill(`show me everything${tag}`);
      await input.press('Enter');

      // answer 出现
      const answer = page.locator('[data-testid="answer-body"]').first();
      await expect(answer).toBeVisible({ timeout: 20_000 });

      // 各 markdown feature 都渲染对。mock provider 在 reply 前会 echo
      // 完整 [system:...] system prompt (capability fragments)，markdown
      // 渲完里头也有 <strong>/<em>/<code> 节点；assertion 走 hasText
      // 精确匹配本 spec 自己塞的 token (bold / italic / "inline code")。
      // heading
      await expect(answer.locator('h1')).toContainText('Heading');
      // bold / italic / inline code
      await expect(answer.locator('strong', { hasText: /^bold$/ })).toHaveCount(1);
      await expect(answer.locator('em', { hasText: /^italic$/ })).toHaveCount(1);
      await expect(answer.locator('code', { hasText: 'inline code' })).toHaveCount(1);
      // gfm table
      await expect(answer.locator('table th').first()).toContainText('col1');
      await expect(answer.locator('table td').first()).toContainText('a');
      // katex (inline + display)
      await expect(answer.locator('.katex').first()).toBeVisible();
      await expect(answer.locator('.katex-display').first()).toBeVisible();
      // F-R-3 (root cause): this IS the sanitized ChatMarkdown path. rehype-katex lays out every
      // equation via inline `style` on its struts/vlists (heights, sub/sup offsets); if
      // rehype-sanitize runs AFTER katex it strips all of them → struts collapse to 0 → ∑ and
      // sub/superscripts overflow and overlap. Assert katex's inline styles SURVIVE (0 = stripped
      // = RED). writing-math-mermaid could not catch this: WritingArticle never sanitizes.
      const styledKatex = await answer.locator('.katex-display [style]').count();
      expect(styledKatex, 'katex inline styles (strut/vlist layout) must survive sanitize')
        .toBeGreaterThan(0);
      // mermaid lazy svg
      await expect(answer.getByTestId('mermaid-svg').locator('svg').first())
        .toBeVisible({ timeout: 10_000 });
      // link
      await expect(answer.locator('a').first())
        .toHaveAttribute('href', 'https://example.com');

      await ctx.close();
    });

  // 一个模型迟早会写出编译不过的 mermaid —— 它是生成出来的文本，不是人校对过的源码。
  // 那时访客该看见的是**正文**（图只能是补充），而不是 mermaid 库的原始解析错误。
  //
  // 今天红在这里：`MermaidBlock.tsx` 编译失败时把库的报错原样印出来，还用的是
  // `text-red-600`（连调色板都不是）。这跟「错误必须对用户友好」是同一条规矩，
  // 只是这一处的用户是访客，而漏出去的是第三方库的内部消息。
  test('编译不过的图不以报错形态出现在访客面前，正文照常读得到', brokenDiagramStaysHidden);

  // 语料正文里到处是 `[[wikilink]]`（vault 就是这么写的），模型照着写出来，于是访客答案里
  // 出现一串方括号 slug：点不动、也不解释自己是什么（F-R-7，prod 上真见过）。
  // 判据不是「变成链接」—— public 场里那条笔记访客未必读得到，渲成链接等于造一个进不去的
  // 入口；判据是**访客面前不出现 vault 的书写语法**，而**代码块里必须原样保留**（那是源码，
  // 不是正文）。
  test('vault 的 [[wikilink]] 语法不出现在访客面前，代码块里原样保留', wikilinksStayOutOfProse);
});

async function brokenDiagramStaysHidden(
  { browser, request }: { browser: Browser; request: APIRequestContext },
): Promise<void> {
  const tag = await scriptMockReplyText(request, BROKEN_DIAGRAM_REPLY);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterCodeSession(page, CODE);
  await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
  const skip = page.getByTestId('visitor-name-skip');
  if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skip.click();
  }

  const input = page.locator('[data-testid="chat-input-field"]');
  await input.fill(`draw me something broken${tag}`);
  await input.press('Enter');

  const answer = page.locator('[data-testid="answer-body"]').first();
  await expect(answer).toBeVisible({ timeout: 20_000 });
  // 先断正文真的到了 —— 不然下面那条「看不到报错」在页面还空着时也算通过
  // （[[negated-assertion-passes-while-absent]]）。
  await expect(answer).toContainText('three stages', { timeout: 10_000 });

  // 好结果：这一格什么都不出现，而**不是**一段 mermaid 报错。
  await expect(
    answer.getByTestId('mermaid-error'),
    '访客不该看见 mermaid 库的原始解析错误',
  ).toHaveCount(0);
  await expect(
    answer,
    '也不该以任何形式漏出解析器的措辞',
  ).not.toContainText(/parse error|syntax error|expecting/i);

  // **判据必须是整页，不是那一格**（F-R-8）。上面两条只看 `answer` 里面 —— 而 mermaid
  // 解析失败时把自己的错误图贴在 `document.body` 上，正好在这个范围之外。真环境抓到的样子：
  // owner 公开页底部用 Newsreader 印着 `Syntax error in text` + `mermaid version 11.15.0`
  // （`sdk-embed/shots/se3-12`）。闸门查的范围比缺陷小，就只是看着在
  // （[[verifier-can-lie-about-its-own-coverage]]）。
  await expect(
    page.locator('body'),
    '库自己也不许往页面上画报错（mermaid 的 suppressErrorRendering）',
  ).not.toContainText(/syntax error in text|mermaid version/i);
  await ctx.close();
}

async function wikilinksStayOutOfProse(
  { browser, request }: { browser: Browser; request: APIRequestContext },
): Promise<void> {
  const tag = await scriptMockReplyText(request, WIKILINK_REPLY);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await enterCodeSession(page, CODE);
  await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
  const skip = page.getByTestId('visitor-name-skip');
  if (await skip.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await skip.click();
  }

  const input = page.locator('[data-testid="chat-input-field"]');
  await input.fill(`what is a weak seam${tag}`);
  await input.press('Enter');

  const answer = page.locator('[data-testid="answer-body"]').first();
  await expect(answer).toBeVisible({ timeout: 20_000 });
  // 正对照：正文真的到了，而且**名字还在**（判据是去掉语法，不是把内容删了）。
  await expect(answer).toContainText('pc-well-founded-recursion', { timeout: 10_000 });
  await expect(
    answer, '写了别名的那条，显示的应当是别名而不是路径',
  ).toContainText('the safe recursion theorem');

  // 断言收窄到**本 spec 自己塞的那两段**：mock provider 会把整份 system prompt 回显进
  // answer-body，而那里面本来就带方括号 —— 对整个 answer 断言「不含 [[」会红在回显上，
  // 红得不知所以然（[[red-in-the-wrong-place]]）。
  await expect(
    answer.locator('p', { hasText: 'pc-well-founded-recursion' }).first(),
    'vault 的书写语法不该出现在访客面前 —— 那串方括号点不动，也不解释自己是什么',
  ).not.toContainText('[[');
  await expect(
    answer.locator('p', { hasText: 'the safe recursion theorem' }).first(),
    '带别名的那种也一样',
  ).not.toContainText('[[');

  // 代码块里那是**源码**，不是正文：原样保留，否则就是产品在改访客看到的代码。
  await expect(
    answer.locator('pre code'),
    'inside a fence it is source, and source is quoted verbatim',
  ).toContainText('[[not-a-link]]');
  await ctx.close();
}

// WIKILINK_REPLY —— 语料正文里到处是这种写法，模型照着写出来。三种形态各一：裸的、
// 带别名的、以及**代码块里**那个（后者必须原样留着）。
const WIKILINK_REPLY = [
  'A weak seam is where coupling is low — that is what [[pc-well-founded-recursion]] is about.',
  '',
  'The tighter statement lives in [[cybernetics/engineering/safe-recursion-theorem|the safe recursion theorem]].',
  '',
  '```',
  'a fence keeps [[not-a-link]] exactly as written',
  '```',
].join('\n');

// BROKEN_DIAGRAM_REPLY —— 一段带**编译不过**的 mermaid 的回答。正文自己站得住
// （图是补充，不是唯一答案），所以图渲不出来时访客仍然读得到该读的东西。
const BROKEN_DIAGRAM_REPLY = [
  'The pipeline runs in three stages: fetch, curate, publish.',
  '',
  '```mermaid',
  'graph LR; A --> ; B[[',
  '```',
  '',
  'Each stage keeps its own receipts.',
].join('\n');
