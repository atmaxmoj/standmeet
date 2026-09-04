// genre-assets.spec.ts —— **every genre can carry assets**: attachments / inline images / hero.
//
// Business story: owner tells Claude Code "put this image on that wiki". The image lives elsewhere
// (an image host); the owner hands over an https URL; the backend fetches it, stores it, and the
// `standmeet-asset:<id>` reference in the body resolves to a reachable URL on read-back. Delete the
// note and the image goes with it.
//
// This used to exist **only for writing**. The mechanism underneath has always been genre-agnostic
// (the assets table hangs off holder_id, with no genre column and no FK; cover_image_asset_id lives
// on the shared corpus_notes table) — the only thing missing was the wiring. So "every genre can
// have images" holds in the data but not in the code.
//
// The other half is **the guard on the fetch step**: the URL comes from the owner, and the backend
// making a request with it turns the server into a relay. Non-https, non-image, unreachable, oversize
// — all four must trip. A guard that only tests the happy path is no guard at all.

import type { APIRequestContext, Playwright } from '@playwright/test';

import { test, expect } from '@/fixtures/test';

import { claim, createAPIToken, login as loginAPI } from '@/fixtures/admin';
import {
  MEDIA, bulk, createEntry, uploadAsset, getEntry, setBody, setHero, assetReachable,
} from '@/fixtures/genre-assets';
import { resetInstance, findSetupToken } from '@/fixtures/instance';
import { callTool, initMCP } from '@/fixtures/mcp';

const OWNER = {
  email: 'genre-assets@example.com', password: 'correct-horse-battery-staple',
  handle: 'genre-assets', fullName: 'Genre Assets Owner',
};

// Test **all four** genres together — the whole point of this feature is that it does not pick a
// genre, so missing one makes that claim false.
//
// subjectivity used to be off this list, and not because a test was forgotten: the genre whitelist
// in `assets.upload` actively rejected it, and `corpus.get` rejected it too (the error even read
// "genre must be 'raw', 'wiki' or 'output'" — a sentence denying it existed). So it could be
// written and deleted, but not read back, let alone carry assets. The mechanism underneath has
// always been genre-agnostic (assets hang off holder_id; hero lives on the shared corpus_notes),
// and the only gap was the same name missing from three separate whitelists.
//
// Its **write path** genuinely is a different one (subjectivity_write: the self-model the owner
// writes together with their own AI, not via corpus.create) — that is by design, not a gap. Read /
// delete / attach-assets all go the same path as the other three. writing has its own suite.
const GENRES = ['raw', 'wiki', 'output', 'subjectivity'] as const;

interface MCPSession { request: APIRequestContext; token: string; sid: string }
let s: MCPSession;

// Setup hangs at the **file level**, not on a single describe — the three describes below share one
// owner, and Playwright switches to a fresh worker process to rerun the rest after a case fails: the
// module is re-imported, and a beforeAll hung on the first describe does not run again for the other
// two, so `s` is undefined and the remaining 20 cases all blow up on "Cannot read properties of
// undefined". That is the **echo** of the failure, not a new one.
test.beforeAll(async ({ playwright }: { playwright: Playwright }) => {
  resetInstance();
  const request = await playwright.request.newContext();
  await claim(request, findSetupToken(), OWNER);
  const { csrf } = await loginAPI(request, OWNER.email, OWNER.password);
  const token = await createAPIToken(request, csrf, 'genre-assets-token');
  s = { request, token, sid: await initMCP(request, token) };
});

test.afterAll(async () => { await s.request.dispose(); });

test.describe('每个 genre 都能挂素材', () => {
  for (const genre of GENRES) {
    test(`${genre}:上传一份素材 → 正文引用它 → 读回时解析成可访问地址`, async () => {
      const id = await createEntry(s, genre, `${genre} with an image`, 'before the image');
      const asset = await uploadAsset(s, genre, id, MEDIA.pixel, { filename: 'pixel.png' });
      expect(asset.asset_id, 'upload returns a real asset id')
        .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      expect(asset.content_type).toBe('image/png');
      expect(asset.size_bytes).toBeGreaterThan(0);

      // Reference it from the body — with the real id, not a pending placeholder: upload is a
      // separate step, so the id already exists when the body is written.
      await setBody(s, genre, id, `${genre} with an image`,
        `here it is: ![pixel](standmeet-asset:${asset.asset_id})`);

      const entry = await getEntry(s, genre, id);
      expect(entry.body, '正文存的是稳定 URI,不是会过期的地址')
        .toContain(`standmeet-asset:${asset.asset_id}`);
      const url = entry.asset_urls?.[asset.asset_id];
      expect(url, `${genre} 读回时把引用解析成了地址`).toBeTruthy();
      expect(await assetReachable(s.request, url ?? ''), '那个地址真取得到图').toBe(true);
    });

    // The hero area is not "an image" — by design it is the image + the line laid over it + the hue,
    // all three together (see Cover.tsx: cover_headline / cover_hue / cover_image_asset_id). The three
    // columns already live on the shared corpus_notes table; only the writing path ever wrote them.
    test(`${genre}:hero 区(图 + 标题句 + 色调)挂得上、读得回`, async () => {
      const id = await createEntry(s, genre, `${genre} with a hero`, 'body');
      const asset = await uploadAsset(s, genre, id, MEDIA.pixel, { filename: 'hero.png' });
      await setHero(s, genre, id, {
        cover_image_asset_id: asset.asset_id,
        cover_headline: 'A 4-page primer on faithfulness',
        cover_hue: 'violet',
      });

      const entry = await getEntry(s, genre, id);
      expect(entry.cover_image_asset_id, `${genre} 的 hero 图记下来了`).toBe(asset.asset_id);
      expect(entry.cover_headline, 'hero 上那句话').toBe('A 4-page primer on faithfulness');
      expect(entry.cover_hue, 'hero 的色调').toBe('violet');
      expect(entry.asset_urls?.[asset.asset_id], 'hero 图也在可访问地址里').toBeTruthy();
    });

    // Attachment — the "DOWNLOAD PDF · 0.2 MB" button on the output page in the design. It needs
    // three things: the filename, the **byte count** (the button shows the size), and a downloadable
    // URL. So an attachment cannot just return an id.
    test(`${genre}:附件(PDF)传得上,带着文件名和大小读得回`, async () => {
      const id = await createEntry(s, genre, `${genre} with an attachment`, 'body');
      const up = await uploadAsset(s, genre, id, MEDIA.pdf, {
        kind: 'attachment', filename: 'eval-methodology.pdf',
      });
      expect(up.content_type, '附件不是图片,不该被图片守卫毙掉').toBe('application/pdf');
      expect(up.original_filename).toBe('eval-methodology.pdf');
      expect(up.size_bytes, '按钮上要显示大小,所以字节数得是真的').toBeGreaterThan(0);

      const entry = await getEntry(s, genre, id);
      const att = entry.assets?.find((a) => a.asset_id === up.asset_id);
      expect(att, '附件出现在这条语料的素材清单里').toBeTruthy();
      expect(att?.kind).toBe('attachment');
      expect(att?.size_bytes).toBe(up.size_bytes);
      expect(await assetReachable(s.request, att?.url ?? ''), '按钮点得下去').toBe(true);
    });

    test(`${genre}:删掉这条语料 → 它的素材跟着没`, async () => {
      const id = await createEntry(s, genre, `${genre} to delete`, 'body');
      const asset = await uploadAsset(s, genre, id, MEDIA.pixel);
      const before = await getEntry(s, genre, id);
      // The URL comes from the **asset list**, not asset_urls — the latter only resolves the ones
      // referenced in the body, and this note's body does not reference it. Get it wrong and you get
      // an empty string, and an empty-string GET hits the site root and returns 200, making
      // "reachable before delete" a false green and "unreachable after delete" a false red.
      const url = before.assets?.find((a) => a.asset_id === asset.asset_id)?.url ?? '';
      expect(url, '素材清单里带着可访问地址').toBeTruthy();
      expect(await assetReachable(s.request, url), '删之前取得到').toBe(true);

      await callTool(s.request, s.token, s.sid, 'corpus.delete', { genre, id });

      // Assert the **product surface** first: the note no longer reads back, so there is no asset to
      // leak. This is the thing a visitor actually sees; the next assertion probes the stored bytes,
      // which the product surface never exposes.
      //
      // Same assertion for all genres — delete means delete. raw used to "archive" (the row stayed,
      // a flag was set), and that archive had no second half: no list showed it, no path restored it,
      // and the button on the panel fired DELETE. A delete action meaning different things across
      // genres forces the caller to remember which is which.
      await expect(getEntry(s, genre, id)).rejects.toThrow(/not found|不存在/i);

      // Then assert the **bytes**: the invariant says the blob's lifetime ⊆ the entry's lifetime,
      // and no product surface can ask "are the bytes still there" — only hitting the object-store
      // URL directly proves it. Both assertions are needed: assert only the one above and orphaned
      // bytes go unnoticed by anyone; assert only this one and "does the product still leak the
      // image" goes untested.
      expect(await assetReachable(s.request, url), '删之后取不到').toBe(false);
    });
  }

});

// ── The guard on the fetch step. The URL comes from the owner — the backend making a request with
//    it turns itself into a relay. ──
test.describe('按地址取素材:每条守卫都要撞得响', () => {
  test('挂到一条不存在的语料上 → 拒,而不是落一份没人认领的素材', async () => {
    await expect(
      uploadAsset(s, 'wiki', '00000000-0000-0000-0000-000000000000', MEDIA.pixel),
    ).rejects.toThrow(/not found|不存在/i);
  });

  test('非 https 的地址 → 拒', async () => {
    const id = await createEntry(s, 'wiki', 'insecure', 'body');
    await expect(uploadAsset(s, 'wiki', id, MEDIA.insecure)).rejects.toThrow(/https/i);
  });

  // F-P-7 —— **hosts that require a descriptive User-Agent, we must be able to fetch from.**
  //
  // The previous version built the request with no UA at all, so Go sent the default
  // `Go-http-client/2.0`, and Wikimedia's bot policy 403s that UA outright. "Paste an image from
  // Wikipedia" is the single most likely thing the owner does, so this path was flatly broken on the
  // most common source — and all the owner saw was `media rejected: status 403`.
  //
  // The criterion is **it came back**, not "no error": this case has to tell "we changed the UA"
  // apart from "we still send the default", so the stand-in first learns the rule (403 unless the UA
  // is presentable), then goes red.
  test('主机要求描述性 User-Agent → 取得回来(不能发库的默认 UA)', async () => {
    const id = await createEntry(s, 'wiki', 'ua-required', 'body');
    const up = await uploadAsset(s, 'wiki', id, MEDIA.uaRequired, { filename: 'ua.png' });
    expect(up.content_type, '取回的是那张图，不是一句 403').toBe('image/png');
    expect(up.size_bytes).toBeGreaterThan(0);
  });

  // Used as an image (kind=image, the default) it must really be an image — otherwise an owner
  // handing in an HTML page turns it into "an image". But **this does not apply to attachments**: an
  // attachment is not an image to begin with, and a blanket rule would kill the download-button case
  // entirely. "Media" is not only png. gif / webp / mp4 must all be accepted — otherwise the owner
  // pasting an animated image gets stuck.
  for (const [label, url, want] of [
    ['gif', MEDIA.gif, 'image/gif'],
    ['webp', MEDIA.webp, 'image/webp'],
    ['mp4', MEDIA.mp4, 'video/mp4'],
  ] as const) {
    test(`${label} 收得下(多媒体不是只有 png)`, async () => {
      const id = await createEntry(s, 'wiki', `media ${label}`, 'body');
      const up = await uploadAsset(s, 'wiki', id, url);
      expect(up.content_type).toBe(want);
      expect(up.size_bytes).toBeGreaterThan(0);
    });
  }

  // SVG is **the easiest one to miss** in this loosening: it matches the image/* prefix, but it can
  // carry a <script> inside, and storing it and then serving it from our own URL is stored XSS. So
  // the criterion must be a whitelist, not a prefix match.
  test('SVG 拒 —— image/* 前缀匹配不是白名单', async () => {
    const id = await createEntry(s, 'wiki', 'svg', 'body');
    await expect(uploadAsset(s, 'wiki', id, MEDIA.svg)).rejects.toThrow(/svg|content-type/i);
  });

  // The declared type is **what the other side says**, not evidence. Declare image/png, actually
  // send SVG bytes — a check that only reads the header lets it through, and then this "PNG" runs in
  // the browser as an SVG.
  test('声明 image/png 实际是 SVG 字节 → 拒(不能只信 Content-Type)', async () => {
    const id = await createEntry(s, 'wiki', 'lying', 'body');
    await expect(uploadAsset(s, 'wiki', id, MEDIA.lying)).rejects.toThrow(/svg|mismatch|content/i);
  });

  test('当图片用却不是图片 → 拒', async () => {
    const id = await createEntry(s, 'wiki', 'not an image', 'body');
    await expect(uploadAsset(s, 'wiki', id, MEDIA.notImage)).rejects.toThrow(/content-type|image/i);
  });

  test('附件放宽了,但 HTML 永远拒(自家域上的 XSS 载体)', async () => {
    const id = await createEntry(s, 'wiki', 'html attachment', 'body');
    await expect(
      uploadAsset(s, 'wiki', id, MEDIA.html, { kind: 'attachment' }),
    ).rejects.toThrow(/html|content-type/i);
  });

  test('地址取不到 → 拒,且不留下指向空处的 asset 行', async () => {
    const id = await createEntry(s, 'wiki', 'missing', 'body');
    await expect(uploadAsset(s, 'wiki', id, MEDIA.missing)).rejects.toThrow(/404|status/i);
    const entry = await getEntry(s, 'wiki', id);
    expect(Object.keys(entry.asset_urls ?? {}), '没有半成品的 asset').toHaveLength(0);
  });

});

// The limit is **per kind**. A video is naturally bigger than an image — capping it with the same
// number amounts to banning video.
test.describe('体积上限:按 kind 分,按读到的字节算', () => {
  // The limit is **per kind**. A video is naturally bigger than an image — capping it with the same
  // number amounts to banning video. The same 11MB is oversize as an image and fine as a video. This
  // pair is the proof that "the limit is not one global constant".
  test('11MB 当图片 → 超标', async () => {
    const id = await createEntry(s, 'wiki', 'huge image', 'body');
    await expect(
      uploadAsset(s, 'wiki', id, bulk(11, 'image/png')),
    ).rejects.toThrow(/exceed|bytes|limit|大/i);
  });

  test('同样 11MB 当视频 → 收得下(上限按 kind 分,不是一个全局常数)', async () => {
    const id = await createEntry(s, 'wiki', 'ok video', 'body');
    const up = await uploadAsset(s, 'wiki', id, bulk(11, 'video/mp4'));
    expect(up.content_type).toBe('video/mp4');
    expect(up.size_bytes).toBeGreaterThan(10 << 20);
  });

  test('视频也有自己的上限 —— 超了照样拒', async () => {
    const id = await createEntry(s, 'wiki', 'huge video', 'body');
    await expect(
      uploadAsset(s, 'wiki', id, bulk(51, 'video/mp4')),
    ).rejects.toThrow(/exceed|bytes|limit|大/i);
  });

  // The limit counts the bytes actually read: bulk sends no Content-Length at all, so a
  // "trust-the-declaration" implementation would read all the way through on this one.
  test('不发 Content-Length 也拦得住(按读到的字节算)', async () => {
    const id = await createEntry(s, 'wiki', 'no length', 'body');
    await expect(
      uploadAsset(s, 'wiki', id, bulk(11, 'image/png')),
    ).rejects.toThrow(/exceed|bytes|limit|大/i);
  });
});
