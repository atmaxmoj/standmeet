import { z } from 'zod';

// AdminPageSchema —— /api/admin/page GET/PUT 的形状。insights/projects 是 corpus
// pin 列表(wiki id 引用),不是自由文本 —— 主页渲染时 join 成卡(不变量
// pinned ⊆ published 在写入点维护)。跟公开 /api/v1/page 的卡形状(PagePinCard)
// 不同:这里存引用,那里存渲染好的卡。
export const AdminPageSchema = z.object({
  updated_at: z.string(), owner_id: z.string(), hero_prose: z.string(),
  hero_examples: z.array(z.string()),
  insights: z.array(z.string()),
  projects: z.array(z.string()),
  where: z.object({ location_line: z.string(), status_prose: z.string(), looking_for: z.array(z.string()), closing: z.string() }),
  contact: z.object({ chat_line: z.string(), email: z.string(), recruiter_prose: z.string(), casual_prose: z.string() }),
});
export type AdminPage = z.infer<typeof AdminPageSchema>;

// PinnableEntrySchema —— GET /page/pinnable 的候选:published 的 wiki 条目
// (id/title/path),给 admin pin manager 的选择器。
export const PinnableEntrySchema = z.object({
  id: z.string(), title: z.string(), path: z.string(),
});
export const PinnableListSchema = z.array(PinnableEntrySchema);
export type PinnableEntry = z.infer<typeof PinnableEntrySchema>;

// ─── writings（公开读者页）────────────────────────────────────────────
// 从 `public.ts` 搬过来的：那个文件顶到了 max-lines，而闸门指的方向是对的 ——
// schema 归 schema。这里只放形状，取数仍在 public.ts。

// BacklinkRef —— /writings/<slug> "linked from" 的一条。后端渲染时收集，
// 源 writing 必须 published。
const BacklinkRefSchema = z.object({ slug: z.string(), title: z.string() });
export type BacklinkRef = z.infer<typeof BacklinkRefSchema>;

export const WritingViewSchema = z.object({
  id: z.string(), slug: z.string(), title: z.string(), excerpt: z.string(),
  body_md: z.string(), cover_headline: z.string(),
  cover_hue: z.enum(['amber', 'violet', 'acid']),
  cover_image_asset_id: z.string().nullish().transform((v) => v ?? undefined),
  tags: z.array(z.string()), visibility: z.enum(['public', 'private']),
  cross_refs: z.array(z.string()), path: z.string(), read_minutes: z.number(),
  locked_body: z.string().nullish().transform((v) => v ?? undefined),
  published_at: z.string().nullish().transform((v) => v ?? undefined),
  asset_urls: z.record(z.string(), z.string()).nullish().transform((v) => v ?? {}),
  backlinks: z.array(BacklinkRefSchema).nullish().transform((v) => v ?? []),
  // 服务端已挑好那一面；这两个只回答"还有哪些"（切换器用）。
  //
  // **`.nullish()` 不是 `.optional()`**（F-R-5）：Go 的 nil slice 编码出来是 `null`，
  // 而 `.optional()` 只接受**键不在**，接不住 `null` —— 于是整份 parse 挂掉，
  // 而 zod 不匹配是**整份挂掉**，不是这一个字段变 undefined（[[zod-unknown-is-not-optional]]）。
  // 后果不是少一个语言切换器，是 `/writings` 整页 500。这一行上面那几个
  // `.optional()` 是同一个坑的邻居，一起改了：它们的值也都来自可能为 nil 的 Go 字段。
  lang: z.string().nullish(),
  languages: z.array(z.object({ code: z.string(), label: z.string() })).nullish(),
});
export type WritingView = z.infer<typeof WritingViewSchema>;
