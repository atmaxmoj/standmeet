// genre-assets-admin.spec.ts —— **owner 在面板上真的挂得上一份文件**。
//
// 这条 spec 存在,是因为它验的那个面以前不存在:后端从 2026-07 起每个 genre 都能挂素材、
// 访客的阅读页也渲染得出来、30 条 e2e 全绿 —— 而 owner 在 /admin/wiki 上一个入口都没有。
// 唯一跟"挂文件"沾边的东西是 raw 倾倒框里一个写着 "attach media" 的 span:有 cursor-pointer、
// 有 hover 变色、没有 onClick。
//
// 所以这条不走 MCP,也不走 REST。owner 的两个端是 MCP 和面板;MCP 那条已经有覆盖,
// 缺的正是**面板**这条。上传走浏览器真实的文件挑选框(setInputFiles),文件字节在这里现造。

import type { Page } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'assets-admin@example.com', password: 'correct-horse-battery-staple',
  handle: 'assetsadmin', fullName: 'Assets Admin Owner',
};

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

// PNG_BYTES —— 一个 1×1 的合法 PNG。**真实字节**,不是一个叫 .png 的空文件:
// 后端按字节签名核对声明的类型,假的会被正确地拒掉,那样这条测的就是拒绝路径了。
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('owner 在面板上挂文件', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    await request.dispose();
  });

  test('选一个文件 → 列表出现文件名和真实字节数 → 插进正文 → 存得下来', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'wiki');

    const id = await createWikiEntry(page, 'Panel attach note');
    const prefix = `wiki-edit-form-${id}`;
    await page.getByTestId(`wiki-edit-${id}-slot`).waitFor({ timeout: 15_000 });
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });

    // 挂之前:素材区在,而且明说"一个都没有"。
    await expect(page.getByTestId(`${prefix}-assets`)).toBeVisible();
    await expect(page.getByTestId(`${prefix}-assets-empty`)).toBeVisible();

    await page.getByTestId(`${prefix}-asset-input`).setInputFiles({
      name: 'panel-pixel.png', mimeType: 'image/png', buffer: PNG_BYTES,
    });

    // 回执要说清楚上去的是**哪一份**:文件名 + 真实字节数。"已上传"三个字不是回执。
    const row = page.getByTestId(new RegExp(`^${prefix}-asset-row-`));
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(row).toContainText('panel-pixel.png');
    await expect(row, '说的是真实大小,不是一句"已上传"')
      .toContainText(`${String(PNG_BYTES.length)} B`);

    // 插进正文:正文里出现一条稳定的 asset URI(不是会过期的预签名地址)。
    const assetID = await firstAssetID(page, prefix);
    await page.getByTestId(`${prefix}-asset-insert-${assetID}`).click();
    const body = page.getByTestId(`${prefix}-body`);
    await expect(body).toHaveValue(new RegExp(`standmeet-asset:${assetID}`));
    await expect(body, '正文里不该是会过期的预签名地址').not.toHaveValue(/X-Amz-|\?token=/);

    // 存下来,重新展开还在 —— 不落库的话这一切只是屏幕上的样子。
    await page.getByTestId(`${prefix}-submit`).click();
    await page.getByTestId(`wiki-edit-${id}`).click();
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`${prefix}-body`))
      .toHaveValue(new RegExp(`standmeet-asset:${assetID}`), { timeout: 15_000 });
    await expect(page.getByTestId(new RegExp(`^${prefix}-asset-row-`))).toHaveCount(1);
  });

  test('撤下来:行没了,素材区回到"一个都没有"', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'wiki');

    const id = await createWikiEntry(page, 'Panel remove note');
    const prefix = `wiki-edit-form-${id}`;
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
    await page.getByTestId(`${prefix}-asset-input`).setInputFiles({
      name: 'doomed.png', mimeType: 'image/png', buffer: PNG_BYTES,
    });
    await expect(page.getByTestId(new RegExp(`^${prefix}-asset-row-`)))
      .toHaveCount(1, { timeout: 15_000 });

    const assetID = await firstAssetID(page, prefix);
    await page.getByTestId(`${prefix}-asset-remove-${assetID}`).click();
    await expect(page.getByTestId(new RegExp(`^${prefix}-asset-row-`)))
      .toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId(`${prefix}-assets-empty`)).toBeVisible();
  });

  test('不收的文件:界面上说清楚为什么,不是一句"出错了"', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'wiki');

    const id = await createWikiEntry(page, 'Panel reject note');
    const prefix = `wiki-edit-form-${id}`;
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });

    // 声明 image/png,字节其实是 SVG —— 存下来再由我们的域发出去就是存储型 XSS。
    await page.getByTestId(`${prefix}-asset-input`).setInputFiles({
      name: 'sneaky.png', mimeType: 'image/png',
      buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'),
    });

    const toast = page.getByTestId('toast-error');
    await expect(toast).toBeVisible({ timeout: 15_000 });
    await expect(toast, '说的是这份文件哪儿不对,不是 500 / stack trace')
      .toContainText(/content mismatch|not accepted/i);
    await expect(toast).not.toContainText(/goroutine|panic|500/i);
    await expect(page.getByTestId(new RegExp(`^${prefix}-asset-row-`))).toHaveCount(0);
  });
});

// createWikiEntry —— 在面板上新建一条 wiki 并展开它的编辑表单,返回它的 id。
async function createWikiEntry(
  page: Page,title: string,
): Promise<string> {
  await page.getByTestId('wiki-new-btn').click();
  await page.getByTestId('wiki-create-title').fill(title);
  await page.getByTestId('wiki-create-body').fill('a note that will carry a file');
  await page.getByTestId('wiki-create-submit').click();
  const row = page.locator('[data-testid^="wiki-row-"]').filter({ hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const testid = await row.getAttribute('data-testid');
  const id = (testid ?? '').replace('wiki-row-', '');
  expect(id, '拿到了新建那条的 id').not.toBe('');
  await page.getByTestId(`wiki-edit-${id}`).click();
  return id;
}

// firstAssetID —— 从素材行的 testid 里取出 asset id。取自**页面**,不是接口回参:
// 这条 spec 要证的就是这一行真的渲出来了。
async function firstAssetID(
  page: Page,prefix: string,
): Promise<string> {
  const testid = await page.getByTestId(new RegExp(`^${prefix}-asset-row-`))
    .first().getAttribute('data-testid');
  return (testid ?? '').replace(`${prefix}-asset-row-`, '');
}
