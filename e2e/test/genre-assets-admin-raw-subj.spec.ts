// genre-assets-admin-raw-subj.spec.ts —— raw and subjectivity can also carry files
// **on the panel**.
//
// The asset entry point for wiki / output was built first (genre-assets-admin.spec.ts);
// the other two genres had nothing at the time: raw could only be stared at helplessly
// after dumping, and subjectivity had **no panel screen at all** — the only way for the
// owner to know what they'd written was to ask the AI.
//
// The two panels are **identical**, and must stay identical — subjectivity isn't a
// special case, it's just the fourth genre: the same CorpusEntryForm, the same asset
// area, the same `/corpus/{genre}` route.
//
// (It was once written read-only: that op carried an fp.Only(..., "mcp"), with a
// reasoning comment that "the self-model gets written out while thinking, not filled
// into a form." That was **a preference written into code**, not a product decision —
// the owner said it should work like every other genre. So this spec also pins that
// down: the panel can create it, and can edit it.)

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

// A valid 1×1 PNG. **Real bytes** — the backend checks the declared type against the
// byte signature, and an empty file just named .png would correctly be rejected, which
// would turn this into a test of the rejection path instead.
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
    // subjectivity can only be written by the AI — so the seed data also goes through
    // MCP, which is the owner's real path.
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
    // After saving, wait for the form to **close itself** before reopening it.
    // `raw-edit-{id}` is a toggle button: clicking it while the save request is still
    // in flight closes the form that's still open — so the body can't be found below,
    // and it times out. The form disappearing is the signal that this row saved
    // (onDone only fires on the save's return trip), and crucially it identifies
    // **which row** — more reliable than waiting on a generic toast.
    await expect(page.getByTestId(prefix)).toBeHidden({ timeout: 15_000 });
    await page.getByTestId(`raw-edit-${id}`).click();
    await expect(page.getByTestId(`raw-edit-body-${id}`))
      .toHaveValue(new RegExp(`standmeet-asset:${assetID}`), { timeout: 15_000 });
  });

  test('subjectivity:面板上看得见、改得了、挂得上文件(跟别的 genre 一样)', async (
    { adminPage: page },
  ) => {
    await gotoAdminSection(page, 'subjectivity');

    // Before this page existed, subjectivity had no panel screen at all — the only way
    // for the owner to know what they'd written was to ask the AI.
    const row = page.getByTestId(`subjectivity-row-${subjectivityID}`);
    await expect(row, 'AI 写的那条在面板上看得见').toBeVisible({ timeout: 10_000 });
    await expect(row).toContainText('How I judge a system');

    // What this toggle **says**, not just whether it exists. This used to be just a
    // .click(): the button existed, was clickable, and the assertion passed — which is
    // why in the real 2026-08-07 environment it printed
    // `ADMINCORPUS.COMMON.EDIT` (an unresolved i18n key) across 17 rows while this spec
    // stayed green the whole time (F-L-15). An existence assertion can't prove the
    // content is correct.
    const editToggle = page.getByTestId(`subjectivity-edit-${subjectivityID}`);
    await expect(editToggle, '开关上写的是 EDIT,不是翻译 key').toHaveText(/^edit$/i);
    await editToggle.click();
    await expect(editToggle, '展开之后它变成 CANCEL').toHaveText(/^cancel$/i);
    const prefix = `subjectivity-edit-form-${subjectivityID}`;
    await expect(page.getByTestId(`subjectivity-edit-loaded-${subjectivityID}`))
      .toBeVisible({ timeout: 15_000 });

    // Attach a file + insert into the body — **the exact same set of actions as
    // wiki / output**.
    const assetID = await attachOne(page, prefix, 'diagram.png');
    await page.getByTestId(`${prefix}-asset-insert-${assetID}`).click();
    await expect(page.getByTestId(`${prefix}-body`))
      .toHaveValue(new RegExp(`standmeet-asset:${assetID}`));

    // It can be edited, and the edit persists — this pins down "the panel can write
    // subjectivity".
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

// dumpRaw —— dumps one entry into the dump box and returns its id (pulled from the
// row's testid — from **the page itself**, because what this spec is proving is that
// the row really got rendered).
async function dumpRaw(page: Page, body: string): Promise<string> {
  await page.getByTestId('dump-input').fill(body);
  // Click the dump button by role + text — Btn deliberately doesn't expose a
  // data-testid (test concerns shouldn't grow into a shared component's API); the
  // existing admin-raw-crud clicks it the same way.
  await page.getByRole('button', { name: /dump/i }).click();
  const row = page.locator('[data-testid^="raw-row-"]').filter({ hasText: body }).first();
  await expect(row).toBeVisible({ timeout: 15_000 });
  const testid = await row.getAttribute('data-testid');
  const id = (testid ?? '').replace('raw-row-', '');
  expect(id, '拿到了刚倒那条的 id').not.toBe('');
  return id;
}

// attachOne —— picks a file in the asset area, asserts that row rendered (filename +
// **real byte count**), and returns its asset id. The id is pulled from **the row on
// the page**, not from an API response — what these tests are proving is that it
// rendered.
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
