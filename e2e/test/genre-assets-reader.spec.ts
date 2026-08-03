// genre-assets-reader.spec.ts —— **访客在页面上真的看见那张图**。
//
// 端 = 用户真的会用的东西。owner 的端是 MCP（他在 Claude Code 里说"把这张图配到那条 wiki
// 上"），访客的端是**浏览器**。`POST /api/v1/sessions/{id}/tools/corpus_read` 不是端 ——
// 没有访客会发那个 POST，发它的是页面里的 JS。从那儿断言，等于从访客那一侧的中间插进去。
//
// 这条差别不是洁癖：素材的泄漏**发生在渲染层**。文件名、缩略图、渲不出来的破图位，
// 任何一个漏出去都算，而它们在 JSON 里一个都看不见。所以"越权访客拿不到素材"这条
// 必须在页面上断。
//
// 建这条 spec 的同时补上了它要验的那个面：wiki/output 的 reader 以前**不解析**正文里的
// `standmeet-asset:<id>`（只有 writings 那条路解析），后端 landing 也不返 asset_urls。
// 于是后端全绿、30 条 e2e 全绿，而访客页面上什么都没有。

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
let assetID: string;
let coverAssetID: string;
let attachmentID: string;
let outputPath = '';
let outputInlineID = '';
let outputCoverID = '';
let outputDocID = '';

const COVER_LINE = 'the line laid over the hero';
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

    // 两张码:一张授这条 wiki,一张不授。
    await issueCode(request, IN_CODE, ['wiki://**'], 'inscope');
    await issueCode(request, OUT_CODE, ['output://**'], 'outscope');
    await request.dispose();
  });

  test('授了这条的访客:图渲在页面上,src 指向真实素材', async ({ page }) => {
    await enterCodeSession(page, IN_CODE, 'Reader');
    await goto(page, `/wiki/${entryPath}`);
    await expect(page.getByTestId('wiki-body')).toBeVisible({ timeout: 8_000 });

    // 正文里那条 standmeet-asset URI 被换成了可访问地址 —— 图真的挂上去了。
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

    // hero 以前**只有**色板那一支:owner 通过 MCP 设了 cover_image_asset_id,访客这边
    // 照样是按 slug hash 生成的一块颜色 —— 而且看不出哪里不对,它本来就长得像个封面。
    const img = page.getByTestId('wiki-cover-image').locator('img');
    await expect(img, '封面图真的挂上去了').toBeVisible({ timeout: 8_000 });
    expect(await img.getAttribute('src') ?? '', '指向那份素材').toContain(coverAssetID);
    // headline 也来自 owner 设的那句,而不是从标题里切出来的。
    await expect(page.getByTestId('wiki-cover')).toContainText(COVER_LINE);
  });

  test('附件渲成下载区:文件名 + 真实字节数 + 可下载的地址', async ({ page }) => {
    await enterCodeSession(page, IN_CODE, 'Reader');
    await goto(page, `/wiki/${entryPath}`);

    const box = page.getByTestId('wiki-attachments');
    await expect(box, '有附件就该有下载区').toBeVisible({ timeout: 8_000 });
    // 附件行的 testid 是 `corpus-attachment-<id>` —— 那一行由 CorpusMedia 渲,
    // wiki 和 output 共用同一份组件,所以 testid 里不带 genre。
    const link = page.getByTestId(`corpus-attachment-${attachmentID}`);
    await expect(link, '文件名').toHaveText('paper.pdf');
    await expect(link, 'href 指向那份素材').toHaveAttribute('href', new RegExp(attachmentID));
    await expect(link, '点了是下载,不是在页面里打开').toHaveAttribute('download', 'paper.pdf');
    // 大小要是**真实字节数**。写死一句"下载"的话,一份 40 页的 PDF 和一张截图长得一样。
    await expect(box, '说的是真实大小').toContainText(/\d+(\.\d+)?\s?(B|KB|MB)/);
    // 图片不该混进下载区 —— 它属于正文。
    await expect(box, '只列 attachment').not.toContainText('pixel.png');
  });

  // 要害那条:越权访客**在页面上**一点痕迹都不该有。JSON 里断"数组长度 0"看不见
  // 文件名、缩略图、破图位这些渲染层的泄漏。
  test('没授这条的访客:页面上没有图,也没有素材的任何痕迹', async ({ page }) => {
    await enterCodeSession(page, OUT_CODE, 'Outsider');
    await goto(page, `/wiki/${entryPath}`);

    // **先正向断言"他被拦住了"**。只断"没有 img"是不够的:页面 404、组件改名、路由挂掉时
    // 元素同样不存在,那条断言照样绿 —— 一条在功能坏掉时也会通过的断言不提供信息。
    await expect(page.getByTestId('wiki-locked'), '访客确实被拦在门外')
      .toBeVisible({ timeout: 8_000 });
    await expect(page.locator('img'), '整页一张图都不该有').toHaveCount(0);
    const html = await page.content();
    expect(html, '连素材 id 都不该出现在页面里').not.toContain(assetID);
    expect(html, '也不该漏出文件名').not.toContain('pixel.png');
  });
});

// output 那条 reader 一度**一行素材都没接**:landing 只回 5 个字段,连 asset_urls 都没有。
// 而 SDK 里那句注释写着"结构跟 WikiLandingView 一致" —— 描述的是意图,不是结果。
// 于是访客读一条 output:正文里的图是空位、owner 设的封面到不了前端、附件没有下载区,
// 而且**一个报错都没有**。
//
// output 的落地页是**公开**的(published 的 SEO 页),所以这一组不需要码。
test.describe('output 的 reader 也渲素材', () => {
  test('正文图 + 封面 + 附件', async ({ page }) => {
    await goto(page, `/output/${outputPath}`);
    await expect(page.getByTestId('output-landing')).toBeVisible({ timeout: 8_000 });

    const img = page.getByTestId('output-body').locator('img').first();
    await expect(img, '正文里的图渲在页面上').toBeVisible({ timeout: 8_000 });
    const src = await img.getAttribute('src');
    expect(src ?? '', 'src 不是渲不出来的 URI').not.toContain('standmeet-asset:');
    expect(src ?? '', 'src 指向那份素材').toContain(outputInlineID);

    // 封面:owner 设的那张图,不是原来那块纯底色。
    const cover = page.getByTestId('output-cover-image').locator('img');
    await expect(cover, '封面图挂上去了').toBeVisible({ timeout: 8_000 });
    expect(await cover.getAttribute('src') ?? '').toContain(outputCoverID);
    await expect(page.getByTestId('output-cover-headline')).toHaveText(COVER_LINE);

    // 附件:文件名 + 真实字节数 + 可下载。
    const link = page.getByTestId(`corpus-attachment-${outputDocID}`);
    await expect(link).toHaveText('spec.pdf');
    await expect(link).toHaveAttribute('download', 'spec.pdf');
    await expect(page.getByTestId('output-attachments'))
      .toContainText(/\d+(\.\d+)?\s?(B|KB|MB)/);
  });

});

// seedIllustratedNote —— 一条 wiki,身上挂三份素材:正文里的配图、hero 封面、一份 PDF 附件。
//
// 三份挂在**同一条**上是刻意的:正文 / hero / 下载区这三个渲染位读的是同一份素材表。
// 分成三条语料建,渲串位(附件出现在正文、封面挂错一份)就看不出来了。
// owner 侧全走 MCP —— 那是 owner 真实的用法。
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
}

// seedIllustratedOutput —— 一条**已发布**的 output,同样挂三份素材。
// 发布是必须的:output 的落地页是公开的 SEO 页,没发布的读不到。
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
  });
  // 发布 —— output 的落地页是**公开**的,没发布读不到。发布没有 MCP op(它是面板
  // SEO 面上的开关),所以这一步走 admin 路由。
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
