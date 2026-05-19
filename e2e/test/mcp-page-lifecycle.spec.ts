// mcp-page-lifecycle.spec.ts —— custom_page 完整生命周期，覆盖 custom-page.spec.ts
// 没碰的几个 tool：promote_to_staging（单独一步，不直接走 live）、list（列入）、
// delete（移除）。访客视角同步校验：live 后能访问、delete 后 404。

import { test, expect } from '@playwright/test';
import type { APIRequestContext, Page } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { gotoExpectStatus } from '@/fixtures/navigate';

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

test.describe.serial('custom_page lifecycle: staging → live → list → delete', () => {
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
    async ({ request, page }) => {
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

      await expectVisitorPage(page, 200);

      await callTool<unknown>(
        request, apiToken, sid, 'custom_page.delete', { slug: SLUG });

      const afterDelete = await callTool<ListPayload>(
        request, apiToken, sid, 'custom_page.list', {});
      expect(afterDelete.pages.find((p) => p.slug === SLUG)).toBeUndefined();
      await expectVisitorPage(page, 404);
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
  for (let i = 0; i < 60; i++) {
    const status = await callTool<BuildPayload>(
      request, token, sid, 'custom_page.get_build', { build_id: buildID });
    if (status.status === 'built') return status;
    if (status.status === 'failed') throw new Error('build failed');
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error('build never succeeded');
}

async function expectVisitorPage(page: Page, status: number): Promise<void> {
  const actual = await gotoExpectStatus(page, `/${OWNER.handle}/p/${SLUG}`);
  expect(actual).toBe(status);
}
