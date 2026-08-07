// genre-assets-admin-raw-subj.spec.ts —— raw 和 subjectivity 在**面板上**也挂得上文件。
//
// wiki / output 的素材入口先建好了(genre-assets-admin.spec.ts),另外两个 genre 那时还没有:
// raw 只能在倾倒之后干瞪眼,subjectivity 在面板上**一个界面都没有** —— owner 想知道自己
// 写过什么,只能去问 AI。
//
// 两个面**一样**,而且必须一样 —— subjectivity 不是特例,它只是第四个 genre:
// 同一个 CorpusEntryForm、同一个素材区、同一条 `/corpus/{genre}` 路由。
//
// (它一度被写成只读的:那条 op 上挂着一个 fp.Only(..., "mcp"),理由写着"自我模型是
// 边想边写出来的,不是填出来的"。那是**一句被写进代码的偏好**,不是产品决定 ——
// owner 说了它要跟别的 genre 一样。所以这条 spec 也钉住那件事:面板上建得了、改得了。)

import type { APIRequestContext, Page } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createEntry } from '@/fixtures/genre-assets';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP } from '@/fixtures/mcp';
import { gotoAdminSection } from '@/fixtures/navigate';

const OWNER = {
  email: 'assets-raw-subj@example.com', password: 'correct-horse-battery-staple',
  handle: 'assetsrawsubj', fullName: 'Assets Raw Subj Owner',
};

// 一个 1×1 的合法 PNG。**真实字节** —— 后端按字节签名核对声明的类型,
// 一个叫 .png 的空文件会被正确地拒掉,那样这条测的就是拒绝路径了。
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

interface MCPSession { request: APIRequestContext; token: string; sid: string }
let s: MCPSession;
let subjectivityID = '';

test.use({ ownerCredentials: { email: OWNER.email, password: OWNER.password } });

test.describe('raw 和 subjectivity 的面板素材入口', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    const token = await createAPIToken(request, csrf, 'raw-subj-token');
    s = { request, token, sid: await initMCP(request, token) };
    // subjectivity 只能由 AI 写 —— 所以种子数据也走 MCP,那正是 owner 真实的路径。
    subjectivityID = await createEntry(
      s, 'subjectivity', 'How I judge a system', 'I look for what it makes impossible.');
    await request.dispose();
  });

  test('raw:倾倒一条 → 编辑里挂文件 → 插进正文 → 存得下来', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'raw');
    const id = await dumpRaw(page, 'a thought that will carry a file');
    const prefix = `raw-edit-form-${id}`;

    await page.getByTestId(`raw-edit-${id}`).click();
    await expect(page.getByTestId(prefix)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId(`${prefix}-assets`), 'raw 也有素材区').toBeVisible();
    await expect(page.getByTestId(`${prefix}-assets-empty`)).toBeVisible();

    const assetID = await attachOne(page, prefix, 'sketch.png');
    await page.getByTestId(`${prefix}-asset-insert-${assetID}`).click();
    const body = page.getByTestId(`raw-edit-body-${id}`);
    await expect(body).toHaveValue(new RegExp(`standmeet-asset:${assetID}`));

    await page.getByTestId(`${prefix}-submit`).click();
    // 存完等表单**自己关上**再重开。`raw-edit-{id}` 是个开合钮:存请求还在飞的时候点它,
    // 关掉的是那张还开着的表单 —— 于是下面找不到 body,超时。表单消失是这一行存好了的信号
    // (onDone 只在保存回程里调),而且它认得出是**哪一行**,比等一个通用 toast 可靠。
    await expect(page.getByTestId(prefix)).toBeHidden({ timeout: 15_000 });
    await page.getByTestId(`raw-edit-${id}`).click();
    await expect(page.getByTestId(`raw-edit-body-${id}`))
      .toHaveValue(new RegExp(`standmeet-asset:${assetID}`), { timeout: 15_000 });
  });

  test('subjectivity:面板上看得见、改得了、挂得上文件(跟别的 genre 一样)', async (
    { adminPage: page },
  ) => {
    await gotoAdminSection(page, 'subjectivity');

    // 在这个页面之前,subjectivity 在面板上一个界面都没有 —— owner 想知道自己写过什么,
    // 只能去问 AI。
    const row = page.getByTestId(`subjectivity-row-${subjectivityID}`);
    await expect(row, 'AI 写的那条在面板上看得见').toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('How I judge a system');

    // 这个开关**说了什么**,不只是它在不在。原来这里只有 .click():按钮存在、可点,
    // 断言就过——所以 2026-08-07 真实环境里它把 `ADMINCORPUS.COMMON.EDIT`(一条没解析的
    // i18n key)印在 17 行上,而这条 spec 一直是绿的(F-L-15)。存在性断言证明不了内容正确。
    const editToggle = page.getByTestId(`subjectivity-edit-${subjectivityID}`);
    await expect(editToggle, '开关上写的是 EDIT,不是翻译 key').toHaveText(/^edit$/i);
    await editToggle.click();
    await expect(editToggle, '展开之后它变成 CANCEL').toHaveText(/^cancel$/i);
    const prefix = `subjectivity-edit-form-${subjectivityID}`;
    await expect(page.getByTestId(`subjectivity-edit-loaded-${subjectivityID}`))
      .toBeVisible({ timeout: 15_000 });

    // 挂文件 + 插进正文 —— **跟 wiki / output 逐字同一套动作**。
    const assetID = await attachOne(page, prefix, 'diagram.png');
    await page.getByTestId(`${prefix}-asset-insert-${assetID}`).click();
    await expect(page.getByTestId(`${prefix}-body`))
      .toHaveValue(new RegExp(`standmeet-asset:${assetID}`));

    // 改得动,而且存得下来 —— 这一条钉的是"面板写得了 subjectivity"。
    await page.getByTestId(`${prefix}-title`).fill('How I judge a system (edited)');
    await page.getByTestId(`${prefix}-submit`).click();
    await expect(
      page.getByTestId(`subjectivity-row-${subjectivityID}`),
      '改完的标题回到列表上',
    ).toContainText('(edited)', { timeout: 15_000 });
  });

  test('subjectivity:面板上建得了一条新的', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'subjectivity');
    await page.getByTestId('subjectivity-new-btn').click();
    await page.getByTestId('subjectivity-create-title').fill('What I optimise for');
    await page.getByTestId('subjectivity-create-body').fill('Fewer things that can go wrong.');
    await page.getByTestId('subjectivity-create-submit').click();

    await expect(
      page.getByTestId('subjectivity-list').filter({ hasText: 'What I optimise for' }),
      '面板建的那条出现在列表里',
    ).toBeVisible({ timeout: 15_000 });
  });
});

// dumpRaw —— 在倾倒框里倒一条,返回它的 id(从行的 testid 上取 —— 取自**页面**,
// 因为这条 spec 要证的就是那一行真的渲出来了)。
async function dumpRaw(page: Page, body: string): Promise<string> {
  await page.getByTestId('dump-input').fill(body);
  // 倾倒按钮按 role + 文本点 —— Btn 刻意不暴露 data-testid(测试的关注点不该长进
  // 通用组件的 API),现有的 admin-raw-crud 也是这么点的。
  await page.getByRole('button', { name: /dump/i }).click();
  const row = page.locator('[data-testid^="raw-row-"]').filter({ hasText: body }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const testid = await row.getAttribute('data-testid');
  const id = (testid ?? '').replace('raw-row-', '');
  expect(id, '拿到了刚倒那条的 id').not.toBe('');
  return id;
}

// attachOne —— 在素材区选一个文件,断言那一行渲出来了(文件名 + **真实字节数**),
// 返回它的 asset id。id 取自**页面上那一行**,不是接口回参 —— 这几条要证的就是它渲出来了。
async function attachOne(page: Page, prefix: string, filename: string): Promise<string> {
  await page.getByTestId(`${prefix}-asset-input`).setInputFiles({
    name: filename, mimeType: 'image/png', buffer: PNG,
  });
  const row = page.getByTestId(new RegExp(`^${prefix}-asset-row-`));
  await expect(row).toHaveCount(1, { timeout: 15_000 });
  await expect(row, '文件名').toContainText(filename);
  await expect(row, '真实字节数,不是一句"已上传"').toContainText(`${String(PNG.length)} B`);
  return firstAssetID(page, prefix);
}

async function firstAssetID(page: Page, prefix: string): Promise<string> {
  const testid = await page.getByTestId(new RegExp(`^${prefix}-asset-row-`))
    .first().getAttribute('data-testid');
  return (testid ?? '').replace(`${prefix}-asset-row-`, '');
}
