// use-code-corpus —— 一张 code 的 corpus 准入面（ACL 三类里的 corpus 那类的 code 层）。
//
// role 授的是「这个受众」能读的正列表；一张码可以再**减** ——「这一次邀约」不该看的。
// GET 返回 granted(继承来的 role 正列表) + denied(本码收回的)，PUT 只写 denied：**code 只能减**，
// 开不了 role 没给的（capability-acl-hierarchy A.4 的纯 AND）。

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

export const CodeCorpusSchema = z.object({
  // granted —— 继承来的 role 正列表（只读；改它要去 /admin/roles）。
  granted: z.array(z.string()),
  // denied —— 本码收回的 glob（空 = 完全继承 role）。
  denied: z.array(z.string()),
});
export type CodeCorpus = z.infer<typeof CodeCorpusSchema>;

export function fetchCodeCorpus(codeID: string): Promise<CodeCorpus> {
  return adminAPI.get(`/codes/${codeID}/corpus`, CodeCorpusSchema);
}

export function saveCodeCorpus(codeID: string, denied: string[]): Promise<CodeCorpus> {
  return adminAPI.put(`/codes/${codeID}/corpus`, { denied }, CodeCorpusSchema);
}
