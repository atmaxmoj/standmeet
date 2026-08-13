// writing-private.spec.ts —— private writings: locked view + code access.
//
// 用户故事：
//   1. private writing + 没 code → LockedView (teaser + request CTA)
//   2. private writing + 有 code (scope 匹配) → 正常渲染
//   3. crosslink to nonexistent slug → 渲染为纯文本 (不报错)

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext, Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'writing-priv@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'writingpriv',
  fullName: 'Writing Priv Owner',
};

const CODE = 'WRITINGPRIV-001';

test.describe('writing private: locked view + code access', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('XSS in body → script not executed',
    async ({ page, request }) => {
      await seedWritings(request);
      await goto(page, '/writings/xss-deep');
      const body = page.getByTestId('writing-article-body');
      await expect(body).toBeVisible({ timeout: 5_000 });
      await expect(body.locator('script')).toHaveCount(0);
      const flag = await page.evaluate(() =>
        (window as Window & { __deepXSS?: boolean }).__deepXSS);
      expect(flag).toBeFalsy();
    });

  // F-L-25 —— 这条以前断言 `[[nonexistent-slug]]` 原样出现。改成断言方括号**不出现**，
  // 名字仍在：解析不到的链接退成纯文本，而不是把 Obsidian 语法倒给访客。
  // 放在这个 spec 里还有第二层意思：它守的是「body 是数据不是标记」，而漏出去的方括号正是
  // 一段没被处理干净的标记。
  test('crosslink to broken slug → degrades to plain text, not markup',
    async ({ page }) => {
      // Use the writing seeded above which has [[nonexistent-slug]]
      await goto(page, '/writings/xss-deep');
      const body = page.getByTestId('writing-article-body');
      await expect(body).toBeVisible({ timeout: 5_000 });
      const text = (await body.innerText()).trim();
      expect(text, 'the target name survives as words').toContain('nonexistent-slug');
      expect(text, 'no Obsidian link syntax reaches the visitor').not.toContain('[[');
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
  await createCode(request, csrf, {
    code: CODE, label: 'Writing private test',
  });
  await request.dispose();
}

async function seedWritings(request: APIRequestContext): Promise<void> {
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'writing-priv-seed');
  const sid = await initMCP(request, token);
  await callTool(request, token, sid, 'writing_create', {
    slug: 'xss-deep', title: 'XSS Deep Test',
    excerpt: 'Deeper XSS test.',
    body_md: 'Before.\n\n<script>window.__deepXSS = true;</script>\n\nAfter.\n\n[[nonexistent-slug]]',
    cover_headline: 'xss.', cover_hue: 'acid',
    tags: ['security'], publish: true,
  });
}
