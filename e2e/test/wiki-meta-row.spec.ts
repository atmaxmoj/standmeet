// wiki-meta-row.spec.ts -- the section at the top of the wiki reader: the
// meta row + hero.
//
// Meta row: W3/F1 exposes sources_count ("N corpus sources", and the
// breadcrumb's "N sources cited").
//
// Hero: the owner-set **three-piece set** (image + the headline over it +
// hue) renders on a **published** note, and **a note with no hero set
// renders nothing at all** (corpus-media check 4's Expected wrote this
// twice, verbatim). "Published" is the crux of this spec: a published note
// goes through the SSR path (readable anonymously), while an unpublished one
// goes through a token-bearing client refetch instead -- asset-related
// assertions used to run only against the latter (genre-assets-reader always
// carries a code, and that note was never published), so the former was
// never once exercised.
//
// Two notes:
//   lonely-note -- no tag, no hero, distilled from 1 raw entry -> sources_count=1.
//   covered-note -- no tag, but carries a cover image + headline + hue, plus
//   an inline image in the body.

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
// hue -- the one the owner picked in the hero editor. **Not** the one
// derived from a slug hash: the whole reason this assertion exists is that a
// hash once overrode the owner's choice.
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
    // No tag, distilled from 1 raw entry -> sources_count=1.
    const w = await seedWiki(request, mcpToken, sid, {
      title: 'Lonely Note', body: 'A standalone note with no tags.',
    });
    await publishEntry(request, mcpToken, sid, { genre: 'wiki', id: w.wikiID });

    await seedCoveredNote(request, sid);
    await request.dispose();
  });

  // **This test used to pin the duplication down as correct**: its name
  // literally read "meta row shows N corpus sources; breadcrumb shows N
  // sources cited" -- so the same number was said twice on one screen, in
  // two different phrasings (UX-85), and any change trying to de-duplicate
  // it would go red against this guard, getting logged as "leave it for the
  // owner to decide". The guard was recording the duplication itself, not a
  // product requirement ([[parked-test-carries-a-wrong-diagnosis]]).
  //
  // The criterion is now the design-language rule instead: **say a thing
  // once per screen**. The division of labor is also fixed: the breadcrumb
  // only answers "where am I", the meta row answers "what is this, who wrote
  // it, when, and how many sources it cites".
  //
  // The "N corpus sources" field has **already been removed**. It read the
  // length of the `raw -> promote` chain, but the vault import creates wiki
  // entries directly, leaving that chain empty -- so across the entire
  // 575-entry corpus it always displayed `0`. A count that is always zero
  // carries no information, just occupies a spot in the meta row, and gives
  // the false impression "this piece has no sources", when the truth is "you
  // never used this pipeline". The owner judged it useless and removed it.
  // The invariant itself is unchanged; the test below still guards it: say a
  // thing once per screen.
  test('日期只出现一次:面包屑只导航,meta 行讲这条笔记',
    async ({ page }) => {
      await goto(page, `/wiki/${PATH}`);
      await expect(page.getByTestId('wiki-landing')).toBeVisible({ timeout: 5_000 });
      await expect(page.getByTestId('wiki-meta')).toContainText(OWNER.fullName);
      // Once removed, it must not resurface under different wording -- the
      // negative half of the judgment.
      await expect(page.getByTestId('wiki-meta'), '来源计数已移除，不该以任何措辞回来')
        .not.toContainText('corpus source');

      const crumb = page.getByTestId('wiki-breadcrumb');
      // Read the text out and check it -- `.not.toContainText` would pass
      // even before the element ever appears
      // ([[negated-assertion-passes-while-absent]]).
      await expect(crumb).toBeVisible();
      const crumbText = await crumb.innerText();
      expect(crumbText, '来源数只在 meta 行说一次').not.toContain('sources');
      expect(crumbText, '日期只在 meta 行说一次').not.toMatch(/\d{4}/);
    });

  // This test guards **the small label copy on the cover**: with no tag, it
  // should read only "wiki", no longer hardcoded to fall back to "corpus". It
  // used to be attached to lonely-note -- a note that shouldn't have a cover
  // at all -- which incidentally locked in "render an empty hero shell even
  // with no hero set" as intended behavior (F-L-32). What it actually guards
  // holds just as well on a note that has a cover, so it's moved here.
  test('cover with no tag shows just "wiki", not the hardcoded "corpus" fallback',
    async ({ page }) => {
      await goto(page, `/wiki/${COVERED_PATH}`);
      const cover = page.getByTestId('wiki-cover');
      await expect(cover).toBeVisible({ timeout: 5_000 });
      await expect(cover).not.toContainText('corpus');
    });

  test('没设 hero 的笔记不渲染空的 hero 壳', async ({ page }) => {
    await goto(page, `/wiki/${PATH}`);
    // First confirm the page actually rendered -- otherwise "counted 0" just
    // means nothing has loaded yet.
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
    // data-hue IS the coloring mechanism itself (CSS attribute selectors
    // produce the gradient), not a marker that exists only for the test to see.
    await expect(cover, 'owner 选了 acid').toHaveAttribute('data-hue', HUE);
  });
});

// seedCoveredNote -- the owner sets the full hero three-piece set, inserts
// another image in the body, then **publishes** it.
// Publishing is the crux: the public path (SSR) and the token-bearing
// refetch path are two separate assemblies, and asset-related assertions
// used to run only against the latter.
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
