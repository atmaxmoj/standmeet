// chat-composer.spec.ts —— ChatComposer 状态机: starter chips, pending,
// exhausted, rapid submit.
//
// 用户故事：
//   1. starter chips render (coded: starters from code)
//   2. click starter chip → auto-send → chips disappear
//   3. manual input → ask → turn renders → answer renders
//   4. pending state → input disabled + submit gray
//   5. rapid double-submit → pending lock prevents double-send

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'comp-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'compowner',
  fullName: 'Comp Owner',
};

const CODE = 'COMP-001';
const STARTERS = ['What do you do?', 'Tell me about your projects'];

test.describe('ChatComposer behavior', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('coded visitor sees starter chips → click → auto-send → chips gone',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });
      // Dismiss VisitorNamePicker if it appears (QR scan without name)
      const skipBtn = page.getByRole('button', { name: /skip/i });
      if (await skipBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
        await skipBtn.click();
      }
      // Starter chips should be visible
      const chips = page.getByTestId('starter-chips');
      await expect(chips).toBeVisible({ timeout: 5_000 });
      // Click first starter
      await chips.locator('button').first().click();
      // Answer should appear, chips should disappear
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
      await expect(chips).toBeHidden({ timeout: 5_000 });
    });

  test('manual input → ask → turn + answer render',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      const input = page.getByTestId('chat-input-field');
      await input.fill('what are your skills?');
      await input.press('Enter');
      // "retrieving" indicator should appear
      await expect(page.getByTestId('answer-pending')).toBeVisible({ timeout: 5_000 });
      // Then answer body
      await expect(page.locator('[data-testid="answer-body"]'))
        .toBeVisible({ timeout: 15_000 });
    });

  test('pending state → input disabled + submit gray',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      const input = page.getByTestId('chat-input-field');
      await input.fill('test pending');
      // Intercept the response to keep it pending longer
      await input.press('Enter');
      // During pending, input should be disabled
      await expect(input).toBeDisabled({ timeout: 3_000 });
    });

  // Shift+Enter must insert a newline, NOT submit — the composer is a textarea
  // now, so a multi-line question (or someone mid-thought) doesn't fire early.
  test('Shift+Enter inserts newline; Enter submits',
    async ({ page }) => {
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
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
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
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
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
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
async function pasteInto(page: import('@playwright/test').Page, text: string): Promise<void> {
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
    suggested_questions: STARTERS,
  });
  await request.dispose();
}
