// booking-owner-notify.spec.ts —— #130: per-role「约成通知 owner」。owner 在 role 上
// 开关;开了的话,只要有访客在这张码下约成,owner 就**自动**收到一封 owner 视角的通知
// 邮件(不是访客选的 #122 确认信 —— 那是发给访客的)。AI 不参与,booking commit 后
// 后端确定性触发。没配 mail connector → 静默跳过(不报错、不挡 booking)。
//
// 真 e2e:浏览器约 → 后端 → owner SMTP(Mailpit)。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import {
  configureMailConnector, clearMailpit, waitForMailEnvelopeTo,
  countMailpitMessages, MAIL_FROM,
} from '@/fixtures/mail';
import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, OWNER, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { issueCodeWithSkills } from '@/fixtures/agent-skills-grant';
import { login } from '@/fixtures/admin';
import { scriptMockToolCall } from '@/fixtures/mock-llm-script';
import { goto } from '@/fixtures/navigate';

const TOPIC = 'Intro call about backend work';

test.describe('booking · per-role owner notification (#130)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
    await configureMailConnector(seed.request, OWNER.email, OWNER.password);
    // configureMailConnector 内部重新 login,会轮换 CSRF —— 刷新 seed.csrf,否则
    // 后面 issueCodeWithSkills 拿旧 token 会 403。
    seed.csrf = (await login(seed.request, OWNER.email, OWNER.password)).csrf;
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('role with notify on → owner gets an owner-perspective email when a visitor books',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'], notify_owner_on_booking: true,
      });
      const page = await enterAndBook(browser, code.code, 'Dana', 14);

      const mail = await waitForMailEnvelopeTo(seed.request, OWNER.email);
      expect(mail.from).toBe(MAIL_FROM);
      expect(mail.text).toContain(TOPIC);
      expect(mail.text).toContain('Dana'); // owner sees who booked
      await page.context().close();
    });

  test('role with notify off (default) → no owner email, booking still succeeds',
    async ({ browser }) => {
      await clearMailpit(seed.request);
      const code = await issueCodeWithSkills(seed.request, seed.csrf, {
        granted_skills: ['calendar.book'], // notify_owner_on_booking 默认 false
      });
      const page = await enterAndBook(browser, code.code, 'Eli', 15);

      // 约成卡照常(booking 成功),但 owner 不该收到通知。
      await expect(page.getByTestId('book-card-time')).toBeVisible();
      await new Promise((r) => setTimeout(r, 1_000));
      expect(await countMailpitMessages(seed.request)).toBe(0);
      await page.context().close();
    });
});

// enterAndBook —— ?code 入口 → 填名字 → script calendar_book → 触发 → 等 BookCard。
async function enterAndBook(
  browser: import('@playwright/test').Browser, code: string, name: string, hour: number,
): Promise<Page> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-name-submit').click();
  await session;

  await scriptMockToolCall(page.request, {
    name: 'calendar_book',
    args: { topic: TOPIC, duration_min: 30, preferred_times: [future(7, hour)] },
  });
  const input = page.getByTestId('chat-input-field');
  await input.fill('book me a 30-minute chat next week, please');
  await input.press('Enter');
  await expect(page.getByTestId('tool-card-calendar_book')).toBeVisible({ timeout: 20_000 });
  return page;
}

function future(days: number, hour: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
}
