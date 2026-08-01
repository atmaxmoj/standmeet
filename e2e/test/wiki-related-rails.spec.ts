// wiki-related-rails.spec.ts —— F2:wiki reader 底部两条 related rail。
//   - read next  = 出链(本条 [[X]] 指向的)= landing.related
//   - cited by   = 入链(指向本条的别人)= landing.cited_by
// 后端 landing 早就返了 related/cited_by(wiki_refs 边图),这条测前端把它们渲成 rail。
//
// 边:Entry A 的 body 含 [[Target B]] → A→B。所以 A 的 read next 有 B;B 的 cited by 有 A。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'rails@example.com', password: 'correct-horse-battery-staple',
  handle: 'railsowner', fullName: 'Rails Owner',
};

let mcpToken = '';

test.describe('F2 wiki reader related rails (read next / cited by)', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'rails-seed');
    const sid = await initMCP(request, mcpToken);
    // B 先种(让 A 的 [[Target B]] 解析得到);再种 A(promote 时建 A→B 边)。
    const b = await seedWiki(request, mcpToken, sid, {
      title: 'Target B', body: 'The target entry body.',
    });
    const a = await seedWiki(request, mcpToken, sid, {
      title: 'Entry A', body: 'See [[Target B]] for the details.',
    });
    await indexWiki(request, sid, a.wikiID);
    await indexWiki(request, sid, b.wikiID);
    await request.dispose();
  });

  test('A reader shows a "read next" rail linking the outbound target', async ({ page }) => {
    await goto(page, '/wiki/entry-a');
    await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
    const rail = page.getByTestId('related-rail-read-next');
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link', { name: /Target B/ }))
      .toHaveAttribute('href', '/wiki/target-b');
    // A 没有入链 → cited by rail 不出现。
    await expect(page.getByTestId('related-rail-cited-by')).toHaveCount(0);
  });

  test('B reader shows a "cited by" rail linking the inbound source', async ({ page }) => {
    await goto(page, '/wiki/target-b');
    await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
    const rail = page.getByTestId('related-rail-cited-by');
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('link', { name: /Entry A/ }))
      .toHaveAttribute('href', '/wiki/entry-a');
    await expect(page.getByTestId('related-rail-read-next')).toHaveCount(0);
  });
});

async function indexWiki(request: APIRequestContext, sid: string, wikiID: string): Promise<void> {
  await publishEntry(request, mcpToken, sid, { genre: 'wiki', id: wikiID });
}
