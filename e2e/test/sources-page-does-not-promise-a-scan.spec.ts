// sources-page-does-not-promise-a-scan —— /admin/sources 说的抓取方式必须是**真的那一种**。
//
// F-E-6：这一页写着 *"Each source is scanned every 30 minutes."* —— 而这台实例上四条源
// 全是 `never fetched`，`/admin/system` 的后台任务表里也**没有**这个任务。后端只注册了
// 三个 periodic（resume-draft sweep / inference usage cleanup / sandbox workspace sweep），
// 一个源扫描都没有。**这句话描述的是一个不存在的机制。**
//
// 它比"文案不准"更重：owner 读完会以为坐着等就行，于是永远等不到 —— 而真正的入口
// （让 Claude 跑 `jobs.fetch_new`）这一页一个字都没提。`/admin/listings` 说对了，
// 同一个产品两页两个说法。
//
// 断言两条，都盯着**这一页说了什么**：
//   1. 不许承诺自动扫描（那是假的）；
//   2. 必须点名真正的入口（`jobs.fetch_new`），否则 owner 无路可走。

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'sources-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'sourcesowner',
  fullName: 'Sources Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('the sources page describes the fetch that actually exists', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('no promise of an automatic scan; the real entry point is named (F-E-6)',
    async ({ adminPage }) => {
      await gotoAdminSection(adminPage, 'sources');
      // 先取文本再判断 —— `.not.toContainText` 在元素还没出现时也算通过
      // （[[negated-assertion-passes-while-absent]]）。
      const intro = await adminPage.getByTestId('sources-intro').innerText();
      expect(intro, 'the page must not promise a scheduled scan that no periodic performs')
        .not.toMatch(/scanned every|every \d+ minutes|automatically fetch/i);
      expect(intro, 'the page must name the way listings actually arrive')
        .toContain('jobs.fetch_new');
    });
});

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
