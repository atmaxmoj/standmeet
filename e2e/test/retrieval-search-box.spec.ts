// retrieval-search-box.spec.ts —— E. 访客 UI 搜索框(crawl face)。
//
// 访客带 code 进站 → 名字选择器发 session → 页面上的搜索框输入 → corpus_search → 结果渲染 →
// 点结果打开对应 note;空结果 → 友好空态。ACL 由后端保证(不显示 denied),UI 只渲返回结果。

import type { Page } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { seedWiki } from '@/fixtures/corpus';
import { goto } from '@/fixtures/navigate';
import { setPublished, setupRetrievalOwner, type RetrievalOwner } from '@/fixtures/retrieval';

let O: RetrievalOwner;

// enter —— ?code 入口 → 名字选择器填名 → 提交 → 等 session issue(之后搜索框才出现)。
async function enter(page: Page): Promise<void> {
  await goto(page, `/?code=${O.fullCode}`);
  const session = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/sessions') && r.status() === 200, { timeout: 15_000 },
  );
  await page.getByTestId('visitor-name-input').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('visitor-name-input').fill('Searcher');
  await page.getByTestId('visitor-name-submit').click();
  await session;
}

test.describe('E · 访客 UI 搜索框', () => {
  test.beforeAll(async ({ playwright }) => {
    O = await setupRetrievalOwner(playwright, 'searchbox');
    const { wikiID } = await seedWiki(O.request, O.apiToken, O.sid, {
      title: 'Searchbox Target', body: 'OSCARKW findable via the box', path: 'searchbox-target',
    });
    await setPublished(O.request, O.csrf, wikiID, true); // 发布,点结果能进公开 reader
  });
  test.afterAll(async () => { await O.request.dispose(); });

  test('E1 输入 → 结果渲染 → 点开对应 note', async ({ page }) => {
    await enter(page);
    const box = page.getByTestId('corpus-search-input');
    await expect(box).toBeVisible();
    await box.fill('OSCARKW');
    await box.press('Enter');
    const result = page.getByTestId('corpus-search-result').filter({ hasText: 'Searchbox Target' });
    await expect(result).toBeVisible();
    await result.click();
    // 搜索框的职责闭环:点结果导航到那条 note 的 reader(标题渲染是 reader 的事,另测)。
    await expect(page).toHaveURL(/\/wiki\/searchbox-target/);
  });

  test('E2 空结果 → 友好空态,不白屏', async ({ page }) => {
    await enter(page);
    const box = page.getByTestId('corpus-search-input');
    await box.fill('ZZZNOSUCHTERMZZZ');
    await box.press('Enter');
    await expect(page.getByTestId('corpus-search-empty')).toBeVisible();
  });
});
