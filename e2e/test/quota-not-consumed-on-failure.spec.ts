// quota-not-consumed-on-failure.spec.ts —— 失败的 turn 不消耗配额。
//
// owner 要求:AI 没成功回复就不算消耗 turn;retry 几次都不算,成功回复一次
// 才 +1。#28 起 backend 拥有这一轮:/agent/turn 流末端只在 AI 答出内容时才把
// dialog sink 进 conversation 表(CountVisitorTurns 的计数源);失败轮 answer 空 →
// 不落 → 不消耗。前端 used 由本地 dialogs 派生(failed 那条不计),显示同步。
//
// 验法:同一 session 连发三次 —— 成功 / 注入故障 / 成功 —— gauge 的 used 数
// 应该是 1 → 1 → 2(中间那次失败免费)。故障用 mock gateway 的 next_error 注入
// (所有 /v1/messages 返 500),会触发 backend 重试 + force-final 都失败 → SSE
// error 帧 → 前端兜底文案,不消耗。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession } from '@/fixtures/navigate';
import { scriptMockReplyText, scriptMockError } from '@/fixtures/mock-llm-script';

const OWNER = {
  email: 'quota-fail-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'quotafailowner',
  fullName: 'Quota Fail Owner',
};

const CODE = 'QUOTA-FAIL-001';

test.describe('failed turn does not consume a turn', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('success → used 1; injected failure → still 1; success → 2',
    async ({ page, request }) => {
      // enterCodeSession 已 skip 名字选择器并等到 /sessions 200 —— 不二次 dismiss
      // (会采样到 picker unmount 窗口 → click 10s 超时,check-then-act race)。
      await enterCodeSession(page, CODE);

      const used = page.locator('.sm-session-strip-used');
      const input = page.getByTestId('chat-input-field');
      const answers = page.getByTestId('answer-body');
      await expect(used).toHaveText('0');

      // 1) 成功一轮 → used = 1
      await scriptMockReplyText(request, 'Here is a real, grounded answer.');
      await input.fill('first question');
      await input.press('Enter');
      await expect(answers).toHaveCount(1, { timeout: 20_000 });
      await expect(used).toHaveText('1');

      // 2) 注入故障一轮 → 仍然 used = 1(失败不消耗)。失败的 turn 也会渲一条
      //    answer-body(里头是友好错误文案),所以等到第 2 条出现 = 这轮收尾。
      await scriptMockError(request);
      await input.fill('this turn fails upstream');
      await input.press('Enter');
      await expect(answers).toHaveCount(2, { timeout: 20_000 });
      await expect(used).toHaveText('1');

      // 3) 再成功一轮 → used = 2(中间那次失败没被计进去)
      await scriptMockReplyText(request, 'Another real answer after the failure.');
      await input.fill('third question');
      await input.press('Enter');
      await expect(answers).toHaveCount(3, { timeout: 20_000 });
      await expect(used).toHaveText('2');
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'quota-fail-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'quota-fail owner intro.', title: 'Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Quota fail test', max_turns_per_session: 5,
  });
  await request.dispose();
}
