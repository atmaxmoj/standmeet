// sdk-embed-renders.spec.ts —— F-O-6 / F-O-5. The side of **the widget shipped for other
// people to embed** itself: answers render as formatted markup, and the input box always
// keeps accepting the visitor's typing.
//
// Drives against the **build artifact** (`sdk/packages/embed/dist/embed.global.js`,
// `sdk-build` must run before `make app-build`), not a class in source — that file is
// exactly what other people drop into their own site ([[test-covers-capability-not-face]]).
//
// The cross-origin dimension is not covered by this guard: it needs a second origin, and is
// driven manually (trajectory/sdk-embed). The two things guarded here are both origin-agnostic.
//
// RED (before the fix):
//   - test case 1 — `applyEventToBlock` accumulates with `textContent +=`, so `**bold**`
//     prints literally, no <strong> ever appears.
//   - test case 2 — the input box was disabled while in-flight (my previous fix for this),
//     so a second question couldn't even be typed. The version before that just sent it
//     anyway → got rejected 429 by the per-session single-flight gate → all the screen
//     showed was "didn't send, try again."

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { scriptMockError, scriptMockReplyText } from '@/fixtures/mock-llm-script';
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
    // **Narrow the assertion to just the paragraph our sentence is in**: the mock echoes the
    // system prompt back into the answer, and it already contains bold capability names
    // (`ask_visitor` etc.) — taking `toHaveText` on the whole block would collide with those,
    // which is mock noise, not product behavior.
    const para = answer.locator('.para').filter({ hasText: 'Sijie Wang' });
    await expect(para.locator('strong'), '粗体渲成 <strong>').toHaveText('Sijie Wang');
    await expect(para.locator('em'), '斜体渲成 <em>').toHaveText('really');
    await expect(para.locator('code'), '行内代码渲成 <code>').toHaveText('client.ts');
    // The falsifiable half: asterisks and backticks must **never** stay on screen (the RED
    // state is exactly them showing up). A single leftover asterisk counts too — if the
    // match order of bold-first-then-italic got reversed, `**` would get split in half and
    // an asterisk would be left on screen ([[lookahead-rule-eats-the-neighbour]]).
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

    // The previous turn is still streaming — the input box must still accept typing (RED:
    // disabled, everything typed is lost).
    await expect(box, 'in-flight 期间输入框可编辑').toBeEditable({ timeout: 3_000 });
    await ask(page, `second question${second}`);

    // Both questions land on screen (the queued one should be visible right away), and both
    // answers arrive.
    await expect(page.locator('standmeet-chat [data-role="visitor"]'))
      .toHaveCount(2, { timeout: 5_000 });
    await expect(page.locator('standmeet-chat [data-role="assistant"]').last())
      .toContainText('Second answer here', { timeout: 40_000 });
  });

  // F-O-9: **an error arriving in the stream must also speak plain language.**
  //
  // The `catch` path was already fixed (`turnFailureText`, from the F-O-5 pass), but the
  // line in `applyEventToBlock` handling `kind === 'error'` still reads
  // `error: ${ev.message}` — twelve lines apart in the same file, one capability with two
  // faces, only one face got fixed. And this path isn't dead code: a dead provider / quota
  // exceeded / inference failure all make the backend send `event: error`, which the client
  // parses into `{kind, code, message}` (`core/src/client.ts:294`). At that moment, **on
  // someone else's website**, a string like `error: upstream provider returned 503` shows up.
  //
  // The mock returns 500 → the backend folds it into an error event and sends it down —
  // exactly this path.
  test('provider 出错时，访客读到的是人话，不是流里那串技术文本', async ({ page, playwright }) => {
    const req = await playwright.request.newContext();
    const tag = await scriptMockError(req);
    await req.dispose();

    await mountWidget(page);
    await ask(page, `this turn will fail${tag}`);

    const answer = page.locator('standmeet-chat [data-role="assistant"]').last();
    // Wait for text to actually land in this slot first — otherwise "doesn't contain
    // error:" would already be true while it's still empty
    // ([[negated-assertion-passes-while-absent]]).
    await expect(answer, '失败也得给访客一句话').not.toBeEmpty({ timeout: 40_000 });
    const shown = (await answer.textContent() ?? '').trim();
    expect(shown, `屏幕上不许出现原始错误串，实际是「${shown}」`).not.toMatch(/^error:/i);
    expect(shown.length, '而且要是一句给人读的话，不是空壳').toBeGreaterThan(10);
  });
});

// mountWidget — injects the build artifact into a same-origin page and mounts the
// component. Using evaluate here is only **rigging the stage** (on someone else's site this
// step is a single `<standmeet-chat>` line) — every assertion still reads the screen through
// a locator.
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
