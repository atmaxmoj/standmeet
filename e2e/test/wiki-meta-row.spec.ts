// wiki-meta-row.spec.ts —— wiki reader 顶部那一段:meta 行 + hero。
//
// meta 行:W3/F1 暴露 sources_count(「N corpus sources」、breadcrumb「N sources cited」)。
//
// hero:owner 设的**三件套**(图 + 压在图上那句 + 色调)在**已发布**的笔记上渲得出来,
// 而**没设 hero 的笔记什么都不渲**(corpus-media check 4 的 Expected 逐字写了两遍)。
// 「已发布」是这条 spec 的要害:发布了的笔记走 SSR 那条路(匿名可读),没发布的才走
// 带 token 的客户端重取 —— 素材类断言原先只在后者上跑过(genre-assets-reader 全程带码,
// 且那条笔记没发布),前者一次都没被看过。
//
// 两条笔记:
//   lonely-note —— 无 tag、无 hero,从 1 条 raw 提炼 → sources_count=1。
//   covered-note —— 无 tag,但挂了封面图 + headline + hue,正文里还有一张配图。

import { test, expect } from '@/fixtures/test';
import type { APIRequestContext } from '@playwright/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { initMCP, callTool } from '@/fixtures/mcp';
import { publishEntry, seedWiki } from '@/fixtures/corpus';
import { MEDIA, uploadAsset } from '@/fixtures/genre-assets';
import { goto } from '@/fixtures/navigate';

const OWNER = {
  email: 'metarow@example.com', password: 'correct-horse-battery-staple',
  handle: 'metarow', fullName: 'Meta Row Owner',
};
const PATH = 'lonely-note';
const COVERED_PATH = 'covered-note';
const COVER_LINE = 'the line the owner wrote over the picture';
// hue —— owner 在 hero 编辑器里选的那一个。**不是** slug 哈希出来的那一个:
// 这条断言存在的理由就是那次哈希把 owner 的选择顶掉了。
const HUE = 'acid';

let mcpToken = '';
let coverAssetID = '';
let inlineAssetID = '';

test.describe('W3/F1 wiki reader head: meta row + hero', () => {
  test.beforeAll(async ({ playwright }) => {
    resetInstance();
    const request = await playwright.request.newContext();
    await claim(request, findSetupToken(), {
      email: OWNER.email, password: OWNER.password,
      handle: OWNER.handle, fullName: OWNER.fullName,
    });
    const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
    mcpToken = await createAPIToken(request, csrf, 'metarow-seed');
    const sid = await initMCP(request, mcpToken);
    // 无 tag,从 1 条 raw 提炼 → sources_count=1。
    const w = await seedWiki(request, mcpToken, sid, {
      title: 'Lonely Note', body: 'A standalone note with no tags.',
    });
    await publishEntry(request, mcpToken, sid, { genre: 'wiki', id: w.wikiID });

    await seedCoveredNote(request, sid);
    await request.dispose();
  });

  // **这条以前把重复钉死了**：它的名字逐字写着「meta row shows N corpus sources;
  // breadcrumb shows N sources cited」—— 于是同一个数在一屏上说两遍、还换了一套词
  // （UX-85），而任何想去重的改动都会撞红这条守卫，被记成「留给 owner 定」。
  // 守卫记录的是那份重复本身，不是产品要求（[[parked-test-carries-a-wrong-diagnosis]]）。
  //
  // 判据换成设计语言那一条：**一件事在一屏上只说一遍**。分工也定死：
  // 面包屑只回答「我在哪」，meta 行回答「这是什么、谁写的、什么时候、引了几条」。
  test('日期和来源数各只出现一次:面包屑只导航,meta 行讲这条笔记',
    async ({ page }) => {
      await goto(page, `/wiki/${PATH}`);
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('wiki-sources-count')).toHaveText('1 corpus sources');
      await expect(page.getByTestId('wiki-meta')).toContainText(OWNER.fullName);

      const crumb = page.getByTestId('wiki-breadcrumb');
      // 取文本再判 —— `.not.toContainText` 在元素还没出现时也算通过
      // （[[negated-assertion-passes-while-absent]]）。
      await expect(crumb).toBeVisible();
      const crumbText = await crumb.innerText();
      expect(crumbText, '来源数只在 meta 行说一次').not.toContain('sources');
      expect(crumbText, '日期只在 meta 行说一次').not.toMatch(/\d{4}/);
    });

  // 这条守的是**封面上那行小标的文案**:没有 tag 时它只写「wiki」,不再硬兜底成
  // 「corpus」。它原先挂在 lonely-note 上 —— 一条根本不该有封面的笔记 —— 于是顺带
  // 把「无 hero 也铺一块壳」钉成了既定行为(F-L-32)。它要守的东西在有封面的那条上
  // 一样成立,搬过来。
  test('cover with no tag shows just "wiki", not the hardcoded "corpus" fallback',
    async ({ page }) => {
      await goto(page, `/wiki/${COVERED_PATH}`);
      const cover = page.getByTestId('wiki-cover');
      await expect(cover).toBeVisible({ timeout: 5_000 });
      await expect(cover).not.toContainText('corpus');
    });

  test('没设 hero 的笔记不渲染空的 hero 壳', async ({ page }) => {
    await goto(page, `/wiki/${PATH}`);
    // 先确认页面真渲出来了 —— 不然「数到 0」只是因为什么都还没有。
    await expect(page.getByTestId('wiki-meta')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('wiki-meta')).toContainText('Lonely Note');
    await expect(
      page.getByTestId('wiki-cover'),
      'owner 没设封面 → 顶上不该有那块 21:9 的壳',
    ).toHaveCount(0);
  });

  test('已发布的笔记:owner 设的封面图 + 那句话渲得出来(SSR 那条路)', async ({ page }) => {
    await goto(page, `/wiki/${COVERED_PATH}`);
    const img = page.getByTestId('wiki-cover-image').locator('img');
    await expect(img, '封面图挂上去了').toBeVisible({ timeout: 8_000 });
    expect(await img.getAttribute('src') ?? '', '指向那份素材').toContain(coverAssetID);
    await expect(page.getByTestId('wiki-cover'), 'owner 写的那句话').toContainText(COVER_LINE);
  });

  test('已发布的笔记:正文里的配图也换成了真地址', async ({ page }) => {
    await goto(page, `/wiki/${COVERED_PATH}`);
    const img = page.getByTestId('wiki-body').locator('img').first();
    await expect(img, '正文配图渲在页面上').toBeVisible({ timeout: 8_000 });
    const src = await img.getAttribute('src') ?? '';
    expect(src, 'src 不是渲不出来的 standmeet-asset URI').not.toContain('standmeet-asset:');
    expect(src, 'src 指向那份素材').toContain(inlineAssetID);
  });

  test('渲出来的是 owner 选的那个色调,不是按 slug 哈希出来的', async ({ page }) => {
    await goto(page, `/wiki/${COVERED_PATH}`);
    const cover = page.getByTestId('wiki-cover');
    await expect(cover).toBeVisible({ timeout: 5_000 });
    // data-hue 就是上色的机制本身(CSS 按属性选择器出渐变),不是一个只给测试看的标记。
    await expect(cover, 'owner 选了 acid').toHaveAttribute('data-hue', HUE);
  });
});

// seedCoveredNote —— owner 把 hero 三件套都设上,正文里再插一张图,然后**发布**它。
// 发布是要害:公开那条路(SSR)跟带 token 重取那条路是两套装配,而素材类断言以前只在后者上跑过。
async function seedCoveredNote(request: APIRequestContext, sid: string): Promise<void> {
  const c = await seedWiki(request, mcpToken, sid, {
    title: 'Covered Note', body: 'A note the owner gave a cover.',
  });
  const s = { request, token: mcpToken, sid };
  const cover = await uploadAsset(s, 'wiki', c.wikiID, MEDIA.webp, { filename: 'cover.webp' });
  coverAssetID = cover.asset_id;
  const inline = await uploadAsset(s, 'wiki', c.wikiID, MEDIA.pixel, { filename: 'inline.png' });
  inlineAssetID = inline.asset_id;
  await callTool(request, mcpToken, sid, 'corpus.update', {
    genre: 'wiki', id: c.wikiID, title: 'Covered Note',
    body: `here it is: ![pixel](standmeet-asset:${inline.asset_id})`,
    cover_image_asset_id: cover.asset_id,
    cover_headline: COVER_LINE,
    cover_hue: HUE,
  });
  await publishEntry(request, mcpToken, sid, { genre: 'wiki', id: c.wikiID });
}
