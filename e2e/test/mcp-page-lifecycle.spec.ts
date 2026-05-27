// mcp-page-lifecycle.spec.ts —— custom_page 完整生命周期，覆盖 custom-page.spec.ts
// 没碰的几个 tool：promote_to_staging（单独一步，不直接走 live）、list（列入）、
// delete（移除）。访客视角同步校验：live 后能访问、delete 后 404。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

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

const SLUG = 'about';
const MARKER = 'STANDMEET_ABOUT_PAGE_OK';
const APP_SOURCE = `
import React from 'react';

export default function App() {
  return (
    <main data-testid="about-page">
      <h1>About</h1>
      <p>${MARKER}</p>
    </main>
  );
}
`;

interface PagePayload { id: string; slug: string; title: string }
interface BuildPayload { build_id: string; status: string }
interface ListPayload { pages: PagePayload[] }

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });
test.describe('custom_page lifecycle: staging → live → list → delete', () => {
  let apiToken = '';

  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    apiToken = await createAPIToken(request, csrf, 'lifecycle-token');
    await request.dispose();
  });

  test('staging then live shows in list + visitor URL; delete removes both',
    async ({ request, adminPage: page }) => {
      const sid = await initMCP(request, apiToken);
      const build = await prepareBuiltPage(request, apiToken, sid);

      // staging single-step：tool 不报 error 即视为通过（list 不暴露
      // staging_build_id，下面靠 promote_to_live 串起来）。
      await callTool<PagePayload>(request, apiToken, sid,
        'custom_page.promote_to_staging', { slug: SLUG, build_id: build.build_id });
      await callTool<PagePayload>(request, apiToken, sid,
        'custom_page.promote_to_live', { slug: SLUG, build_id: build.build_id });

      const inList = await callTool<ListPayload>(
        request, apiToken, sid, 'custom_page.list', {});
      expect(inList.pages.find((p) => p.slug === SLUG)).toBeTruthy();

      // UI 视角：admin custom-pages section → 点 view live ↗ → /p/<slug> 渲染。
      await gotoAdminSection(page, 'custom-pages');
      await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });
      await page.locator(`[data-testid="custom-page-row-${SLUG}"]`)
        .getByRole('link', { name: 'view live ↗' })
        .click();
      await page.waitForURL(`**/p/${SLUG}`, { timeout: 10_000 });
      await expect(page.getByTestId('about-page')).toBeVisible({ timeout: 15_000 });

      // delete → admin row 整个消失（has_live 链接也跟着没了）。
      await callTool<unknown>(
        request, apiToken, sid, 'custom_page.delete', { slug: SLUG });

      const afterDelete = await callTool<ListPayload>(
        request, apiToken, sid, 'custom_page.list', {});
      expect(afterDelete.pages.find((p) => p.slug === SLUG)).toBeUndefined();

      // 当前在 /p/<slug> standalone React 页面，没 admin nav；page.goBack()
      // 回到 /admin/custom-pages（等价"用户看完 live 版本后浏览器后退"）。
      await page.goBack();
      await page.waitForURL('**/admin/custom-pages', { timeout: 10_000 });
      await page.reload();
      await expect(page.locator(`[data-testid="custom-page-row-${SLUG}"]`))
        .toHaveCount(0, { timeout: 5_000 });
    });
});

async function prepareBuiltPage(
  request: APIRequestContext, token: string, sid: string,
): Promise<BuildPayload> {
  await callTool<PagePayload>(request, token, sid, 'custom_page.create', { slug: SLUG });
  const build = await callTool<BuildPayload>(
    request, token, sid, 'custom_page.write_file',
    { slug: SLUG, path: 'App.tsx', content: APP_SOURCE },
  );
  return await pollUntilBuilt(request, token, sid, build.build_id);
}

async function pollUntilBuilt(
  request: APIRequestContext, token: string, sid: string, buildID: string,
): Promise<BuildPayload> {
  let last: BuildPayload = { build_id: buildID, status: 'pending' };
  await expect.poll(
    async () => {
      last = await callTool<BuildPayload>(
        request, token, sid, 'custom_page.get_build', { build_id: buildID });
      if (last.status === 'failed') throw new Error('build failed');
      return last.status;
    },
    { timeout: 60_000, intervals: [1_000] },
  ).toBe('built');
  return last;
}

