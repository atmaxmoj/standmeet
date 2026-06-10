// conversation-toolcalls-survive-reload.spec.ts —— tool 调用是 conversation 的
// 一部分,刷新后该还在(owner 回看 / visitor 续看都要看见 AI search 了啥)。
//
// #28 起 backend 拥有这一轮:/agent/turn 流末端自己把 tool_calls sink 进
// messages.tool_calls(落在 `done` 帧之前 → 答案可见即已提交)。这条守:答复
// 用过 tool → 刷新 → 聚合从后端 tool_calls 重建 → SEARCHED 卡仍在。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { enterCodeSession } from '@/fixtures/navigate';
import { seedWiki } from '@/fixtures/corpus';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'alice@example.com', password: 'correct-horse-battery-staple',
  handle: 'alice', fullName: 'Alice Anderson',
};

const CODE = 'TOOLCALL-RELOAD-001';
const NAME = 'Tara';

test.describe('tool 调用属于会话,刷新后仍在', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    await seedCorpus(request);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    await createCode(request, csrf, {
      code: CODE, label: 'intro', max_turns_per_session: 50, max_members: 10,
    });
    await request.dispose();
  });

  test('答复用过 corpus_search → reload → SEARCHED 卡仍在', async ({ page }) => {
    await enterCodeSession(page, CODE, NAME);

    const input = page.getByTestId('chat-input-field');
    await input.fill('tell me about lucerna');
    await input.press('Enter');

    // live:search 卡出现。answer-body 渲出 = 收到 `done` 帧 = backend 已把这轮
    // (含 tool_calls)sink 进 DB(persist 在 done 之前),此后 reload 必见。
    const searchCard = page.getByTestId('tool-card-corpus_search');
    await expect(searchCard).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('answer-body')).toBeVisible({ timeout: 20_000 });

    // reload → 聚合重建 transcript,tool 卡必须从后端 tool_calls 恢复,不能丢。
    await page.reload();
    await expect(page.getByText('tell me about lucerna')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('tool-card-corpus_search')).toBeVisible({ timeout: 15_000 });
  });
});

async function seedCorpus(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'toolcall-reload-seed');
  const sid = await initMCP(request, token);
  await seedWiki(request, token, sid, {
    body: 'lucerna is a local-first knowledge tool I built.',
    title: 'Lucerna', path: 'projects/lucerna',
  });
  await seedWiki(request, token, sid, {
    body: 'engineer in toronto, building tools for thought.',
    title: 'About me', path: 'intro/about-me',
  });
}
