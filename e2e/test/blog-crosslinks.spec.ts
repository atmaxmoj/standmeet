// blog-crosslinks.spec.ts —— post body_md 里 `[[X]]` 双链 e2e。
//
// 业务故事：
//   1. owner 在 Claude Desktop 让 AI 调 post_create 写两篇 post: A 和 B。
//      A 的 body 里写 `[[B-slug]]`、`[[B Title]]`、`[[Bad Title|看 B]]`。
//   2. visitor 打开 /blog/A → body 里这三处都渲染成 <a href="/blog/B"> 的可点
//      链接 (slug match, title match, alias)；不存在的 `[[Ghost]]` 留原文。
//   3. visitor 打开 /blog/B → 页脚出现 "linked from" backlinks，列出 A。
//   4. A 改 body 移掉 `[[B-slug]]` 那段 → /blog/B 的 backlinks 消失。

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

test.describe.serial('blog crosslinks: [[X]] resolves + backlinks', () => {
  test.beforeAll(async ({ playwright }) => { await initOwner(playwright); });

  test('A renders [[B]] as links + B shows backlink + unresolved stays literal',
    async ({ request, page }) => {
      const { token: tok, sid } = await mcpSession(request, 'crosslink-token');

      // post B first —— A 需要 B 已存在才解析得到 dst。
      await callTool(request, tok, sid, 'post_create', {
        slug: 'post-b',
        title: 'Post B Heading',
        excerpt: 'Target of crosslinks.',
        body_md: 'Body of B.',
        cover_headline: 'b.', cover_sub: 'target.', cover_hue: 'amber',
        tags: ['crosslink'], publish: true,
      });

      // post A 含三条 [[X]]：slug match / title match / alias；外加一条不存在的。
      const A_BODY = [
        'Intro line.',
        '',
        'See [[post-b]] for slug match.',
        '',
        'Also see [[Post B Heading]] for title match.',
        '',
        'Or click [[post-b|see B over there]] for alias.',
        '',
        'But [[ghost-post]] stays literal.',
      ].join('\n');
      await callTool(request, tok, sid, 'post_create', {
        slug: 'post-a',
        title: 'Post A',
        excerpt: 'Has crosslinks.',
        body_md: A_BODY,
        cover_headline: 'a.', cover_sub: 'source.', cover_hue: 'violet',
        tags: ['crosslink'], publish: true,
      });

      // visit A → 三条 link 全渲染成 /blog/post-b 锚点；ghost 留 literal。
      await goto(page, '/blog/post-a');
      const body = page.getByTestId('blog-article-body');
      const linkSlug = body.locator('a[href="/blog/post-b"]', { hasText: 'Post B Heading' });
      await expect(linkSlug).toHaveCount(2); // slug match + title match 都 render dst.title
      const linkAlias = body.locator('a[href="/blog/post-b"]', { hasText: 'see B over there' });
      await expect(linkAlias).toHaveCount(1);
      await expect(body).toContainText('[[ghost-post]]');
      // 验证 A 自己不出现在自己 backlinks（self-link 排除：A 没指 A）
      await expect(page.getByTestId('blog-article-backlinks')).toHaveCount(0);

      // visit B → backlinks 里有 A
      await goto(page, '/blog/post-b');
      const backlinks = page.getByTestId('blog-article-backlinks');
      await expect(backlinks).toBeVisible();
      const aLi = page.getByTestId('backlink-post-a');
      await expect(aLi).toHaveText('Post A');
      // 点 <a> 本身（testid 挂在 <li>，click <li> 不会触发 link 导航）。
      await backlinks.getByRole('link', { name: 'Post A' }).click();
      await page.waitForURL('**/blog/post-a');
    });

  test('delete A → B backlinks cleared (FK cascade)',
    async ({ request, page }) => {
      const { token: tok, sid } = await mcpSession(request, 'delete-crosslink-token');
      // 取到 post-a 的 id：post_list 第一手。
      const rows = await callTool<{ id: string; slug: string }[]>(
        request, tok, sid, 'post_list', {},
      );
      const aRow = rows.find((p) => p.slug === 'post-a');
      expect(aRow).toBeTruthy();
      await callTool(request, tok, sid, 'post_delete', { post_id: aRow!.id });

      await goto(page, '/blog/post-b');
      // backlinks 段 disappear；至少不含 post-a。
      await expect(page.getByTestId('backlink-post-a')).toHaveCount(0);
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
