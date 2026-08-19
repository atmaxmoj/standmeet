// sdk-embed-renders.spec.ts —— F-O-6 / F-O-5。**发出去给别人嵌的那个组件**自己那一面：
// 答案渲成排版，输入框永远收得下访客的字。
//
// 驱的是**构建产物**（`sdk/packages/embed/dist/embed.global.js`，`make app-build` 前必跑
// `sdk-build`），不是源码里的类 —— 别人放进自己站点的就是这个文件（[[test-covers-capability-not-face]]）。
//
// 跨域那一维不在这条守卫里：它要第二个 origin，由手工台子驱（trajectory/sdk-embed）。这里守的
// 两件事都跟 origin 无关。
//
// RED（修复前）：
//   · 用例 1 —— `applyEventToBlock` 用 `textContent +=` 累加，`**粗**` 原样印，没有 <strong>。
//   · 用例 2 —— 输入框在 in-flight 期间 disabled（我上一版的修法），第二问打不进去。
//     再往前一版是照发不误 → 被会话单飞闸 429 拒 → 屏幕上只有一句「没发出去，再试一次」。

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockReplyText } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'embed-renders@example.com',
  password: 'the-widget-is-the-product-1',
  handle: 'embedowner',
  fullName: 'Embed Owner',
};
const CODE = 'EMBEDR-01';
const EMBED_DIST = join(
  __dirname, '..', '..', 'sdk', 'packages', 'embed', 'dist', 'embed.global.js',
);

test.beforeAll(async ({ playwright }) => {
  await initOwner(playwright);
});

test.describe('F-O-6 / F-O-5 · 交付出去的那个 widget', () => {
  test('答案渲成排版，不是把 markdown 原样印给访客', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    const tag = await scriptMockReplyText(
      req, 'The owner is **Sijie Wang**, *really*, and the file is `client.ts`.');
    await req.dispose();

    await mountWidget(page);
    await ask(page, `who owns this${tag}`);

    const answer = page.locator('standmeet-chat [data-role="assistant"]').last();
    await expect(answer, '答案到了').toContainText('Sijie Wang', { timeout: 25_000 });
    // **断言收窄到我们这句话所在的那一段**：替身会把 system prompt 回显进答案，
    // 里面本来就有粗体的能力名（`ask_visitor` 等）—— 拿整块去 `toHaveText` 会撞上它们，
    // 那是替身的噪声，不是产品的行为。
    const para = answer.locator('.para').filter({ hasText: 'Sijie Wang' });
    await expect(para.locator('strong'), '粗体渲成 <strong>').toHaveText('Sijie Wang');
    await expect(para.locator('em'), '斜体渲成 <em>').toHaveText('really');
    await expect(para.locator('code'), '行内代码渲成 <code>').toHaveText('client.ts');
    // 判负的那一半：星号和反引号**不许**留在屏幕上（红态就是它们出现）。
    // 单星号也算 —— 粗体先匹配、斜体后匹配那个顺序要是写反了，`**` 会被拆成两半，
    // 屏幕上就会留下星号（[[lookahead-rule-eats-the-neighbour]]）。
    await expect(para, 'markdown 标记不落到访客眼前').not.toContainText('*');
  });

  test('上一轮还在答的时候，第二问收得下、排得上、答得出', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    const first = await scriptMockReplyText(req, 'First answer here.', { delayMs: 6_000 });
    const second = await scriptMockReplyText(req, 'Second answer here.');
    await req.dispose();

    await mountWidget(page);
    const box = page.locator('standmeet-chat textarea');
    await ask(page, `first question${first}`);

    // 上一轮还在流 —— 输入框必须仍然收字（红：disabled，打进去的字全丢）。
    await expect(box, 'in-flight 期间输入框可编辑').toBeEditable({ timeout: 3_000 });
    await ask(page, `second question${second}`);

    // 两问都上屏（排队的那句当场就该看得见），两答都到。
    await expect(page.locator('standmeet-chat [data-role="visitor"]'))
      .toHaveCount(2, { timeout: 5_000 });
    await expect(page.locator('standmeet-chat [data-role="assistant"]').last())
      .toContainText('Second answer here', { timeout: 40_000 });
  });
});

// mountWidget —— 把构建产物注进一张同源页面并挂上组件。用 evaluate 只是**搭台子**
// （别人的站点里这一步是一行 <standmeet-chat>），判据一律走 locator 读屏幕。
async function mountWidget(page: Page): Promise<void> {
  const base = process.env['BASE_URL'] ?? 'http://localhost:38127';
  await goto(page, '/gate');
  await page.addScriptTag({ content: readFileSync(EMBED_DIST, 'utf8') });
  await page.evaluate(([b, c]) => {
    const el = document.createElement('standmeet-chat');
    el.setAttribute('base-url', b ?? '');
    el.setAttribute('mode', 'code');
    el.setAttribute('code', c ?? '');
    document.body.append(el);
  }, [base, CODE]);
  await expect(page.locator('standmeet-chat textarea')).toBeVisible({ timeout: 10_000 });
}

async function ask(page: Page, text: string): Promise<void> {
  const box = page.locator('standmeet-chat textarea');
  await box.fill(text);
  await box.press('Enter');
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request: APIRequestContext = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'embed-renders-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'the widget is the product.', title: 'Widget',
  });
  await createCode(request, csrf, { code: CODE, label: 'embed' });
  await request.dispose();
}
