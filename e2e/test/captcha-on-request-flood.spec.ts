// captcha-on-request-flood.spec.ts —— F-G-4：那个「人一条条读的」收件箱前面得有一道闸。
//
// `POST /api/v1/access-requests` 是**不鉴权的写入**，唯一的保护是 `ratelimit.go` 里
// 30/min/IP，而 `PublicRateGuard` 明写 redis 故障 **fail-open**。prod 上实测：同一个 IP
// 连发 34 条，**前 30 条全部落库**。30/min 持续就是 4.3 万条/天，而 gate 上写的是
// *"Read by hand, not a queue."*
//
// 码兑换那条路早就有失败锁 + captcha 解锁（#169 / F-G-3）。**同一张门上的另一个写入口**
// 什么都没有 —— 这条守的就是那个缺口：连发到超过阈值 → 拒绝 → 出现人机校验 → 解开之后
// 那封留言仍然送得出去（不是把人永久挡在门外，是让脚本付不起代价）。
//
// 走 `make test-captcha`（Cloudflare 永远通过的测试密钥）。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import { claim } from '@/fixtures/admin';
import { findSetupToken, resetInstance } from '@/fixtures/instance';
import { configureMailConnector } from '@/fixtures/mail';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'request-flood@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'requestflood',
  fullName: 'Request Flood Owner',
};

// FLOOD —— 超过阈值所需的条数。阈值定在「一个真人 15 分钟内不会发这么多」的量级。
const FLOOD = 6;

test.describe('gate · the request-access door has a lock, and the captcha is its key', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    // 收留言的前提是这台实例**发得出码** —— `gate-client.tsx:38` 只在 `canDeliverCodes`
    // 时渲染那个面板。一个真的会收 note 的 owner 本来就配了邮件，所以这不是为测试造条件，
    // 是把前置条件补齐（第一版没配，于是红在「面板不存在」上，而那不是这条要守的东西）。
    await configureMailConnector(request, OWNER.email, OWNER.password);
    await request.dispose();
  });

  test('past the threshold the form demands a human check, and solving it still delivers the note',
    async ({ page }) => {
      await goto(page, '/gate');
      await expect(page.getByTestId('request-panel')).toBeVisible({ timeout: 10_000 });

      // 先证这条路本来是通的 —— 不然「后来被拦住」可能从第一条就拦住了，
      // 那测的是表单坏了，不是闸门在工作。
      await sendNote(page, 0);
      await expect(
        page.getByTestId('request-sent'),
        'the first note goes through — the gate is not simply broken',
      ).toBeVisible({ timeout: 10_000 });

      for (let i = 1; i < FLOOD; i++) {
        await goto(page, '/gate');
        await sendNote(page, i);
      }

      // 超过阈值：这一封被拦下，而且**给出那把钥匙**（不是只留一句拒绝）。
      await goto(page, '/gate');
      await sendNote(page, FLOOD);
      await expect(
        page.getByTestId('request-captcha'),
        'past the threshold the door must offer the human check, not just refuse — a refusal with '
          + 'no way through is how a real person gets locked out of asking',
      ).toBeVisible({ timeout: 15_000 });

      // 解开之后那封留言仍然送得出去。
      await expect(
        page.getByTestId('request-submit'),
        'while unsolved the submit stays blocked, so the sender knows what is missing',
      ).toBeDisabled({ timeout: 10_000 });
      await expect(
        page.getByTestId('request-submit'),
        'once the check issues its token the note goes through',
      ).toBeEnabled({ timeout: 30_000 });
      await page.getByTestId('request-submit').click();
      await expect(
        page.getByTestId('request-sent'),
        'a solved check delivers the note — the lock costs a script, not a person',
      ).toBeVisible({ timeout: 15_000 });
    });
});

// sendNote —— 像人一样：先点开「write a note ↘」那个折叠，再填四个字段并提交。
// 每次重新进 /gate 折叠都会收起来，所以每一封都要自己展开（表单不是默认摊开的）。
async function sendNote(page: Page, i: number): Promise<void> {
  const open = page.getByRole('button', { name: /write a note/i });
  if (await open.isVisible()) {
    await open.click();
  }
  const answered = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/api/v1/access-requests'),
    { timeout: 15_000 },
  );
  await page.getByTestId('request-name').fill(`Flood Probe ${i}`);
  await page.getByTestId('request-org').fill('audit');
  await page.getByTestId('request-email').fill(`flood-${i}@example.invalid`);
  // 正文要超过 WHY_MIN（15 字）表单才允许提交 —— 这条规则是产品的，照它写。
  await page.getByTestId('request-message')
    .fill(`note number ${i}: asking for a code to talk about the audit`);
  await page.getByTestId('request-submit').click();
  await answered;
}
