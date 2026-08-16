// wiki-landing —— 一条 wiki landing 载荷的形状 + 解析。**纯计算,没有 'use client'**。
//
// 它住在这儿而不是 scoped-reader 里,是因为服务端那条路也要用:scoped-reader 为了读
// localStorage 里的访客 token 而 import 了 use-gate(一个 client hook 模块),Server Component
// 一 import 它就整包炸("You're importing a component that needs useState")。
// 跟 `lib/corpus/media.ts` 同一条判据:**纯函数不该住在客户端边界里面** —— 它没有状态、
// 没有 hook、没有 DOM,放进去只是因为"用它的那个组件在那儿",而那不是一个理由。

import { z } from 'zod';

const WikiRefViewSchema = z.object({ path: z.string(), title: z.string() });

// WikiAssetSchema —— 一份挂在这条语料上的文件。**要真实字节数**:下载按钮上写"3.4 MB"
// 是访客决定点不点的依据,写"下载"等于什么都没说。
const WikiAssetSchema = z.object({
  asset_id: z.string(),
  kind: z.string(),
  content_type: z.string(),
  original_filename: z.string(),
  url: z.string(),
  size_bytes: z.number(),
});
// 素材那一项的类型不单独导出：reader 现在整条读 `WikiLandingEntry`，
// 谁也不需要单拎出一份 asset 的类型。（knip 会盯着这种「导出了没人用」的东西。）

export const WikiLandingEntrySchema = z.object({
  path: z.string(),
  title: z.string(),
  body: z.string(),
  excerpt: z.string(),
  updated_at: z.string(),
  tags: z.array(z.string()).nullish().transform((v) => v ?? []),
  css_classes: z.array(z.string()).nullish().transform((v) => v ?? []),
  related: z.array(WikiRefViewSchema).nullish().transform((v) => v ?? []),
  cited_by: z.array(WikiRefViewSchema).nullish().transform((v) => v ?? []),
  sources_count: z.number(),
  // asset_urls —— 正文里的 `standmeet-asset:<id>` 引用 + hero 图 → 可访问地址。
  // 没有它，正文里那条 URI 渲不出来（react-markdown 的 urlTransform 会把非标准
  // scheme 直接剥掉），访客看到的是一个空的图位。
  asset_urls: z.record(z.string(), z.string()).nullish().transform((v) => v ?? {}),
  // assets —— 挂在这条上的文件。图片进正文,附件渲成下载区。
  assets: z.array(WikiAssetSchema).nullish().transform((v) => v ?? []),
  // hero 三件套。三个都空 = owner 没设 hero → 顶上什么也不渲(F-L-32)。
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? ''),
  cover_headline: z.string().nullish().transform((v) => v ?? ''),
  cover_hue: z.string().nullish().transform((v) => v ?? ''),
  // 多语:body 已经是选中语言的那一份。languages 空 = 单语,不出切换器。
  lang: z.string().nullish().transform((v) => v ?? ''),
  languages: z.array(z.object({ code: z.string(), label: z.string() }))
    .nullish().transform((v) => v ?? []),
});
export type WikiLandingEntry = z.infer<typeof WikiLandingEntrySchema>;

/**
 * parseWikiLanding —— 一份 landing 载荷 → reader 读的那个形状。形状不对 / 没有 → null。
 *
 * **两条入口都必须过这里**:SSR(已发布,匿名)那条和带 token 重取那条。以前只有后者过,
 * 前者把后端那份 snake_case 载荷**直接**当 reader 的 entry 用 —— 而 reader 那个类型的
 * hero / 素材字段当时是 camelCase 且可选,于是类型检查一声不响地通过,已发布笔记的封面图、
 * 封面那句话、正文里的配图**全部消失**(F-L-33)。一份载荷两种形状,漏掉的那一半不报错。
 * 现在 reader 的 entry 就是这个 schema 的产物,没有第二份形状可漏。
 */
export function parseWikiLanding(raw: unknown): WikiLandingEntry | null {
  const parsed = WikiLandingEntrySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
