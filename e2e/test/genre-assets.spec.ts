// genre-assets.spec.ts —— **每个 genre 都能挂素材**:附件 / 正文配图 / hero。
//
// 业务故事:owner 在 Claude Code 说"把这张图配到那条 wiki 上"。图在别人家(图床),他给的是
// 一个 https 地址;后端去取、存下来、正文里那条 `standmeet-asset:<id>` 引用读回时解析成
// 可访问地址。删掉那条语料,图跟着没。
//
// 这件事此前**只有 writing 有**。底下的机制其实一直是 genre 无关的(assets 表按 holder_id
// 挂,没有 genre 列、没有 FK;cover_image_asset_id 就在共享的 corpus_notes 表上),缺的只是
// 接线 —— 所以"每个 genre 都能有配图"这句话在数据上成立、在代码里不成立。
//
// 另一半是**取回那一步的守卫**:地址是 owner 递进来的,后端拿它发请求 = 把服务端当跳板。
// 非 https、非图片、取不到、超大,四条都得撞得响 —— 只测 happy path 的守卫等于没有守卫。

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

// **四个** genre 一起测 —— 这条特性的全部意思就是"不挑 genre",漏一个就等于这句话是假的。
//
// subjectivity 曾经不在这份名单里,而且不是漏写测试:`assets.upload` 的 genre 白名单
// 主动拒绝它,`corpus.get` 也拒绝(错误信息还写着 "genre must be 'raw', 'wiki' or
// 'output'" —— 一句否认它存在的话)。于是它写得进、删得掉,读不回来,更挂不了素材。
// 底下的机制一直是 genre 无关的(assets 按 holder_id 挂;hero 就在共享的 corpus_notes 上),
// 缺的只是三处白名单各自漏了同一个名字。
//
// 它的**写口**确实是另一条(subjectivity_write:owner 跟自己的 AI 写出来的自我模型,
// 不走 corpus.create) —— 那是设计,不是缺口。读 / 删 / 挂素材都跟其余三个同一条路。
// writing 单独有自己的套件。
const GENRES = ['raw', 'wiki', 'output', 'subjectivity'] as const;

interface MCPSession { request: APIRequestContext; token: string; sid: string }
let s: MCPSession;

// 装配挂在**文件级**,不挂在某个 describe 上 —— 下面三个 describe 共用一个 owner,而 Playwright
// 在一条用例失败后会换一个 worker 进程重跑余下的:模块被重新 import,挂在第一个 describe 上的
// beforeAll 不会为后两个 describe 再跑一次,于是 `s` 是 undefined,后 20 条全部炸在
// "Cannot read properties of undefined"。那是失败的**回声**,不是新的失败。
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

      // 正文引用它 —— 用真 id,不是 pending 占位:上传是独立一步,写正文时 id 已经有了。
      await setBody(s, genre, id, `${genre} with an image`,
        `here it is: ![pixel](standmeet-asset:${asset.asset_id})`);

      const entry = await getEntry(s, genre, id);
      expect(entry.body, '正文存的是稳定 URI,不是会过期的地址')
        .toContain(`standmeet-asset:${asset.asset_id}`);
      const url = entry.asset_urls?.[asset.asset_id];
      expect(url, `${genre} 读回时把引用解析成了地址`).toBeTruthy();
      expect(await assetReachable(s.request, url ?? ''), '那个地址真取得到图').toBe(true);
    });

    // hero 区不是"一张图" —— 设计里它是图 + 压在图上的那句话 + 色调三样一起(见 Cover.tsx:
    // cover_headline / cover_hue / cover_image_asset_id)。三列本来就在共享的 corpus_notes 表上,
    // 只有 writing 那条路写过它们。
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

    // 附件 —— 设计里 output 页那个 "DOWNLOAD PDF · 0.2 MB" 按钮。它要的三样:文件名、
    // **字节数**(按钮上要显示大小)、可下载的地址。所以附件不能只回一个 id。
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
      // 地址取自**素材清单**,不是 asset_urls —— 后者只解析正文里引用了的那些,而这条语料
      // 的正文没引用它。取错了会拿到空串,而空串 GET 出去会打到站点根、回 200,
      // 于是"删之前取得到"假绿、"删之后取不到"假红。
      const url = before.assets?.find((a) => a.asset_id === asset.asset_id)?.url ?? '';
      expect(url, '素材清单里带着可访问地址').toBeTruthy();
      expect(await assetReachable(s.request, url), '删之前取得到').toBe(true);

      await callTool(s.request, s.token, s.sid, 'corpus.delete', { genre, id });

      // 先断**产品面**:这条语料读不出来了,自然也没有素材可漏。这一句才是访客那侧
      // 真正会看见的事;下面那句摸的是存储的字节,产品面不暴露它。
      //
      // 三个 genre 同一句 —— 删就是删。raw 以前走的是"归档"(行留着、置个标志),
      // 而那个归档没有第二半:没有列表显示它,没有恢复的路,面板上那个按钮打的就是 DELETE。
      // 一个删除动作在不同 genre 上意味着不同的事,调用方就得记住哪个是哪个。
      await expect(getEntry(s, genre, id)).rejects.toThrow(/not found|不存在/i);

      // 再断**字节**:不变量说的是 blob 的寿命 ⊆ 条目的寿命,而"字节还在不在"没有任何
      // 产品面能问 —— 只有直接打对象存储的地址才证得了。两句都要:只断上面那句,
      // 留下的孤儿字节谁也发现不了;只断这句,"产品面还漏不漏这张图"其实没测。
      expect(await assetReachable(s.request, url), '删之后取不到').toBe(false);
    });
  }

});

// ── 取回那一步的守卫。地址是 owner 递进来的 —— 后端拿它发请求就是把自己当跳板。 ──
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

  // 当图片用(kind=image,默认)时必须真是图片 —— 否则 owner 递一个 HTML 页面进来就成了"一张图"。
  // 但**附件不适用这条**:附件本来就不是图片,一刀切会把下载按钮那条整条毙掉。
  // "多媒体"不是只有 png。gif / webp / mp4 都得收得下 —— 否则 owner 贴一张动图就卡住。
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

  // SVG 是这次放宽里**最容易漏的一条**:它命中 image/* 前缀,但里面能塞 <script>,
  // 存下来再由我们的地址发出去就是存储型 XSS。所以判据必须是白名单,不是前缀匹配。
  test('SVG 拒 —— image/* 前缀匹配不是白名单', async () => {
    const id = await createEntry(s, 'wiki', 'svg', 'body');
    await expect(uploadAsset(s, 'wiki', id, MEDIA.svg)).rejects.toThrow(/svg|content-type/i);
  });

  // 声明的类型是**对方说的**,不是证据。声明 image/png、实际发 SVG 字节 —— 只看 header
  // 的校验会放它过去,然后这份"PNG"以 SVG 的身份被浏览器执行。
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

// 上限**按 kind 分**。一段视频天生比一张图大 —— 拿同一个数卡它等于禁掉视频。
test.describe('体积上限:按 kind 分,按读到的字节算', () => {
  // 上限**按 kind 分**。一段视频天生比一张图大 —— 拿同一个数卡它等于禁掉视频。
  // 同样 11MB:当图片是超标,当视频是正常。这一对就是"上限不是一个全局常数"的证据。
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

  // 上限按读到的字节算:bulk 根本不发 Content-Length,所以"信声明"的实现在这条上会一路读完。
  test('不发 Content-Length 也拦得住(按读到的字节算)', async () => {
    const id = await createEntry(s, 'wiki', 'no length', 'body');
    await expect(
      uploadAsset(s, 'wiki', id, bulk(11, 'image/png')),
    ).rejects.toThrow(/exceed|bytes|limit|大/i);
  });
});
