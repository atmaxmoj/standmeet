// genre-assets-reader.spec.ts — **the visitor actually sees the image on the page**.
//
// A surface = something a real user actually uses. The owner's surface is MCP (they
// tell Claude Code "attach this image to that wiki entry"); the visitor's surface is
// **the browser**. `POST /api/v1/sessions/{id}/tools/corpus_read` is not a surface —
// no visitor ever sends that POST, the page's own JS does. Asserting from there is
// asserting from somewhere in the middle of the visitor's own path.
//
// This distinction isn't fussiness: asset leaks **happen at the rendering layer**.
// A filename, a thumbnail, a broken-image glyph that fails to render — any of these
// leaking is a real leak, and none of them are visible in JSON. So "an out-of-scope
// visitor cannot get the asset" has to be asserted on the page.
//
// Building this spec also fills in the surface it verifies: the wiki/output readers
// previously **did not parse** `standmeet-asset:<id>` in the body (only the writings
// path parsed it), and the backend landing didn't return asset_urls either. So the
// backend was all green, all 30 e2e cases were green, and the visitor's page had
// nothing on it.

import type { APIRequestContext } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { createCode } from '@/fixtures/codes';
import { MEDIA, createEntry, uploadAsset, getEntry } from '@/fixtures/genre-assets';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';
import { enterCodeSession, goto } from '@/fixtures/navigate';
import { createRole } from '@/fixtures/roles';

const OWNER = {
  email: 'assets-reader@example.com', password: 'correct-horse-battery-staple',
  handle: 'assetsreader', fullName: 'Assets Reader Owner',
};
const IN_CODE = 'ASSETREAD-IN';
const OUT_CODE = 'ASSETREAD-OUT';

interface MCPSession { request: APIRequestContext; token: string; sid: string }
let s: MCPSession;
let csrf: string;
let entryPath: string;
// A note whose body references "an asset that no longer exists" (F-L-50). Seeded in
// beforeAll — building it inside a test body would need the request context that has
// already been closed by then.
let danglingPath: string;
let assetID: string;
let coverAssetID: string;
let attachmentID: string;
let outputPath = '';
let outputInlineID = '';
let outputCoverID = '';
let outputDocID = '';

const COVER_LINE = 'the line laid over the hero';
// OUTPUT_HUE — the one the owner picked in the hero editor. **Not** the one derived
// from code.
const OUTPUT_HUE = 'violet';
const BACKEND = process.env['BACKEND_URL'] ?? 'http://localhost:8000';

test.describe('访客在页面上看得见素材（可见性纯继承文章）', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), OWNER);
    ({ csrf } = await loginAPI(request, OWNER.email, OWNER.password));
    const token = await createAPIToken(request, csrf, 'assets-reader-token');
    s = { request, token, sid: await initMCP(request, token) };

    await seedIllustratedNote();
    await seedIllustratedOutput();

    // Two codes: one grants this wiki entry, one doesn't.
    await issueCode(request, IN_CODE, ['wiki://**'], 'inscope');
    await issueCode(request, OUT_CODE, ['output://**'], 'outscope');
    await request.dispose();
  });

  test('授了这条的访客:图渲在页面上,src 指向真实素材', async ({ page }) => {
    await enterCodeSession(page, IN_CODE, 'Reader');
    await goto(page, `/wiki/${entryPath}`);
    await expect(page.getByTestId('wiki-body')).toBeVisible({ timeout: 8_000 });

    // The standmeet-asset URI in the body has been swapped for a reachable URL — the
    // image is really attached.
    const img = page.getByTestId('wiki-body').locator('img').first();
    await expect(img, '图渲在页面上').toBeVisible({ timeout: 8_000 });
    const src = await img.getAttribute('src');
    expect(src ?? '', 'src 不是渲不出来的 standmeet-asset URI').not.toContain('standmeet-asset:');
    expect(src ?? '', 'src 指向那份素材').toContain(assetID);
  });

  test('owner 设的封面图渲在 hero 上,不是那块程序生成的色板', async ({ page }) => {
    await enterCodeSession(page, IN_CODE, 'Reader');
    await goto(page, `/wiki/${entryPath}`);
    await expect(page.getByTestId('wiki-cover')).toBeVisible({ timeout: 8_000 });

    // The hero used to have **only** the color-swatch branch: the owner sets
    // cover_image_asset_id via MCP, and the visitor still gets a color generated from
    // a slug hash — and there's no way to tell it's wrong, since it already looks
    // like a cover.
    const img = page.getByTestId('wiki-cover-image').locator('img');
    await expect(img, '封面图真的挂上去了').toBeVisible({ timeout: 8_000 });
    expect(await img.getAttribute('src') ?? '', '指向那份素材').toContain(coverAssetID);
    // The headline also comes from the line the owner set, not sliced out of the
    // title.
    await expect(page.getByTestId('wiki-cover')).toContainText(COVER_LINE);
  });

  test('附件渲成下载区:文件名 + 真实字节数 + 可下载的地址', async ({ page }) => {
    await enterCodeSession(page, IN_CODE, 'Reader');
    await goto(page, `/wiki/${entryPath}`);

    const box = page.getByTestId('wiki-attachments');
    await expect(box, '有附件就该有下载区').toBeVisible({ timeout: 8_000 });
    // The attachment row's testid is `corpus-attachment-<id>` — that row is rendered
    // by CorpusMedia, and wiki and output share the same component, so the testid
    // carries no genre.
    const link = page.getByTestId(`corpus-attachment-${attachmentID}`);
    await expect(link, '文件名').toHaveText('paper.pdf');
    await expect(link, 'href 指向那份素材').toHaveAttribute('href', new RegExp(attachmentID));
    await expect(link, '点了是下载,不是在页面里打开').toHaveAttribute('download', 'paper.pdf');
    // The size must be the **actual byte count**. A hardcoded "download" label would
    // make a 40-page PDF look identical to a screenshot.
    await expect(box, '说的是真实大小').toContainText(/\d+(\.\d+)?\s?(B|KB|MB)/);
    // Images should not end up in the download area — they belong in the body.
    await expect(box, '只列 attachment').not.toContainText('pixel.png');
  });

  // The critical case: an out-of-scope visitor should have **zero trace on the page**.
  // Asserting "array length 0" in JSON can't see filename, thumbnail, or broken-image
  // leaks at the rendering layer.
  test('没授这条的访客:页面上没有图,也没有素材的任何痕迹', async ({ page }) => {
    await enterCodeSession(page, OUT_CODE, 'Outsider');
    await goto(page, `/wiki/${entryPath}`);

    // **Assert positively "they were blocked" first**. Asserting only "no img" isn't
    // enough: a 404 page, a renamed component, or a broken route would leave the
    // element equally absent, and that assertion would still pass — an assertion
    // that also passes when the feature is broken carries no information.
    await expect(page.getByTestId('wiki-locked'), '访客确实被拦在门外')
      .toBeVisible({ timeout: 8_000 });
    await expect(page.locator('img'), '整页一张图都不该有').toHaveCount(0);
    const html = await page.content();
    expect(html, '连素材 id 都不该出现在页面里').not.toContain(assetID);
    expect(html, '也不该漏出文件名').not.toContain('pixel.png');
  });

  // F-R-6 — blocking them is correct, **what it says** is not.
  //
  // This lock screen hardcodes *"The owner has restricted this entry. Enter an access
  // code on the gate to view the full content."* plus an `enter access code →`
  // control. But at this point the visitor **already has a code in hand** — the top
  // bar on the same screen reads `CODE · OUT-…`: the product is telling them to do
  // something they've already done, and offering it as the only next step.
  //
  // The backend **uniformly returns 404** for both out-of-scope and nonexistent
  // (that's correct: don't confirm existence), so the client can't distinguish the
  // two; but it can tell **whether a session exists**, and that's exactly what should
  // decide which message to show.
  test('手里有码的访客撞上读不到的条目:不该被要求再去输一次码', async ({ page }) => {
    await enterCodeSession(page, OUT_CODE, 'Outsider');
    await goto(page, `/wiki/${entryPath}`);
    const locked = page.getByTestId('wiki-locked');
    await expect(locked, '访客确实被拦在门外').toBeVisible({ timeout: 8_000 });

    const said = (await locked.innerText()).toLowerCase();
    expect(said, `他已经带着码进来了,却被告知 "${said.replace(/\s+/g, ' ').slice(0, 90)}"`)
      .not.toContain('enter an access code');
    expect(said, '要说的是"这张码够不到这一条",而不是"去输码"').toMatch(/code|scope/);
    // That CTA has to go too: a button that clicking does nothing is harder
    // to spot as wrong than a wrong sentence.
    await expect(
      locked.getByRole('link', { name: /enter access code/i }),
      '带着码的人不需要再去 gate 输一次码',
    ).toHaveCount(0);
  });
});

// F-L-50 — after the owner pulls an asset, the reference in the body **stays put**:
// the visitor's page is left with the browser's default broken-image glyph, with the
// internal filename printed right in the alt text (the real environment caught
// `harness-photo.jpg`).
//
// The criterion lives in **whether that thing is on the screen**, not "is the data
// clean": this defect's entire cost is at the rendering layer. Both halves are
// asserted: no broken-image glyph allowed (an img with its src stripped), and the
// filename must never be printed either — stripping only the URL would leave
// `![original filename]()`, handing the internal filename to the visitor, which is
// worse than the broken glyph.
test.describe('正文引着一份已经不在的素材', () => {
  test('什么都不渲:不给访客裂图，也不给内部文件名', async ({ page }) => {
    await enterCodeSession(page, IN_CODE, 'Reader');
    await goto(page, `/wiki/${danglingPath}`);
    const body = page.getByTestId('wiki-body');
    // Assert the body actually loaded first — otherwise the two assertions below
    // would also pass while the page is still empty
    // ([[negated-assertion-passes-while-absent]]).
    await expect(body, '正文渲出来了').toContainText('text after', { timeout: 8_000 });
    await expect(body.locator('img'), '解析不到的素材:一个 img 都不留').toHaveCount(0);
    await expect(body, '内部文件名不许出现在访客眼前')
      .not.toContainText('harness-photo.jpg');
  });
});

// The output reader at one point had **zero wiring for assets**: landing returned
// only 5 fields, not even asset_urls. And a comment in the SDK claimed "structure
// matches WikiLandingView" — describing the intent, not the actual result.
// So a visitor reading an output entry: the body's image slot is empty, the owner's
// cover never reaches the frontend, attachments have no download area, and
// **not a single error is raised**.
//
// The output landing page is **public** (a published SEO page), so this group needs
// no code.
test.describe('output 的 reader 也渲素材', () => {
  test('正文图 + 封面 + 附件', async ({ page }) => {
    await goto(page, `/output/${outputPath}`);
    await expect(page.getByTestId('output-landing')).toBeVisible({ timeout: 8_000 });

    const img = page.getByTestId('output-body').locator('img').first();
    await expect(img, '正文里的图渲在页面上').toBeVisible({ timeout: 8_000 });
    const src = await img.getAttribute('src');
    expect(src ?? '', 'src 不是渲不出来的 URI').not.toContain('standmeet-asset:');
    expect(src ?? '', 'src 指向那份素材').toContain(outputInlineID);

    // Cover: the image the owner set, not the original flat color.
    const cover = page.getByTestId('output-cover-image').locator('img');
    await expect(cover, '封面图挂上去了').toBeVisible({ timeout: 8_000 });
    expect(await cover.getAttribute('src') ?? '').toContain(outputCoverID);
    await expect(page.getByTestId('output-cover-headline')).toHaveText(COVER_LINE);

    // Attachment: filename + actual byte count + downloadable.
    const link = page.getByTestId(`corpus-attachment-${outputDocID}`);
    await expect(link).toHaveText('spec.pdf');
    await expect(link).toHaveAttribute('download', 'spec.pdf');
    await expect(page.getByTestId('output-attachments'))
      .toContainText(/\d+(\.\d+)?\s?(B|KB|MB)/);
  });

  // The hero is a **set of three** (image + the headline + the hue). The first two
  // are already asserted above; the third has never had a rendering slot on output:
  // the owner picks a hue, the backend stores and sends it, and the page always
  // shows the same flat color (F-L-34).
  test('owner 挑的色调也上到 hero 上', async ({ page }) => {
    await goto(page, `/output/${outputPath}`);
    const hero = page.getByTestId('output-cover');
    await expect(hero).toBeVisible({ timeout: 8_000 });
    // data-hue is the coloring mechanism itself (CSS produces the gradient via an
    // attribute selector), not a marker that exists only for tests to see.
    await expect(hero, 'owner 挑了 violet').toHaveAttribute('data-hue', OUTPUT_HUE);
  });

});

// seedIllustratedNote — one wiki entry carrying three assets: an inline image in the
// body, a hero cover, and a PDF attachment.
//
// Attaching all three to **the same entry** is deliberate: the body / hero /
// download-area rendering slots all read from the same asset table. Building them as
// three separate entries would hide a rendering-slot mixup (e.g. an attachment
// showing up in the body, or the cover wired to the wrong asset).
// The owner side goes entirely through MCP — that's the owner's real usage pattern.
async function seedIllustratedNote(): Promise<void> {
  const id = await createEntry(s, 'wiki', 'Illustrated note', 'before the image');
  const inline = await uploadAsset(s, 'wiki', id, MEDIA.pixel, { filename: 'pixel.png' });
  assetID = inline.asset_id;
  const cover = await uploadAsset(s, 'wiki', id, MEDIA.webp, { filename: 'cover.webp' });
  coverAssetID = cover.asset_id;
  const doc = await uploadAsset(s, 'wiki', id, MEDIA.pdf, {
    filename: 'paper.pdf', kind: 'attachment',
  });
  attachmentID = doc.asset_id;

  await callTool(s.request, s.token, s.sid, 'corpus.update', {
    genre: 'wiki', id, title: 'Illustrated note',
    body: `here it is: ![pixel](standmeet-asset:${inline.asset_id})`,
    cover_image_asset_id: cover.asset_id,
    cover_headline: COVER_LINE,
  });
  entryPath = (await getEntry(s, 'wiki', id)).path ?? '';
  await seedDanglingRef();
}

// seedDanglingRef — the body references an asset id that **never existed at all**.
// In the real environment this is what it looks like after "the owner pulled that
// asset, and the reference in the body stayed put" (F-L-50).
async function seedDanglingRef(): Promise<void> {
  const gone = '00000000-0000-4000-8000-0000000dead0';
  const id = await createEntry(s, 'wiki', 'Dangling ref note', 'text before');
  await callTool(s.request, s.token, s.sid, 'corpus.update', {
    genre: 'wiki', id, title: 'Dangling ref note',
    body: `text before\n\n![harness-photo.jpg](standmeet-asset:${gone})\n\ntext after`,
  });
  danglingPath = (await getEntry(s, 'wiki', id)).path ?? '';
}

// seedIllustratedOutput — one **published** output entry, also carrying three assets.
// Publishing is required: the output landing page is a public SEO page, and an
// unpublished entry cannot be read.
async function seedIllustratedOutput(): Promise<void> {
  const id = await createEntry(s, 'output', 'Illustrated output', 'before the image');
  const inline = await uploadAsset(s, 'output', id, MEDIA.pixel, { filename: 'shot.png' });
  outputInlineID = inline.asset_id;
  const cover = await uploadAsset(s, 'output', id, MEDIA.webp, { filename: 'ocover.webp' });
  outputCoverID = cover.asset_id;
  const doc = await uploadAsset(s, 'output', id, MEDIA.pdf, {
    filename: 'spec.pdf', kind: 'attachment',
  });
  outputDocID = doc.asset_id;

  await callTool(s.request, s.token, s.sid, 'corpus.update', {
    genre: 'output', id, title: 'Illustrated output',
    body: `here: ![shot](standmeet-asset:${inline.asset_id})`,
    cover_image_asset_id: cover.asset_id,
    cover_headline: COVER_LINE,
    cover_hue: OUTPUT_HUE,
  });
  // Publish — the output landing page is **public**, and an unpublished entry can't
  // be read. There is no MCP op for publishing (it's a toggle on the panel's SEO
  // tab), so this step goes through the admin route.
  const res = await s.request.patch(
    `${BACKEND}/api/admin/corpus/output/${id}/seo`,
    { headers: { 'X-Csrftoken': csrf }, data: { excerpt: '', published: true } },
  );
  expect(res.status(), '发布成功了才谈得上读').toBe(200);
  outputPath = (await getEntry(s, 'output', id)).path ?? '';
}

async function issueCode(
  request: APIRequestContext, code: string, uris: string[], label: string,
): Promise<void> {
  const role = await createRole(request, csrf, {
    name: `assets-reader-${label}`, description: 'scoped', corpus_uris: uris,
  });
  await createCode(request, csrf, { code, label, assumed_role_id: role.id });
}
