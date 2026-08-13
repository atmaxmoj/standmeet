// admin-nav-marks-the-page-you-are-on —— 侧栏必须标出**你正在看的那一节**。
//
// F-N-1：`/admin/subjectivity` 上高亮的是 `dashboard`。原因不是高亮逻辑写错了，而是
// **同一份事实存了两份**：侧栏自己有 `NAV_GROUPS`（那里有 subjectivity），而
// `AdminShell` 另有一份手抄的 `KNOWN_SLUGS` 用来把路径映射成 slug —— 那份漏了它，
// 于是走「未知 → dashboard」的兜底。两份清单飘了，其中一份不知道。
//
// 这条用例**逐个点过侧栏里的每一节**，而不是只验 subjectivity 那一节：
// 漏抄一项这种事没有理由只发生一次，而下一个加节的人同样不会知道有第二份清单。
// 断言用 `aria-current="page"` —— 那是"当前页"的语义，不是某个 class 的写法。

import { test, expect } from '@/fixtures/test';
import type { Page, Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'nav-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'navowner',
  fullName: 'Nav Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('admin sidebar marks the section you are on', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('every section in the sidebar marks itself when you are on it (F-N-1)',
    async ({ adminPage }) => {
      const slugs = await sidebarSlugs(adminPage);
      expect(slugs.length, 'the sidebar has sections to check').toBeGreaterThan(15);
      const wrong: string[] = [];
      for (const slug of slugs) {
        await gotoAdminSection(adminPage, slug);
        const marked = await markedSlug(adminPage);
        marked === slug || wrong.push(`${slug} → marked "${marked}"`);
      }
      expect(wrong, `sections whose sidebar entry is not the one marked:\n${wrong.join('\n')}`)
        .toEqual([]);
    });
});

// sidebarSlugs —— 从侧栏**渲染出来的**链接读 slug，而不是从代码里再抄一份清单。
// 抄第三份正是这条缺陷本身。
async function sidebarSlugs(page: Page): Promise<string[]> {
  const ids = await page.locator('[data-testid^="admin-nav-"]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-testid') ?? ''),
  );
  return [...new Set(ids.map((id) => id.replace(/^admin-nav-/, '')).filter(Boolean))];
}

async function markedSlug(page: Page): Promise<string> {
  const href = await page.locator('nav a[aria-current="page"]').first()
    .getAttribute('href')
    .catch(() => null);
  return (href ?? '(none)').replace(/^\/admin\//, '');
}

async function initOwner(playwright: Playwright): Promise<void> {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), {
    email: OWNER.email, password: OWNER.password,
    handle: OWNER.handle, fullName: OWNER.fullName,
  });
  await loginAPI(request, OWNER.email, OWNER.password);
  await request.dispose();
}
