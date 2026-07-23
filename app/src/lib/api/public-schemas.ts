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
