// visitor-timezone-to-agent.spec.ts —— #120: 访客的浏览器时区随每一轮 /agent/turn
// 上送,后端把它锚进通用 instruction,让 agent 解释访客给的时间(尤其 booking)不再
// 含糊、不用反问"你在哪个时区"。
//
// 这条 e2e 守的是**管道**:浏览器设定一个已知时区(timezoneId),发一轮 chat,断言
// 出站的 /agent/turn 请求体确实带了 visitor_timezone = 那个时区。agent 对它的**运用**
// (按访客时区换算 booking 时间)是 LLM 行为,归 eval-harness(真 DeepSeek),不在这里。

import { test, expect } from '@/fixtures/test';
import type { Page } from '@playwright/test';

import {
  seedCodeVisitorOnConnectedOwner, teardownSeed, type CodedSeed,
} from '@/fixtures/gcal-setup';
import { goto } from '@/fixtures/navigate';

const TZ = 'Asia/Tokyo';

test.describe('visitor · browser timezone reaches the agent turn (#120)', () => {
  let seed: CodedSeed;
  test.beforeAll(async ({ playwright }) => {
    seed = await seedCodeVisitorOnConnectedOwner(playwright, {
      granted_skills: ['calendar.book'],
    });
  });
  test.afterAll(async () => { await teardownSeed(seed); });

  test('the agent/turn request body carries the visitor browser timezone', async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: TZ });
    const page = await ctx.newPage();
    await enterCode(page, seed.code.code, 'Tomoko');

    const turnReq = page.waitForRequest(
      (r) => r.url().endsWith('/api/v1/agent/turn') && r.method() === 'POST',
      { timeout: 20_000 },
    );
    const input = page.getByTestId('chat-input-field');
    await input.fill('what can you tell me about the owner?');
    await input.press('Enter');

    const body = (await turnReq).postDataJSON() as { visitor_timezone?: string };
    expect(body.visitor_timezone).toBe(TZ);
    await ctx.close();
  });
});

// enterCode —— ?code 入口 → 名字选择器填名字 → 提交 → 等 session 落地。
async function enterCode(page: Page, code: string, name: string): Promise<void> {
  await goto(page, `/?code=${code}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill(name);
  await page.getByTestId('visitor-name-submit').click();
  await session;
}
