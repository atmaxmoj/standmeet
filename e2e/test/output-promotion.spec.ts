// output-promotion.spec.ts —— raw → wiki → output 完整三层 promote 链。
//
// 用户故事：
//   owner 在 AI 客户端 raw_dump 一条想法 → 决定它够好让它进 wiki
//   (promote_to_wiki) → 进一步打磨到 "可以原样在对话里引用" 的成品 → 调
//   promote_wiki_to_output。打开 /admin/output 看到这条精炼版。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'alice@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'alice',
  fullName: 'Alice Anderson',
};

const RAW_BODY = 'Initial sketch: microservices = Amazon org chart in YAML.';
const WIKI_TITLE = 'Microservices and org structure';
const OUTPUT_TITLE = 'Why microservices are Conway\'s Law in disguise';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('raw → wiki → output three-tier promote chain', () => {
  let outputTitle: string;

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    outputTitle = await aiBuildsThroughThreeTiers(request);
    await request.dispose();
  });

  test('admin /admin/output lists the polished entry promoted from wiki',
    async ({ adminPage: page }) => {
      await openOutput(page);
      // 限定在列表里断言（同 corpus-curation）：侧栏 corpus-constellation 也显示最近条目，
      // 全页 getByText 会同时命中它，strict mode 直接报错。
      await expect(page.getByTestId('output-list')).toBeVisible({ timeout: 5_000 });
      await expect(
        page.getByTestId('output-list').getByText(outputTitle, { exact: false }),
      ).toBeVisible();
    });
});

async function aiBuildsThroughThreeTiers(request: APIRequestContext): Promise<string> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, 'cursor-mbp');
  const sid = await initMCP(request, apiToken);
  const raw = await callTool<{ raw_id: string }>(
    request, apiToken, sid, 'raw_dump',
    { body: RAW_BODY, source: 'mcp:cursor', tags: ['architecture'] },
  );
  const wiki = await callTool<{ wiki_id: string }>(
    request, apiToken, sid, 'promote_to_wiki',
    { raw_id: raw.raw_id, title: WIKI_TITLE },
  );
  await callTool<{ output_id: string }>(
    request, apiToken, sid, 'promote_wiki_to_output',
    { wiki_id: wiki.wiki_id, title: OUTPUT_TITLE },
  );
  return OUTPUT_TITLE;
}

async function openOutput(page: Page): Promise<void> {
  await gotoAdminSection(page, 'output');
  await page.waitForURL('**/admin/output', { timeout: 5_000 });
}
