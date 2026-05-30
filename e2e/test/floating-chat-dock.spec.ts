// floating-chat-dock.spec.ts —— FloatingChatDock on writings and wiki pages.
//
// 用户故事：
//   1. writings index → pill 可见 (有 session 时)
//   2. 无 session → pill 不渲染
//   3. 点 pill → 面板展开 → input 可见
//   4. 输入 → ask → answer 渲
//   5. 关闭面板 → pill 恢复

import { test, expect } from '@/fixtures/test';
import type { Playwright } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { seedPublicWiki } from '@/fixtures/corpus';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'dock-owner@example.com',
  password: 'correct-horse-battery-staple',
  handle: 'dockowner',
  fullName: 'Dock Owner',
};

const CODE = 'DOCK-001';

test.describe('FloatingChatDock on writings/wiki pages', () => {
  test.beforeAll(async ({ playwright }) => {
    await initOwner(playwright);
  });

  test('public visitor → no floating pill on /writings (no funded chat path)',
    async ({ page }) => {
      // Public visitor has no session → no inference funding (owner won't pay
      // for random visitors, no BYOAI key). Pill hidden until visitor either
      // absorbs a code or adds BYOAI on /gate.
      await goto(page, '/writings');
      await expect(page.getByTestId('floating-dock-pill')).toHaveCount(0);
    });

  test('with session → pill visible → click → expand → chat → close',
    async ({ page }) => {
      // Absorb code first
      await goto(page, `/?code=${CODE}`);
      await page.waitForResponse((res) =>
        res.url().endsWith('/api/v1/sessions') && res.status() === 200);
      await expect(page.getByTestId('session-strip')).toBeVisible({ timeout: 5_000 });

      // Navigate to writings
      await goto(page, '/writings');
      // Pill should be visible
      const pill = page.getByTestId('floating-dock-pill');
      await expect(pill).toBeVisible({ timeout: 5_000 });
      // Click pill → panel expands
      await pill.click();
      const panel = page.getByTestId('floating-chat-panel');
      await expect(panel).toBeVisible({ timeout: 3_000 });
      const input = panel.locator('input');
      await expect(input).toBeVisible();
      // Close panel
      await page.getByTestId('floating-dock-pill').click();
      await expect(panel).toBeHidden({ timeout: 3_000 });
      // Pill still there
      await expect(pill).toBeVisible();
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
  const apiToken = await createAPIToken(request, csrf, 'dock-seed');
  const sid = await initMCP(request, apiToken);
  await seedPublicWiki(request, apiToken, sid, {
    body: 'dock owner intro.', title: 'Dock Intro',
  });
  await createCode(request, csrf, {
    code: CODE, label: 'Dock test',
  });
  await request.dispose();
}
