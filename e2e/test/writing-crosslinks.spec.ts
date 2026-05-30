// writing-crosslinks.spec.ts —— writing body_md 里 `[[X]]` 双链 e2e.
//
// 业务故事：
//   1. owner 在 Claude Desktop 让 AI 调 writing_create 写两篇 writing: A 和 B。
//      A 的 body 里写 `[[B-slug]]`、`[[B Title]]`、`[[Bad Title|看 B]]`。
//   2. visitor 打开 /writings/A → body 里这三处都渲染成 <a href="/writings/B"> 的可点
//      链接 (slug match, title match, alias)；不存在的 `[[Ghost]]` 留原文。
//   3. visitor 打开 /writings/B → 页脚出现 "linked from" backlinks，列出 A。
//   4. A 改 body 移掉 `[[B-slug]]` 那段 → /writings/B 的 backlinks 消失。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'crosslink-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'crosslinker',
  fullName: 'Cross Linker',
};

test.describe('writing crosslinks: [[X]] resolves + backlinks', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('A renders [[B]] as links + B shows backlink + unresolved stays literal',
    async ({ request, page }) => {
      const { token: tok, sid } = await mcpSession(request, 'crosslink-token');

      // writing B first —— A 需要 B 已存在才解析得到 dst。
      await callTool(request, tok, sid, 'writing_create', {
        slug: 'writing-b',
        title: 'Writing B Heading',
        excerpt: 'Target of crosslinks.',
        body_md: 'Body of B.',
        cover_headline: 'b.', cover_sub: 'target.', cover_hue: 'amber',
        tags: ['crosslink'], publish: true,
      });

      // writing A 含三条 [[X]]：slug match / title match / alias；外加一条不存在的。
      const A_BODY = [
        'Intro line.',
        '',
        'See [[writing-b]] for slug match.',
        '',
        'Also see [[Writing B Heading]] for title match.',
        '',
        'Or click [[writing-b|see B over there]] for alias.',
        '',
        'But [[ghost-writing]] stays literal.',
      ].join('\n');
      await callTool(request, tok, sid, 'writing_create', {
        slug: 'writing-a',
        title: 'Writing A',
        excerpt: 'Has crosslinks.',
        body_md: A_BODY,
        cover_headline: 'a.', cover_sub: 'source.', cover_hue: 'violet',
        tags: ['crosslink'], publish: true,
      });

      // visit A → 三条 link 全渲染成 /writings/writing-b 锚点；ghost 留 literal。
      await goto(page, '/writings/writing-a');
      const body = page.getByTestId('writing-article-body');
      const linkSlug = body.locator('a[href="/writings/writing-b"]', { hasText: 'Writing B Heading' });
      await expect(linkSlug).toHaveCount(2); // slug match + title match 都 render dst.title
      const linkAlias = body.locator('a[href="/writings/writing-b"]', { hasText: 'see B over there' });
      await expect(linkAlias).toHaveCount(1);
      await expect(body).toContainText('[[ghost-writing]]');
      // 验证 A 自己不出现在自己 backlinks（self-link 排除：A 没指 A）
      await expect(page.getByTestId('writing-article-backlinks')).toHaveCount(0);

      // visit B → backlinks 里有 A
      await goto(page, '/writings/writing-b');
      const backlinks = page.getByTestId('writing-article-backlinks');
      await expect(backlinks).toBeVisible();
      const aLi = page.getByTestId('backlink-writing-a');
      await expect(aLi).toHaveText('Writing A');
      // 点 <a> 本身（testid 挂在 <li>，click <li> 不会触发 link 导航）。
      await backlinks.getByRole('link', { name: 'Writing A' }).click();
      await page.waitForURL('**/writings/writing-a');
    });

  test('delete A → B backlinks cleared (FK cascade)',
    async ({ request, page }) => {
      const { token: tok, sid } = await mcpSession(request, 'delete-crosslink-token');
      // 取到 writing-a 的 id：writing_list 第一手。
      const rows = await callTool<{ id: string; slug: string }[]>(
        request, tok, sid, 'writing_list', {},
      );
      const aRow = rows.find((p) => p.slug === 'writing-a');
      expect(aRow).toBeTruthy();
      await callTool(request, tok, sid, 'writing_delete', { writing_id: aRow!.id });

      await goto(page, '/writings/writing-b');
      // backlinks 段 disappear；至少不含 writing-a。
      await expect(page.getByTestId('backlink-writing-a')).toHaveCount(0);
    });
});

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await request.dispose();
}

async function mcpSession(
  request: APIRequestContext, tokenName: string,
): Promise<{ token: string; sid: string }> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const apiToken = await createAPIToken(request, csrf, tokenName);
  const sid = await initMCP(request, apiToken);
  return { token: apiToken, sid };
}
