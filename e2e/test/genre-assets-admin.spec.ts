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

// PDF_BYTES —— 一份最小的**真** PDF（`%PDF-` 签名 + trailer）。同 PNG_BYTES 的道理：
// 后端按字节签名核对声明的类型，一个叫 .pdf 的空文件会被正确地拒掉。
const PDF_BYTES = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
  'latin1',
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

  // 类别选择框必须**真的管用**（F-L-48）。
  //
  // 面板给了 image / attachment 两个类别，而 PDF 只有 attachment 收（媒体守卫按 kind 分白名单）。
  // 在这条用例之前，这一段的每条用例都用默认类别传图 —— **从没有人碰过那个下拉框**，
  // 于是「选了 attachment」这件事有没有效果，从来没被问过。真环境上一问就露：
  // 下拉框显示 attachment，请求里 kind 是空的，后端回 *"content-type application/pdf is not
  // accepted for image"*。owner 在面板上永远挂不上一份 PDF —— 而 attachment 这个类别
  // 就是为它存在的（[[test-covers-capability-not-face]]：MCP 那条路传 kind 正常，所以全绿）。
  test('选 attachment 类别 → PDF 挂得上（那个下拉框不是装饰）', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'wiki');

    const id = await createWikiEntry(page, 'Panel attach a PDF');
    const prefix = `wiki-edit-form-${id}`;
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`${prefix}-asset-kind`).selectOption('attachment');
    await page.getByTestId(`${prefix}-asset-input`).setInputFiles({
      name: 'panel-doc.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES,
    });

    // 判据是**那一行出现了**，不是「没报错」：被拒的话行根本不会有。
    const row = page.getByTestId(new RegExp(`^${prefix}-asset-row-`));
    await expect(row, 'attachment 类别选了就得算数 —— 否则 PDF 会被当成图片拒掉')
      .toHaveCount(1, { timeout: 15_000 });
    await expect(row).toContainText('panel-doc.pdf');
    await expect(row).toContainText(`${String(PDF_BYTES.length)} B`);
    // 存的也得是 attachment：当成 image 存下来的话，阅读页会去渲染它而不是给一个下载入口。
    await expect(row).toContainText('attachment');
  });

});

// 撤素材：面板上那一行走了不算完 —— **正文里那条引用**才是访客看得见的那一半（F-L-50）。
test.describe('撤素材连正文里的引用一起撤', () => {
  test('撤下来:行没了,素材区回到"一个都没有",正文里那条引用也走了', async ({ adminPage: page }) => {
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
    // **先把它插进正文**：撤素材这件事的代价不在面板上，在正文里那条留下来的引用
    // （F-L-50：访客页上一个裂图 + 内部文件名，而 owner 看不见）。
    await page.getByTestId(`${prefix}-asset-insert-${assetID}`).click();
    await expect(page.getByTestId(`${prefix}-body`))
      .toHaveValue(new RegExp(`standmeet-asset:${assetID}`));

    await page.getByTestId(`${prefix}-asset-remove-${assetID}`).click();
    await expect(page.getByTestId(new RegExp(`^${prefix}-asset-row-`)))
      .toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId(`${prefix}-assets-empty`)).toBeVisible();
    // 撤掉素材 = 连正文里那条引用一起撤。留着它就是「一次点击做了两件事，只做了一件」。
    await expect(page.getByTestId(`${prefix}-body`), '正文里那条引用跟着走')
      .not.toHaveValue(new RegExp(`standmeet-asset:${assetID}`));
  });
});

// hero 是**三样**:图 + 压在图上那句话 + 色调。面板上只做图那一样的话,owner 设完封面
// 看到的是标题被顶上去当 headline,而他没有任何办法改它 —— 除非去 AI 客户端调 MCP。
// 访客那侧三样都渲(genre-assets-reader 断的就是那句话渲出来了)。
test.describe('hero 三样都在面板上', () => {
  test('图 + 那句话 + 色调,存得下来也回填得回来', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'wiki');
    const id = await createWikiEntry(page, 'Panel hero note');
    const prefix = `wiki-edit-form-${id}`;
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`${prefix}-asset-input`).setInputFiles({
      name: 'cover.png', mimeType: 'image/png', buffer: PNG_BYTES,
    });
    const assetID = await firstAssetID(page, prefix);
    await page.getByTestId(`${prefix}-asset-cover-${assetID}`).click();
    await page.getByTestId(`${prefix}-cover-headline`).fill('a line over the cover');
    await page.getByTestId(`${prefix}-cover-hue`).selectOption('violet');
    await page.getByTestId(`${prefix}-submit`).click();

    // 重开:三样都回填了 —— **不回填等于告诉 owner"没设过"**,他再存一次就以为没变,
    // 实际上什么也没发生(空串不发),或者更糟:哪天改成发空串就把它抹了。
    await page.getByTestId(`wiki-edit-${id}`).click();
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`${prefix}-cover-headline`))
      .toHaveValue('a line over the cover', { timeout: 15_000 });
    await expect(page.getByTestId(`${prefix}-cover-hue`)).toHaveValue('violet');
    // 按 testid 找那个标记,不按文本 —— 同一行里「use as cover」那颗按钮的文案也含 cover,
    // 按文本判的话封面撤掉之后它照样绿([[assertion-that-cannot-fail]])。
    await expect(
      page.getByTestId(`${prefix}-asset-is-cover-${assetID}`),
      '那份素材仍标着是封面',
    ).toBeVisible();
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

// 设得上还不够 —— **撤得掉才算 owner 说了算**(F-L-38(a))。上面那条测的注释里
// 早写着这个陷阱(「空串不发……哪天改成发空串就把它抹了」),而它描述的正是当时的状态:
// 三样都只进不出。prod 上的实测:hue 选成 violet 存下,再选回 `— default —` 存,
// 重开还是 violet。owner 手里没有任何撤销的办法,而界面看起来是他挑的。
test.describe('hero 撤得掉', () => {
  test('设过之后撤得掉:三样都回得到「没设过」', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'wiki');
    const id = await createWikiEntry(page, 'Panel hero undo note');
    const prefix = `wiki-edit-form-${id}`;
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`${prefix}-asset-input`).setInputFiles({
      name: 'undo-cover.png', mimeType: 'image/png', buffer: PNG_BYTES,
    });
    const assetID = await firstAssetID(page, prefix);
    await page.getByTestId(`${prefix}-asset-cover-${assetID}`).click();
    await page.getByTestId(`${prefix}-cover-headline`).fill('a line to take back');
    await page.getByTestId(`${prefix}-cover-hue`).selectOption('violet');
    await page.getByTestId(`${prefix}-submit`).click();

    // 前置条件:三样确实设上了 —— 不然下面的「撤掉」可能撤的是本来就空的东西。
    await page.getByTestId(`wiki-edit-${id}`).click();
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`${prefix}-cover-hue`)).toHaveValue('violet', { timeout: 15_000 });

    // 撤:三样各按各的方式回到空 —— 把那句话删干净、色调选回 `— default —`、
    // 封面那颗按钮再按一次(它这时说的是「撤掉封面」)。
    await page.getByTestId(`${prefix}-asset-cover-${assetID}`).click();
    await page.getByTestId(`${prefix}-cover-headline`).fill('');
    await page.getByTestId(`${prefix}-cover-hue`).selectOption('');
    await page.getByTestId(`${prefix}-submit`).click();

    // 重开:三样都空。**这里判的是落库之后重新读回来的值**,不是屏幕上还没提交的那份 ——
    // 表单自己的状态在点保存那一刻就是空的,它证明不了服务器收到了「清空」。
    await page.getByTestId(`wiki-edit-${id}`).click();
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId(`${prefix}-cover-hue`),
      '色调回到「没挑过」',
    ).toHaveValue('', { timeout: 15_000 });
    await expect(
      page.getByTestId(`${prefix}-cover-headline`),
      '压在封面上那句话删掉了',
    ).toHaveValue('');
    await expect(
      page.getByTestId(new RegExp(`^${prefix}-asset-row-`)),
      '那份素材还在',
    ).toHaveCount(1);
    await expect(
      page.getByTestId(`${prefix}-asset-is-cover-${assetID}`),
      '但它不再是封面',
    ).toHaveCount(0);
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
