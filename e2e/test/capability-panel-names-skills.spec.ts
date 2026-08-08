// capability-panel-names-skills.spec.ts —— 能力面板上每一行都得说出它是**什么**。
//
// owner 写的 skill,它的 capability id 是一个 UUID。面板渲的是 `row.id`,所以内建能力看着
// 没问题(它们的 id 本身就是 `mail.send` 这种人话),owner 的 skill 却渲成
// `8e8a1beb-6fab-4662-8674-bbae555d85cd`。旁边就是开关和一个 ✕ —— owner 要在一个认不出来的
// 名字上决定关掉它还是删掉它。同一个 skill 在 /admin/skills 上是有名字的,两个面对不上。
//
// 既有的 capability-panel-lists-all 走的是 HTTP(listCapabilities),**没开过浏览器**,所以
// 它对"这一行长什么样"一无所知 —— 同一个模式在 F-C-12 里已经出现过一次。这条只从 GUI 看。

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';
import { test, expect } from '@/fixtures/test';

const OWNER = {
  email: 'cap-names@example.com', password: 'correct-horse-battery-staple',
  handle: 'capnames', fullName: 'Cap Names Owner',
};

const SKILL = 'audit-namer';

// UUID_LABEL —— 一行的可见文字里出现一个裸 UUID = 这一行没有名字。
const UUID_LABEL = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('capabilities · every row says what it is', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'cap-names-seed');
    const sid = await initMCP(request, token);
    await callTool(request, token, sid, 'skill_create', {
      name: SKILL, description: 'names its own row', prompt: 'do the thing',
    });
    await request.dispose();
  });

  test('an owner skill shows its name, and no row wears a bare UUID', async ({ adminPage }) => {
    await gotoAdminSection(adminPage, 'connectors');
    const panel = adminPage.getByTestId('capabilities-panel');
    await expect(panel).toBeVisible();

    await expect(
      panel,
      'the owner skill must be identifiable by name — its toggle and its ✕ act on it',
    ).toContainText(SKILL);

    // 全类断言:任何一行都不许只剩一个 id。少了这一条,下一个没名字的 kind 会照样溜过去。
    const labels = await panel.locator('[data-testid^="capability-row-"]').allInnerTexts();
    expect(labels.length, 'the panel actually rendered rows').toBeGreaterThan(0);
    expect(
      labels.filter((text) => UUID_LABEL.test(text)),
      'no capability row may be labelled with a bare UUID',
    ).toHaveLength(0);
  });
});
