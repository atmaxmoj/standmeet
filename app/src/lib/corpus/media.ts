// media.ts —— 语料素材在渲染前的两步纯计算。
//
// **这个文件没有 'use client'**,所以 Server Component 也调得动。
// output 的落地页是服务端渲染的;这两个函数一度住在 CorpusMedia.tsx(client component)里,
// 结果 output 页面一调就 500:"Attempted to call coverURL() from the server but coverURL
// is on the client"。而 wiki 那条是 client component,完全正常 —— 一个只在其中一条路上
// 炸的错误,单看 wiki 绿着什么也发现不了。
//
// 判据很简单:**纯函数不该住在客户端边界里面**。它们没有状态、没有 hook、没有 DOM,
// 放进 'use client' 文件只是因为"用它的组件在那儿",而那不是一个理由。

import { expandURIsToURLs } from '@/lib/writings/asset-transforms';

/** CorpusAsset —— 一份挂在语料上的文件,访客看到的那几项。 */
export interface CorpusAsset {
  asset_id: string;
  kind: string;
  original_filename: string;
  url: string;
  size_bytes: number;
}

/**
 * expandBody —— 正文里的 asset URI → 可访问地址。
 *
 * **渲染前必须过这一步**:react-markdown 的 urlTransform 会把 `standmeet-asset:` 这种
 * 非标准 scheme 直接剥掉 —— 图位是空的,而且不报错,所以漏了没人看得出来。
 */
export function expandBody(body: string, assetURLs?: Readonly<Record<string, string>>): string {
  return expandURIsToURLs(body, { ...(assetURLs ?? {}) });
}

/**
 * coverURL —— 封面那份素材的可访问地址。owner 没设 / 地址取不到 → undefined,
 * 调用方退回自己那套程序生成的封面。
 */
export function coverURL(
  coverAssetID?: string, assetURLs?: Readonly<Record<string, string>>,
): string | undefined {
  return coverAssetID ? assetURLs?.[coverAssetID] : undefined;
}
