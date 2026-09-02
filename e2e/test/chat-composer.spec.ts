// chat-composer.spec.ts — ChatComposer state machine: starter chips, pending,
// exhausted, rapid submit.
//
// User story:
//   1. starter chips render (coded: starters from code)
//   2. click starter chip → auto-send → chips disappear
//   3. manual input → ask → turn renders → answer renders
//   4. pending state → input disabled + submit gray
//   5. rapid double-submit → pending lock prevents double-send

import { test, expect } from '@/fixtures/test';
import type { Playwright, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';

const OWNER = {
  email: 'comp-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'compowner',
  fullName: 'Comp Owner',
};

const CODE = 'COMP-001';
// The second code **deliberately carries no** suggested questions: the TRY row of
// chips only appears when there is no ghost, and a code with suggestions has a ghost
// from the first turn — testing both entry points on the same code would only ever
// exercise one of them.
const PLAIN_CODE = 'COMP-002';
const STARTERS = ['What do you do?', 'Tell me about your projects'];

test.describe('ChatComposer behavior', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  // A code that **carries no** suggested questions → no ghost on the first turn → the
  // TRY row of chips is the only entry point, and a single click sends immediately.
  test('a code with no suggestions: starter chips → click → auto-send → chips gone',
    async ({ page }) => {
      await enterCodeSession(page, PLAIN_CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      const chips = page.getByTestId('starter-chips');
      await expect(chips).toBeVisible({ timeout: 5_000 });
      await chips.locator('button').first().click();
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
      await expect(chips).toBeHidden({ timeout: 5_000 });
    });

  // A code that **carries** suggested questions → a ghost exists from the first turn
  // → the two sets of suggestions never share a screen (UX-35), and the chips are
  // hidden. The last line of the welcome copy has to change its wording to match: it
  // used to unconditionally say "Starters below", pointing at a place that no longer
  // exists here, while the real suggestion is sitting in the input box, with nobody
  // saying it can be picked up with Tab (UX-34).
  test('a code with suggestions: the ghost replaces the chips, and the copy says so',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      await expect(
        page.getByTestId('chat-ghost-text'), '码带了建议问题,首轮就该有 ghost',
      ).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('starter-chips')).toHaveCount(0);
      const wayIn = (await page.getByTestId('welcome-way-in').innerText()).toLowerCase();
      expect(wayIn, `屏幕上没有 starters,欢迎语却说 "${wayIn}"`).not.toContain('starters below');
      expect(wayIn, '真正的入口是输入框里那条 ghost —— 得说出怎么拿走它').toContain('tab');
    });

  test('manual input → ask → turn + answer render',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      const input = page.getByTestId('chat-input-field');
      await input.fill('what are your skills?');
      await input.press('Enter');
      // "retrieving" indicator should appear
      await expect(page.getByTestId('answer-pending')).toBeVisible({ timeout: 5_000 });
      // Then answer body
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
    });

  // ⚠️ This case used to be called `pending state → input disabled + submit gray`,
  // which asserted **the defect itself** (F-A-42): graying out the input box while a
  // turn is in flight. Measured in the real environment, that "just a moment" is
  // 10–26 seconds, while the box looks fully ready — every character the visitor types
  // during that window is simply dropped.
  //
  // When the criterion and the guard conflict, the criterion wins and the guard
  // changes to match: global rule 10 says **accept the request and queue it, don't
  // grey it out**. Graying out is reserved for `session full` (a terminal state, with
  // an explanatory placeholder), and that branch is guarded by
  // `visitor-multi-conversation.spec.ts`.
  test('一轮在飞的时候，输入框照旧收得下访客的字（不置灰）',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      const input = page.getByTestId('chat-input-field');
      await input.fill('test pending');
      await input.press('Enter');
      await expect(input, '上一轮还在答 —— 框仍然可编辑').toBeEditable({ timeout: 3_000 });
      await input.fill('and the next thing I thought of');
      await expect(input, '打进去的字留在框里，不是被吃掉')
        .toHaveValue('and the next thing I thought of');
    });
});

// Second group: textarea / long-paste behavior (split out to satisfy
// max-lines-per-function).
test.describe('ChatComposer textarea + paste', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  // Shift+Enter must insert a newline, NOT submit — the composer is a textarea
  // now, so a multi-line question (or someone mid-thought) doesn't fire early.
  test('Shift+Enter inserts newline; Enter submits',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      const input = page.getByTestId('chat-input-field');
      await expect(input).toHaveJSProperty('tagName', 'TEXTAREA');
      await input.click();
      await input.pressSequentially('line one');
      await input.press('Shift+Enter');
      await input.pressSequentially('line two');
      // No turn fired; both lines are still sitting in the box.
      await expect(input).toHaveValue('line one\nline two');
      await expect(page.getByTestId('answer-pending')).toBeHidden();
    });

  // Long paste folds into an attachment chip instead of flooding the box; the
  // full text is still sent, surfacing in the transcript as a collapsed block.
  test('long paste → attachment chip → sent + preserved in transcript',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      const input = page.getByTestId('chat-input-field');
      await input.click();
      const longText = `Senior Go Engineer\n${'We need someone with deep distributed-systems experience. '.repeat(12)}`;
      await pasteInto(page, longText);
      // Chip appears; the box itself stays empty (not flooded).
      await expect(page.getByTestId('composer-attachment')).toBeVisible({ timeout: 3_000 });
      await expect(input).toHaveValue('');
      // Type the actual question, then send.
      await input.pressSequentially('What do you think of this role?');
      await input.press('Enter');
      // Transcript shows the question text AND a collapsed pasted block holding
      // the full content.
      const pasted = page.getByTestId('pasted-block');
      await expect(pasted).toBeVisible({ timeout: 5_000 });
      await pasted.locator('summary').click();
      await expect(pasted).toContainText('deep distributed-systems experience');
      // And the turn actually answers.
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 20_000 });
    });

  // The chip is removable before sending — paste was a mistake, take it back.
  test('attachment chip is removable before send',
    async ({ page }) => {
      await enterCodeSession(page, CODE);
      await page.getByTestId('chat-input-field').click();
      await pasteInto(page, 'x'.repeat(400));
      const chip = page.getByTestId('composer-attachment');
      await expect(chip).toBeVisible({ timeout: 3_000 });
      await chip.getByRole('button', { name: /remove attachment/i }).click();
      await expect(chip).toBeHidden();
    });
});

// pasteInto —— dispatch a real `paste` ClipboardEvent carrying text, so React's
// onPaste (the long-paste→attachment path) fires. Playwright's fill() bypasses
// paste, so we synthesize the event on the focused textarea.
async function pasteInto(page: Page, text: string): Promise<void> {
  await page.getByTestId('chat-input-field').evaluate((el, t) => {
    const dt = new DataTransfer();
    dt.setData('text', t);
    el.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: dt, bubbles: true, cancelable: true,
    }));
  }, text);
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'comp-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'comp owner intro.', title: 'Comp Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Composer test',
    ghosts: STARTERS,
  });
  await createCode(request, csrf, { code: PLAIN_CODE, label: 'Composer plain' });
  await request.dispose();
}
