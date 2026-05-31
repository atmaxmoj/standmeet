// agent-pi-loop-real-backend.spec.ts —— browser pi-agent-core 跑全套真
// browser adapters (httpPromptSource / httpInferenceStreamer /
// httpToolDispatcher / zustandCapabilityStateSource) 打通整条链路。
//
// 跟 agent-spike / agent-multi-iter / agent-resync 的 scripted 版本不同：
// 这里不走 scripted；prompts / LLM stream / tool exec 全部是真后端 RTT。
// mock provider 在 backend 上跑 (env=mock)，按 messages 历史决定下一步。
//
// 验证：visitor 入 /dev/agent-real → POST /sessions 颁发 + seed cap →
// useAgent 跑两轮 (corpus_search → corpus_read) → 第三轮 mock 流文本 →
// UI 显示 throbber sequence + final assistant text。

import { test, expect } from '@/fixtures/test';
import { goto } from '@/fixtures/navigate';
import { claim, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { createRole } from '@/fixtures/roles';
import type { Playwright } from '@playwright/test';

const OWNER = {
  email: 'pi-real@example.com', password: 'correct-horse-battery-staple',
  handle: 'pi-real', fullName: 'PI Real Owner',
};
const CODE = 'REAL-001';

async function setupRealOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const role = await createRole(request, csrf, {
    name: 'pi-real-role', description: 'role for pi real spec',
    corpus_uris: ['wiki://**', 'output://**'],
  });
  await createCode(request, csrf, {
    code: CODE, label: 'real', assumed_role_id: role.id,
  });
  await request.dispose();
}

test.describe('agent pi loop · real backend adapters end-to-end', () => {
  test.beforeAll(async ({ playwright }) => {
    await setupRealOwner(playwright);
  });

  test('full pi loop: session issue → seed cap store → /inference/stream tool_call → /tools/{name} exec → next iter text',
    async ({ page }) => {
      await goto(page, '/dev/agent-real#' + CODE);
      // 等 session 颁发完，send button 渲出来
      await page.getByTestId('real-send').waitFor({ state: 'visible' });
      await page.getByTestId('real-send').click();

      // 第 1 轮 mock emit corpus_search tool_call → browser dispatch
      // → throbber 'corpus_search' 出现 (证明 /inference/stream + /tools 链路打通)
      await expect(page.getByTestId('real-throbber-0')).toHaveText('corpus_search', {
        timeout: 15_000,
      });

      // 最终 mock 流出文本 reply (INFERENCE_MOCK_REPLY)，证明 multi-iter
      // 走完到 done(end_turn)。corpus 没 seed 数据所以第 2 轮 mock 直接走
      // text reply，不调 corpus_read —— 这条 spec 主要验链路打通，
      // 多 hop scenario 在 agent-multi-iter (scripted) 已覆盖。
      const finalText = page.getByTestId('real-final-text');
      await expect(finalText).toContainText('mock provider', { timeout: 15_000 });
    });
});
