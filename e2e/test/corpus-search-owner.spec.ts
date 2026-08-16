// corpus-search-owner.spec.ts —— owner 找得到自己语料里的一条（F-L-39 / F-L-41）。
//
// 之前 owner 这一侧只有两个读口：`corpus.list`（最新的一页，上限 200，**没有 offset**）
// 和 `corpus.get`（得先知道 id）；`/admin/wiki` 上只有标签 chip + 两列网格，**没有搜索框**。
// 于是「打开我那条 good-regulator-theorem」在两个面上都做不到 —— 而访客那一侧一直有搜索，
// 后端 `repo.*.Search` 的全文检索也一直在。缺的只是这一侧的接线。
//
// 两条断言分别钉住两个面：owner 的 AI 客户端（MCP）和他自己的后台（GUI）。
// **两个都要**：只钉一个，另一个可以长期空着而没人发现（[[test-covers-capability-not-face]]）。

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { seedWiki } from '@/fixtures/corpus';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'corpussearch@example.com', password: 'correct-horse-battery-staple',
  handle: 'corpussearch', fullName: 'Corpus Search Owner',
};

// NEEDLE —— 只出现在那一条笔记里的词。搜出别的东西 = 这条断言没在测搜索。
const NEEDLE = 'thermosiphon';
const TARGET = 'Thermosiphon Note';

let mcpToken = '';
let sid = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('owner 找得到自己语料里的一条', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'corpus-search-seed');
    sid = await initMCP(request, mcpToken);

    // 目标那条先建，再堆一批**更新的**笔记压在它上面 —— 列表是 newest-first，
    // 于是目标不在第一屏。搜索要能跨过这堆，找按内容而不是按新旧。
    await seedWiki(request, mcpToken, sid, {
      title: TARGET, body: `A note about the ${NEEDLE} loop and passive circulation.`,
    });
    for (let i = 0; i < 12; i++) {
      await seedWiki(request, mcpToken, sid, {
        title: `Filler Note ${i}`, body: `Unrelated filler body number ${i}.`,
      });
    }
    await request.dispose();
  });

  test('owner-MCP：corpus.search 按内容找得到它（corpus.list 只给最新的一页）',
    async ({ request }) => {
      const found = await callTool<{ id: string; title: string }[]>(
        request, mcpToken, sid, 'corpus.search', { genre: 'wiki', query: NEEDLE },
      );
      const titles = found.map((r) => r.title);
      expect(titles, `搜 "${NEEDLE}" 该命中那一条`).toContain(TARGET);
      expect(found.length, '只有那一条含这个词').toBe(1);
    });

  test('后台：搜索框按内容找得到它，并说清这次看的是整个语料',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'wiki');
      const box = adminPage.getByTestId('corpus-search-input');
      await expect(box, '后台得有一个按内容找的入口').toBeVisible({ timeout: 8_000 });

      await box.fill(NEEDLE);
      await expect(adminPage.getByTestId('wiki-list')).toContainText(TARGET, { timeout: 8_000 });
      // 状态那句话要区分「这一页」和「整个语料」—— 屏幕不说，owner 会把
      // 「这一页里没有」读成「我的语料里没有」。
      await expect(adminPage.getByTestId('corpus-search-state')).toContainText('whole corpus');
    });
});
