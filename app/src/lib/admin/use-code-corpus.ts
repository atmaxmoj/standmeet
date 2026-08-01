// use-code-corpus —— 一张 code 的 corpus 准入面（ACL 三类里的 corpus 那类的 code 层）。
//
// role 授的是「这个受众」能读的正列表；一张码可以再**减** ——「这一次邀约」不该看的。
// 读的是那张码**三类拒绝的同一份载荷**（corpus 只是其中一类，MCP 拿到的也是这份），
// 写只写 corpus 那一类：**code 只能减**，开不了 role 没给的（capability-acl-hierarchy A.4 的纯 AND）。

import { z } from 'zod';

import { adminAPI } from '@/lib/api/admin';

// CodeDenialsSchema —— 一张码的三类拒绝 + role 在语料上授了什么（对照用）。
export const CodeDenialsSchema = z.object({
  capability_ids: z.array(z.string()),
  skill_ids: z.array(z.string()),
  // corpus_uris —— 本码收回的 glob（空 = 完全继承 role）。
  corpus_uris: z.array(z.string()),
  // corpus_granted —— 继承来的 role 正列表（只读；改它要去 /admin/roles）。
  corpus_granted: z.array(z.string()),
});
export type CodeDenials = z.infer<typeof CodeDenialsSchema>;

// CodeCorpus —— 这个面只关心语料那一类的两半。
export interface CodeCorpus {
  granted: string[];
  denied: string[];
}

function toCodeCorpus(d: CodeDenials): CodeCorpus {
  return { granted: d.corpus_granted, denied: d.corpus_uris };
}

export function fetchCodeCorpus(codeID: string): Promise<CodeCorpus> {
  return adminAPI.get(`/codes/${codeID}/denials`, CodeDenialsSchema).then(toCodeCorpus);
}

export function saveCodeCorpus(codeID: string, denied: string[]): Promise<CodeCorpus> {
  return adminAPI
    .put(`/codes/${codeID}/denials/corpus`, { uris: denied }, CodeDenialsSchema)
    .then(toCodeCorpus);
}
