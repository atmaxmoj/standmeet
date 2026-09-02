// genre-assets-admin.spec.ts —— **the owner can genuinely attach a file from the panel**.
//
// This spec exists because the surface it verifies didn't previously exist:
// since 2026-07 the backend lets every genre carry assets, the visitor reading
// page renders them, and 30 e2e cases are all green — yet the owner had no
// entry point at all on /admin/wiki. The only thing anywhere near "attach a
// file" was a span in the raw dump box reading "attach media": it had
// cursor-pointer, a hover color change, and no onClick.
//
// So this doesn't go through MCP, and it doesn't go through REST either. The
// owner has two entry points, MCP and the panel; MCP already has coverage, and
// what's missing is exactly **the panel**. Uploads go through the browser's
// real file picker (setInputFiles); the file bytes are constructed right here.

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

// PNG_BYTES —— a valid 1×1 PNG. **Real bytes**, not an empty file named .png:
// the backend checks the declared type against the byte signature, a fake one
// gets correctly rejected, and then this test would just be testing the
// rejection path instead.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

// PDF_BYTES —— a minimal **real** PDF (`%PDF-` signature + trailer). Same
// reasoning as PNG_BYTES: the backend checks the declared type against the
// byte signature, an empty file named .pdf gets correctly rejected.
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

    // Before attaching anything: the assets area is present, and clearly says "none yet".
    await expect(page.getByTestId(`${prefix}-assets`)).toBeVisible();
    await expect(page.getByTestId(`${prefix}-assets-empty`)).toBeVisible();

    await page.getByTestId(`${prefix}-asset-input`).setInputFiles({
      name: 'panel-pixel.png', mimeType: 'image/png', buffer: PNG_BYTES,
    });

    // The receipt must say **which one** went up: filename + real byte count. The word "uploaded" is not a receipt.
    const row = page.getByTestId(new RegExp(`^${prefix}-asset-row-`));
    await expect(row).toHaveCount(1, { timeout: 15_000 });
    await expect(row).toContainText('panel-pixel.png');
    await expect(row, '说的是真实大小,不是一句"已上传"')
      .toContainText(`${String(PNG_BYTES.length)} B`);

    // Insert into the body: a stable asset URI appears in the body (not an expiring pre-signed URL).
    const assetID = await firstAssetID(page, prefix);
    await page.getByTestId(`${prefix}-asset-insert-${assetID}`).click();
    const body = page.getByTestId(`${prefix}-body`);
    await expect(body).toHaveValue(new RegExp(`standmeet-asset:${assetID}`));
    await expect(body, '正文里不该是会过期的预签名地址').not.toHaveValue(/X-Amz-|\?token=/);

    // Save it, reopen it, and it's still there — without persistence, all of this is just an on-screen appearance.
    await page.getByTestId(`${prefix}-submit`).click();
    await page.getByTestId(`wiki-edit-${id}`).click();
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`${prefix}-body`))
      .toHaveValue(new RegExp(`standmeet-asset:${assetID}`), { timeout: 15_000 });
    await expect(page.getByTestId(new RegExp(`^${prefix}-asset-row-`))).toHaveCount(1);
  });

  // The category selector must **actually work** (F-L-48).
  //
  // The panel offers two categories, image / attachment, and PDF is only
  // accepted under attachment (the media guard whitelists by kind). Before
  // this case, every case in this section uploaded an image using the default
  // category — **nobody had ever touched that dropdown** — so whether
  // "selecting attachment" did anything had never actually been asked. It
  // shows the moment you ask it on a real instance: the dropdown displays
  // attachment, but the request's kind is empty, and the backend replies
  // *"content-type application/pdf is not accepted for image"*. The owner can
  // never attach a PDF from the panel — and the attachment category exists
  // for exactly this ([[test-covers-capability-not-face]]: the MCP path
  // passes kind correctly, so everything there is green).
  test('选 attachment 类别 → PDF 挂得上（那个下拉框不是装饰）', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'wiki');

    const id = await createWikiEntry(page, 'Panel attach a PDF');
    const prefix = `wiki-edit-form-${id}`;
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });

    await page.getByTestId(`${prefix}-asset-kind`).selectOption('attachment');
    await page.getByTestId(`${prefix}-asset-input`).setInputFiles({
      name: 'panel-doc.pdf', mimeType: 'application/pdf', buffer: PDF_BYTES,
    });

    // The criterion is **that row appears**, not "no error was thrown": if it were rejected, the row simply wouldn't exist.
    const row = page.getByTestId(new RegExp(`^${prefix}-asset-row-`));
    await expect(row, 'attachment 类别选了就得算数 —— 否则 PDF 会被当成图片拒掉')
      .toHaveCount(1, { timeout: 15_000 });
    await expect(row).toContainText('panel-doc.pdf');
    await expect(row).toContainText(`${String(PDF_BYTES.length)} B`);
    // What's persisted must also be attachment: stored as image instead, the reading page would try to render it rather than offer a download link.
    await expect(row).toContainText('attachment');

    // **And this row should not offer "set as cover"** (F-L-58). The cover is a
    // hero **image**, and a PDF cannot be one. On a real instance, clicking it
    // anyway is accepted without complaint: a vermillion `cover` badge appears
    // on the row, the button flips to `stop using as cover`, and COVER LINE
    // follows right after (overlaying a headline sentence onto a PDF) — not a
    // single word of pushback.
    //
    // The root cause lives in the same file: `assetMarkdown` **branches by
    // kind** (image → `![]()`, attachment → `[]()`), while `BodyBoundBtns`
    // renders the cover toggle **unconditionally**. On the same screen, one
    // button knows the type, the other doesn't.
    const assetID = (await row.getAttribute('data-testid'))?.replace(`${prefix}-asset-row-`, '');
    await expect(
      page.getByTestId(`${prefix}-asset-cover-${assetID}`),
      '一份 PDF 当不了 hero 图 —— 这颗按钮不该出现在附件行上',
    ).toHaveCount(0);
    // Reverse self-check: **it must still be present on the image row**.
    // Otherwise "gated by kind" would degenerate into "gone for everyone", and
    // this assertion would still pass green ([[assertion-that-cannot-fail]]).
    await page.getByTestId(`${prefix}-asset-kind`).selectOption('image');
    await page.getByTestId(`${prefix}-asset-input`).setInputFiles({
      name: 'panel-pic.png', mimeType: 'image/png', buffer: PNG_BYTES,
    });
    await expect(page.getByTestId(new RegExp(`^${prefix}-asset-row-`))).toHaveCount(2, {
      timeout: 15_000,
    });
    await expect(
      page.getByTestId(new RegExp(`^${prefix}-asset-cover-`)),
      '图片行上「设为封面」必须还在',
    ).toHaveCount(1);
  });

});

// Removing an asset: the row on the panel disappearing isn't the whole job —
// **the reference in the body** is the half visitors actually see (F-L-50).
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
    // **Insert it into the body first**: the cost of removing an asset isn't
    // on the panel, it's the reference left behind in the body (F-L-50: a
    // broken image + internal filename on the visitor page, invisible to the owner).
    await page.getByTestId(`${prefix}-asset-insert-${assetID}`).click();
    await expect(page.getByTestId(`${prefix}-body`))
      .toHaveValue(new RegExp(`standmeet-asset:${assetID}`));

    await page.getByTestId(`${prefix}-asset-remove-${assetID}`).click();
    await expect(page.getByTestId(new RegExp(`^${prefix}-asset-row-`)))
      .toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId(`${prefix}-assets-empty`)).toBeVisible();
    // Removing an asset = removing the reference in the body along with it. Leaving it behind means "one click was supposed to do two things and only did one".
    await expect(page.getByTestId(`${prefix}-body`), '正文里那条引用跟着走')
      .not.toHaveValue(new RegExp(`standmeet-asset:${assetID}`));
  });

  // F-L-51: **insert it, then remove it, and the body must return byte-for-byte to what it was.**
  //
  // Measured in prod (the real vault's cognitive-science note): 3240 → insert
  // → 3311 → remove → 3239/3241, not once across three runs did it return to
  // the original text. The root cause is in the **insert** half:
  // `appendBlock` runs `replace(/\s+$/,'')` before doing its work, trimming
  // off the body's trailing whitespace, so that newline never grows back — no
  // matter how the removal half tries to clean up, it can't restore it.
  //
  // This guard didn't exist before, and it **can only be asked with a
  // byte-for-byte comparison**: the existing assertion only checks "the
  // reference is gone", and stays green even with the body missing a trailing
  // byte. To the owner this looks like "I undid my own action, and my note got
  // changed anyway" — and these notes are the mirror of their vault.
  test('插进正文再撤下来:正文逐字回到原样(连末尾那个换行)', async ({ adminPage: page }) => {
    await gotoAdminSection(page, 'wiki');
    const id = await createWikiEntry(page, 'Round trip note');
    const prefix = `wiki-edit-form-${id}`;
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });

    // **Leave a trailing newline**: a real note looks exactly like this (any
    // editor's save leaves one), and this is exactly the byte that gets trimmed off.
    const body = page.getByTestId(`${prefix}-body`);
    const original = 'A paragraph that ends the note.\n';
    await body.fill(original);

    await page.getByTestId(`${prefix}-asset-input`).setInputFiles({
      name: 'roundtrip.png', mimeType: 'image/png', buffer: PNG_BYTES,
    });
    await expect(page.getByTestId(new RegExp(`^${prefix}-asset-row-`)))
      .toHaveCount(1, { timeout: 15_000 });
    const assetID = await firstAssetID(page, prefix);

    await page.getByTestId(`${prefix}-asset-insert-${assetID}`).click();
    await expect(body).toHaveValue(new RegExp(`standmeet-asset:${assetID}`));

    await page.getByTestId(`${prefix}-asset-remove-${assetID}`).click();
    await expect(page.getByTestId(`${prefix}-assets-empty`)).toBeVisible({ timeout: 15_000 });

    // Byte-for-byte comparison, not regex: the difference is exactly one byte, and a regex match can't tell them apart.
    expect(
      await body.inputValue(),
      '插入再撤下之后正文必须跟原来一模一样 —— owner 撤销了自己的操作，笔记不该被改过',
    ).toBe(original);
  });
});

// A hero is **three things**: the image + the headline sentence overlaid on
// it + the hue. If the panel only handled the image, then after setting a
// cover the owner would see the title get promoted into a headline with no
// way to change it — short of going to an AI client and calling MCP. The
// visitor side renders all three (genre-assets-reader asserts specifically
// that the headline sentence renders).
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

    // Reopen it: all three came back filled in — **failing to refill would
    // tell the owner "this was never set"**, so saving again they'd think
    // nothing changed, when in reality nothing was sent (an empty string isn't
    // sent), or worse: if that ever changes to send an empty string, it would wipe it out.
    await page.getByTestId(`wiki-edit-${id}`).click();
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`${prefix}-cover-headline`))
      .toHaveValue('a line over the cover', { timeout: 15_000 });
    await expect(page.getByTestId(`${prefix}-cover-hue`)).toHaveValue('violet');
    // Find the marker by testid, not by text — the "use as cover" button's own
    // copy on the same row also contains the word cover, so asserting by text
    // would stay green even after the cover is removed ([[assertion-that-cannot-fail]]).
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

    // Declares image/png, but the bytes are actually SVG — persisting this and then serving it from our own domain is a stored XSS.
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

// Being able to set it isn't enough — **being able to unset it is what makes
// it the owner's call** (F-L-38(a)). The comment on the test above already
// named this trap ("an empty string isn't sent … if that ever changes to send
// an empty string, it would wipe it out"), and it describes exactly the state
// at the time: all three went in but never came back out. Verified in prod:
// select hue as violet and save, select it back to `— default —` and save,
// reopen and it's still violet. The owner has no way to undo it, while the UI
// looks like it was their choice.
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

    // Precondition: all three are genuinely set — otherwise the "unset" below might be unsetting something that was already empty.
    await page.getByTestId(`wiki-edit-${id}`).click();
    await expect(page.getByTestId(`wiki-edit-loaded-${id}`)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(`${prefix}-cover-hue`)).toHaveValue('violet', { timeout: 15_000 });

    // Unset: each of the three returns to empty its own way — clear out the
    // headline sentence, select the hue back to `— default —`, and click the
    // cover button again (it now reads "unset cover").
    await page.getByTestId(`${prefix}-asset-cover-${assetID}`).click();
    await page.getByTestId(`${prefix}-cover-headline`).fill('');
    await page.getByTestId(`${prefix}-cover-hue`).selectOption('');
    await page.getByTestId(`${prefix}-submit`).click();

    // Reopen it: all three are empty. **What's asserted here is the value read
    // back after persistence**, not what's still sitting unsubmitted on
    // screen — the form's own state is already empty the instant Save is
    // clicked, which proves nothing about whether the server actually received "cleared".
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

// createWikiEntry —— creates a new wiki entry on the panel and expands its edit form, returning its id.
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

// firstAssetID —— extracts the asset id from the asset row's testid. Taken
// from **the page**, not an API response: what this spec has to prove is that this row actually rendered.
async function firstAssetID(
  page: Page,prefix: string,
): Promise<string> {
  const testid = await page.getByTestId(new RegExp(`^${prefix}-asset-row-`))
    .first().getAttribute('data-testid');
  return (testid ?? '').replace(`${prefix}-asset-row-`, '');
}
