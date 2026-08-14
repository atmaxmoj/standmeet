// commit-draft —— 面板上那颗 `SEND →` 的落点：POST /api/admin/drafts/{id}/commit。
//
// 为什么这个文件存在（F-E-9）：`DraftsSection` 原来把 `onSend` 传成了 `onClose`。
// 于是那张确认框逐条许诺「冻结快照 / 渲染带 QR 的 PDF / 写 application 行 /
// 自动发一张 180 天的码」，点下去只是把面板关掉 —— 一个请求都不发，也不报错。
// owner 会以为自己投出去了。
//
// 后端两条路打的是**同一个** usecase（`jobsuc.CommitApplication`），这里只是把面板接上去。

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

const CommittedSchema = z.object({
  application_id: z.string(),
  access_code: z.string(),
  qr_url: z.string(),
});

export type Committed = z.infer<typeof CommittedSchema>;

export function commitDraft(id: string): Promise<Committed> {
  return adminAPI.post(`/drafts/${id}/commit`, {}, CommittedSchema);
}
