// asset-transforms.ts —— body_md 里 asset URI ↔ presigned URL 互转。
//
// Editor 内部 doc 用 presigned URL（Tiptap Image 节点 src，浏览器能直渲）。
// Server / DB / on-disk markdown 用 stable URI `standmeet-asset:<id>`（不
// 受 TTL 影响 + orphan 可追踪）。
//
// load 时 expand（URI → URL），emit/save 时 contract（URL → URI）。
// 新上传的 image 进来已是 URL 形态（upload 接口直接返 presigned），所以
// expand 只处理 server 给的 body_md；contract 同时处理 server-loaded 和
// new-uploaded 两类。

import { ASSET_URI_SCHEME } from '@/lib/writings/upload-asset';

const URI_RE = new RegExp(ASSET_URI_SCHEME + '([0-9a-fA-F-]{36})', 'g');

// expandURIsToURLs —— body_md → display markdown（URI 替为 presigned URL）。
// urlMap 缺 ID → 留原 URI，editor render 看到 broken img 但不丢引用（save
// 回原样）。**这是编辑器的策略**：owner 在改一份草稿，把引用悄悄删掉才是坏事。
export function expandURIsToURLs(md: string, urlMap: Record<string, string>): string {
  return md.replace(URI_RE, (match, id: string) => urlMap[id] ?? match);
}

// IMAGE_WITH_URI_RE —— 整个图片节点 `![alt](standmeet-asset:<id>)`，连同它的 alt。
const IMAGE_WITH_URI_RE = new RegExp(
  '!\\[[^\\]]*\\]\\(\\s*' + ASSET_URI_SCHEME + '([0-9a-fA-F-]{36})\\s*\\)', 'g',
);

// expandURIsForReader —— **访客那一侧**的策略：解析得到就展开，解析不到就**整个图片节点删掉**。
//
// 同一个函数不能同时满足两个读者（F-L-50）：编辑器必须保住引用（owner 还在改），
// 而访客不该看见一张裂图。以前两边共用 `expandURIsToURLs`，于是撤下一份素材之后，
// 公开页正文中间留下一个浏览器默认的裂图占位符，alt 里还印着原文件名 `harness-photo.jpg`
// —— react-markdown 会把 `standmeet-asset:` 这种非标准 scheme 剥成空 src。
//
// 删掉整个节点而不是只删 URI：只删地址会留下一个 `![原文件名]()`，把**内部文件名**
// 端到访客眼前，比裂图更糟。
export function expandURIsForReader(md: string, urlMap: Record<string, string>): string {
  const withoutDangling = md.replace(IMAGE_WITH_URI_RE, (match, id: string) =>
    (urlMap[id] === undefined ? '' : match));
  return expandURIsToURLs(withoutDangling, urlMap);
}

// contractURLsToURIs —— display markdown → body_md（presigned URL 替回 URI）。
// inverseMap 是 url → id；只匹 image 引用 `(url)` 形态，避免误伤普通 link。
export function contractURLsToURIs(md: string, inverseMap: Record<string, string>): string {
  return Object.keys(inverseMap).length === 0
    ? md
    : Object.entries(inverseMap).reduce(
      (acc, [url, id]) => acc.split('(' + url + ')').join('(' + ASSET_URI_SCHEME + id + ')'),
      md,
    );
}

// invertMap —— urlMap (id→url) 倒转成 (url→id)。contract 用。
export function invertMap(urlMap: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, url] of Object.entries(urlMap)) {
    out[url] = id;
  }
  return out;
}
