// genre-assets.ts —— 每个 genre 都能挂素材的共用辅助。
//
// 素材托管在别人家(external-mock 的 /media/*),后端按 https 地址去取 —— 这跟 owner 真实的
// 用法一样:图在图床/网盘上,他给 AI 一个链接。

import type { APIRequestContext } from '@playwright/test';

import { callTool } from '@/fixtures/mcp';

// MEDIA —— 素材托管方给的几个地址。后三个是**故意不对**的,给取回那一步的守卫用。
const BACKEND_URL = process.env['BACKEND_URL'] ?? 'http://localhost:8000';
// 图床是 https 的 —— 后端取素材那一步只认 https,替身也得真的会 https(见
// mock-stack/job-board/tls.go:9443 是它的 https 面,9000 仍是明文)。
const MEDIA_BASE = 'https://external-mock:9443/media';
export const MEDIA = {
  // 该收的 —— "多媒体"不是只有 png。
  pixel: `${MEDIA_BASE}/pixel.png`,
  gif: `${MEDIA_BASE}/anim.gif`,
  webp: `${MEDIA_BASE}/shot.webp`,
  mp4: `${MEDIA_BASE}/clip.mp4`,
  pdf: `${MEDIA_BASE}/paper.pdf`,
  // 该拒的 —— 每条对应一种具体绕法,见 mock-stack/job-board/media.go。
  svg: `${MEDIA_BASE}/vector.svg`,
  lying: `${MEDIA_BASE}/lying.png`,
  html: `${MEDIA_BASE}/page.html`,
  notImage: `${MEDIA_BASE}/not-an-image.txt`,
  missing: `${MEDIA_BASE}/missing.png`,
  insecure: 'http://external-mock:9000/media/pixel.png', // 非 https
} as const;

/** bulk —— 发指定 MB 数、指定类型的字节。上限是按 kind 分的,所以同一个大小要能当两种用。 */
export function bulk(mb: number, type: string): string {
  return `${MEDIA_BASE}/bulk?mb=${mb}&type=${encodeURIComponent(type)}`;
}

/** 一条语料上的一份素材(上传完回的那一份)。 */
export interface UploadedAsset {
  asset_id: string;
  content_type: string;
  size_bytes: number;
  original_filename: string;
}

/** 一条语料挂着的一份素材,读回时的形状(下载按钮要的就是这几项)。 */
interface EntryAsset {
  asset_id: string;
  kind: string;
  content_type: string;
  size_bytes: number;
  original_filename: string;
  url: string;
}

/** 一条语料读回来时,跟素材有关的那几项。 */
export interface EntryAssets {
  id: string;
  genre: string;
  path?: string;
  body?: string;
  cover_image_asset_id?: string | null;
  cover_headline?: string;
  cover_hue?: string;
  title?: string;
  asset_urls?: Record<string, string>;
  assets?: EntryAsset[];
}

interface MCPSession { request: APIRequestContext; token: string; sid: string }

/**
 * 建一条指定 genre 的语料,返它的 id。
 *
 * subjectivity 的**写口是另一条**(subjectivity_write:那是 owner 跟自己的 AI 写出来的
 * 自我模型,不走 corpus.create)。读、删、挂素材才是同一条 —— 所以这里分流,
 * 调用方不必知道。
 */
export async function createEntry(
  s: MCPSession, genre: string, title: string, body: string,
): Promise<string> {
  if (genre === 'subjectivity') {
    // 回参的键是 subjectivity_id,不是 id —— 那个 op 的名字和形状都是 owner 的 AI
    // 一直在用的,搬家时没改对外的称呼。
    const made = await callTool<{ subjectivity_id: string }>(
      s.request, s.token, s.sid, 'subjectivity_write', { title, body },
    );
    return made.subjectivity_id;
  }
  const item = await callTool<{ id: string }>(s.request, s.token, s.sid, 'corpus.create', {
    genre, title, body,
  });
  return item.id;
}

/** 给一条语料挂一份素材:后端按地址去取。 */
export async function uploadAsset(
  s: MCPSession, genre: string, id: string, url: string, opts: UploadOpts = {},
): Promise<UploadedAsset> {
  return callTool<UploadedAsset>(s.request, s.token, s.sid, 'assets.upload', {
    genre, id, url, ...opts,
  });
}

/** kind —— 'image'(正文配图 / hero)还是 'attachment'(可下载的附件,如 PDF)。 */
export interface UploadOpts { kind?: string; filename?: string }

/** hero 区:图 + 压在图上的那句话 + 色调。 */
export interface HeroPatch {
  cover_image_asset_id?: string;
  cover_headline?: string;
  cover_hue?: string;
}

/** 设 hero 区。subjectivity 的写口是它自己那条(见 createEntry 的说明)。 */
export async function setHero(
  s: MCPSession, genre: string, id: string, hero: HeroPatch,
): Promise<unknown> {
  if (genre === 'subjectivity') {
    return editSubjectivity(s, id, hero);
  }
  return callTool<EntryAssets>(s.request, s.token, s.sid, 'corpus.update', {
    genre, id, ...hero,
  });
}

/** 改一条语料的正文。跟 setHero 同理,subjectivity 走它自己那条写口。 */
export async function setBody(
  s: MCPSession, genre: string, id: string, title: string, body: string,
): Promise<unknown> {
  if (genre === 'subjectivity') {
    return editSubjectivity(s, id, { title, body });
  }
  return callTool(s.request, s.token, s.sid, 'corpus.update', { genre, id, title, body });
}

// editSubjectivity —— subjectivity_write 的改法:带上 subjectivity_id。**title 和 body 是必填**
// (那条 op 的 required),所以改 hero 时也得把它们带上 —— 先读回来再原样交回去,
// 不然就把正文清空了。
async function editSubjectivity(
  s: MCPSession, id: string, patch: HeroPatch & { title?: string; body?: string },
): Promise<unknown> {
  const cur = await getEntry(s, 'subjectivity', id);
  return callTool(s.request, s.token, s.sid, 'subjectivity_write', {
    subjectivity_id: id,
    title: patch.title ?? cur.title ?? '',
    body: patch.body ?? cur.body ?? '',
    ...heroOnly(patch),
  });
}

function heroOnly(p: HeroPatch): HeroPatch {
  return {
    ...(p.cover_image_asset_id === undefined ? {} : { cover_image_asset_id: p.cover_image_asset_id }),
    ...(p.cover_headline === undefined ? {} : { cover_headline: p.cover_headline }),
    ...(p.cover_hue === undefined ? {} : { cover_hue: p.cover_hue }),
  };
}

/** 读回一条语料(带素材字段)。 */
export async function getEntry(
  s: MCPSession, genre: string, id: string,
): Promise<EntryAssets> {
  return callTool<EntryAssets>(s.request, s.token, s.sid, 'corpus.get', { genre, id });
}

/**
 * 一份素材现在还取不取得到 —— 拿它的可访问地址真发一次 GET。
 *
 * 空地址直接判"取不到",**不发请求**:空串会被解析成站点根、回 200,于是"取得到"这个
 * 结论其实来自一个跟素材毫无关系的页面。一个不唯一的信号当不了收据。
 */
export async function assetReachable(
  request: APIRequestContext, url: string,
): Promise<boolean> {
  if (!url) return false;
  const res = await request.get(url).catch(() => null);
  return res !== null && res.ok();
}

// 这里以前有 visitorRead / VisitorAsset —— 直接 POST
// `/api/v1/sessions/{cid}/tools/corpus_read`,从回参的 JSON 里数素材。
//
// **访客不会发那个 POST**,发它的是页面里的 JS。而素材的泄漏发生在**渲染层**:
// 文件名、缩略图、渲不出来的破图位 —— 从 JSON 断"数组长度 0"一个都看不见。
// 那几条断言现在在浏览器里做(genre-assets-reader.spec.ts),这两个就没有调用方了。
// 留着的话,下一个人会先看见它、照着用,那条后门就又活了。

/** assetByID —— 按 asset id 直取的那条路。素材不该有它 —— 有就绕开了文章的 ACL。 */
export async function assetByID(
  request: APIRequestContext, sessionToken: string, assetID: string,
): Promise<number> {
  const res = await request.get(`${BACKEND_URL}/api/v1/assets/${assetID}`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  return res.status();
}
