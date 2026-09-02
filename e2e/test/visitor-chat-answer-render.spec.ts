// visitor-chat-answer-render.spec.ts -- G-X: the mock provider streams a reply
// containing markdown / katex / mermaid -> the real visitor chat path
// (PageShell -> ConversationDeck -> AnswerParas -> ChatMarkdown) renders it correctly.
//
// The earlier chat-render-* / document-render series all went through the wiki
// landing page or a since-deleted /dev/chat-render fixture path; nobody had ever
// verified "an agent's plain-text reply carries markdown" (which goes through
// splitParas, breaking the body into multiple paragraphs, each rendered separately by
// ChatMarkdown). This spec sets the mock reply to one body containing 5 markdown
// features, and verifies each one renders correctly in the answer area.
//
// The next_reply scripting endpoint is a symmetric extension of next_tool (the same
// keyword-KV setup, isolated by a keyword embedded in the message), not a new
// test-only endpoint -- the mock provider's whole codepath is already an env-gated
// dev/test path.

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

// MARKDOWN_REPLY -- one mock reply body carrying 5 major features. Note each block
// must be separated by `\n\n`, because useChat.splitParas splits by paragraph
// (mermaid-fenced and math-display each get their own paragraph, so they never span
// across one).
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
      // Scripts the mock reply to stream out on the next /inference/stream call
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

      // The answer appears
      const answer = page.locator('[data-testid="answer-body"]').first();
      await expect(answer).toBeVisible({ timeout: 20_000 });

      // Each markdown feature renders correctly. The mock provider echoes the full
      // [system:...] system prompt (capability fragments) before the reply, and that
      // also contains <strong>/<em>/<code> nodes once rendered as markdown; the
      // assertions use hasText to exact-match tokens this spec itself planted (bold /
      // italic / "inline code").
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

  // Sooner or later a model writes mermaid that fails to compile -- it's generated
  // text, not source a human has proofread. When that happens, what the visitor
  // should see is **the prose** (the diagram can only ever be supplementary), not the
  // mermaid library's raw parse error.
  //
  // What's red today: when compilation fails, `MermaidBlock.tsx` prints the library's
  // error verbatim, in `text-red-600` no less (not even from the palette). This is the
  // same rule as "errors must be user-friendly" -- just that the user here is a
  // visitor, and what's leaking is a third-party library's internal message.
  test('编译不过的图不以报错形态出现在访客面前，正文照常读得到', brokenDiagramStaysHidden);

  // The corpus body is full of `[[wikilink]]` (that's just how the vault writes it),
  // the model copies the style, and a bracket-wrapped slug shows up in the visitor's
  // answer: unclickable, and never explaining what it is (F-R-7, actually seen in prod).
  // The criterion isn't "turn it into a link" -- in a public setting the visitor may
  // not even be able to read the target note, so rendering it as a link would just
  // build an entrance nobody can walk through; the criterion is that **the vault's
  // writing syntax must never appear in front of a visitor**, while **inside a code
  // fence it must be preserved verbatim** (that's source, not prose).
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
  // First assert the prose actually arrived -- otherwise the "no error visible" check
  // below would also pass while the page is still empty
  // ([[negated-assertion-passes-while-absent]]).
  await expect(answer).toContainText('three stages', { timeout: 10_000 });

  // The good outcome: this slot shows nothing at all, and **not** a mermaid error.
  await expect(
    answer.getByTestId('mermaid-error'),
    '访客不该看见 mermaid 库的原始解析错误',
  ).toHaveCount(0);
  await expect(
    answer,
    '也不该以任何形式漏出解析器的措辞',
  ).not.toContainText(/parse error|syntax error|expecting/i);

  // **The criterion must cover the whole page, not just that one slot** (F-R-8). The
  // two checks above only look inside `answer` -- while mermaid, on a parse failure,
  // pastes its own error diagram onto `document.body`, right outside that scope. What
  // was actually caught in a real environment: the owner's public page footer, in
  // Newsreader, printed `Syntax error in text` + `mermaid version 11.15.0`
  // (`sdk-embed/shots/se3-12`). A gate whose coverage is narrower than the defect just
  // looks like it's watching ([[verifier-can-lie-about-its-own-coverage]]).
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
  // Positive control: the prose really arrived, and **the name is still there**
  // (the criterion is stripping syntax, not deleting content).
  await expect(answer).toContainText('pc-well-founded-recursion', { timeout: 10_000 });
  await expect(
    answer, '写了别名的那条，显示的应当是别名而不是路径',
  ).toContainText('the safe recursion theorem');

  // Narrow the assertion down to **the two paragraphs this spec itself planted**: the
  // mock provider echoes the full system prompt into answer-body, and that already
  // contains brackets -- asserting "no [[" against the whole answer would go red on
  // the echo instead, red for a reason nobody could trace
  // ([[red-in-the-wrong-place]]).
  await expect(
    answer.locator('p', { hasText: 'pc-well-founded-recursion' }).first(),
    'vault 的书写语法不该出现在访客面前 —— 那串方括号点不动，也不解释自己是什么',
  ).not.toContainText('[[');
  await expect(
    answer.locator('p', { hasText: 'the safe recursion theorem' }).first(),
    '带别名的那种也一样',
  ).not.toContainText('[[');

  // Inside a code fence that's **source**, not prose: preserve it verbatim, or the
  // product is rewriting code in front of a visitor.
  await expect(
    answer.locator('pre code'),
    'inside a fence it is source, and source is quoted verbatim',
  ).toContainText('[[not-a-link]]');
  await ctx.close();
}

// WIKILINK_REPLY -- the corpus body is full of this style, and the model copies it.
// One of each of the three forms: bare, aliased, and the one **inside a code fence**
// (which must stay untouched).
const WIKILINK_REPLY = [
  'A weak seam is where coupling is low — that is what [[pc-well-founded-recursion]] is about.',
  '',
  'The tighter statement lives in [[cybernetics/engineering/safe-recursion-theorem|the safe recursion theorem]].',
  '',
  '```',
  'a fence keeps [[not-a-link]] exactly as written',
  '```',
].join('\n');

// BROKEN_DIAGRAM_REPLY -- an answer whose mermaid **fails to compile**. The prose
// stands on its own (the diagram is supplementary, not the only answer), so when the
// diagram fails to render, the visitor can still read what they need to.
const BROKEN_DIAGRAM_REPLY = [
  'The pipeline runs in three stages: fetch, curate, publish.',
  '',
  '```mermaid',
  'graph LR; A --> ; B[[',
  '```',
  '',
  'Each stage keeps its own receipts.',
].join('\n');
