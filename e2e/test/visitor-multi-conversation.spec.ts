// visitor-multi-conversation.spec.ts —— 访客对话模型重定义。
//
// 旧模型:一个名字 = 一段续聊的会,所有 surface 共享同一 conversation_id。
// 新模型(这条 spec 钉住的目标):
//   - 一个 member(名字)可以拥有 **多段对话**:主页一段 + 每篇 doc 的浮窗各一段;
//   - 这些 transcript **彼此独立**,浮窗不再继承/克隆主聊天那段;
//   - 但 turn 配额是 **member 级**,所有对话共用一个预算一起烧。
//
// 「互通」(AI 能读到该 member 的全部对话)是 S3 的 eval/plumbing 测,不在这里。
//
// 现在跑必然红:实现还没拆「全 surface 共享一个 conversation」。这是 test-first
// 的目标态。

import { test, expect } from '@/fixtures/test';
import type { Playwright, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { publishEntry, seedPublicWiki, seedWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'multiconv-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'multiconv',
  fullName: 'Multi Conv Owner',
};

const SEP_CODE = 'MULTICONV-1';    // 无限 turn,验证「对话彼此独立」
const BUDGET_CODE = 'MULTIBUDGET-1'; // max_turns=2,验证「配额跨对话共享」

test.describe('visitor multi-conversation model', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('floating dock is a SEPARATE conversation from the main chat',
    async ({ page }) => {
      await enterCodeSession(page, SEP_CODE);
      await askMain(page, 'main page question');
      await expect(page.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });

      const panel = await openDock(page);
      // 浮窗那段对话是新的、独立的 —— 不继承主聊天的 transcript。
      await expect(panel.getByTestId('answer-body')).toHaveCount(0);

      await askDock(page, 'dock-only question');
      await expect(panel.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });

      // 回主页 → 主对话还在(1 条),且不含浮窗那条。
      await goto(page, '/');
      await expect(page.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });
    });

  test('互通 plumbing: the dock turn carries the main chat into its instruction',
    async ({ page }) => {
      await enterCodeSession(page, SEP_CODE);
      await askMain(page, 'please remember the codeword ZEBRA-PLUMBING-9137');
      await expect(page.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });

      const panel = await openDock(page);
      await askDock(page, 'what did I tell you earlier?');
      // mock gateway 把 system/instruction 原样回显([system:…])。后端的「互通」把该
      // member 的**主对话**注进了 dock turn 的 instruction,所以 dock 的答案(回显)里
      // 能看到主对话那句 codeword —— 确定性证明后端真注入了,不止 eval 判质量。
      await expect(panel.getByTestId('answer-body'))
        .toContainText('ZEBRA-PLUMBING-9137', { timeout: 15_000 });
    });

  test('turn budget is shared across the member\'s conversations',
    async ({ page }) => {
      await enterCodeSession(page, BUDGET_CODE); // 预算 2
      await askMain(page, 'budget turn 1');       // turn 1(主对话)
      await expect(page.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });

      const panel = await openDock(page);
      await askDock(page, 'budget turn 2');        // turn 2(浮窗这段 —— member 总数到 2)
      await expect(panel.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });
      // answer-body 在答案「开始流」就出现,但乐观 +1(incUsed)在这一轮**收尾**才落。
      // 等进度行消失 = 收尾完成 → used 到上限,再断锁 —— 不给 disable 任意墙钟窗口
      // (锁本该即时;若收尾后还没锁,那是真 bug 不是慢)。
      await expect(panel.getByTestId('chat-progress')).toHaveCount(0, { timeout: 15_000 });
      // 浮窗里烧到第 2 轮就把 member 预算(2)用尽 —— used 是 member 级共享值,当场锁。
      await expect(panel.getByTestId('floating-chat-input')).toBeDisabled();

      // 回主页:restore 落地(主对话那 1 轮重现,同一份 VisitorView 把 used 设成 2)
      // 后,主 composer 也被同一个共享 used 锁住 —— 跨 surface 一致。
      await goto(page, '/');
      await expect(page.getByTestId('answer-body')).toHaveCount(1, { timeout: 15_000 });
      await expect(page.getByTestId('chat-input-field')).toBeDisabled();
    });
});

async function askMain(page: Page, text: string): Promise<void> {
  const input = page.locator('[data-testid="chat-input-field"]');
  await input.fill(text);
  await input.press('Enter');
}

// openDock —— 在一篇真 doc 页(/wiki/projects/lucerna,带 docContext)上开浮窗。
// 浮窗按 doc 分流到自己那段对话只在真 doc 页发生;/writings 索引页没 docContext,
// 浮窗沿用主对话(那是预期,索引不是一篇文章)。
async function openDock(page: Page): Promise<ReturnType<Page['getByTestId']>> {
  await goto(page, '/wiki/projects/lucerna');
  await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('floating-dock-pill').click();
  const panel = page.getByTestId('floating-chat-panel');
  await expect(panel).toBeVisible({ timeout: 3_000 });
  return panel;
}

async function askDock(page: Page, text: string): Promise<void> {
  const input = page.getByTestId('floating-chat-input');
  await input.fill(text);
  await input.press('Enter');
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'multiconv-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, { body: 'owner intro.', title: 'Intro' });
  // 一篇 indexed wiki doc,让 /wiki/projects/lucerna landing 能渲(浮窗在它上面
  // 才有 docContext → 分流到自己那段对话)。
  const luc = await seedWiki(request, apiToken, sid, {
    body: 'lucerna is a local-first knowledge tool.',
    title: 'Lucerna', path: 'projects/lucerna',
  });
  await publishEntry(request, apiToken, sid, {
    genre: 'wiki', id: luc.wikiID, excerpt: 'a local-first knowledge tool',
  });
  await createCode(request, csrf, { code: SEP_CODE, label: 'Separation test' });
  await createCode(request, csrf, {
    code: BUDGET_CODE, label: 'Shared budget test', max_turns_per_session: 2,
  });
  await request.dispose();
}
