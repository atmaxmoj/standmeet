// corpus-search —— 访客搜索框的数据口:读 stored session(code scope),POST corpus_search tool,
// 返命中。ACL 全在后端(按 role 的 grantedGlobs),这里只发 query、渲结果。逻辑在 lib(组件层禁 if)。

import { z } from 'zod';

import { baseURL } from '@/lib/api/public';
import { loadStoredSession } from '@/lib/gate/use-gate';

const HitSchema = z.object({ path: z.string(), title: z.string(), genre: z.string() });
const EnvelopeSchema = z.object({ result: z.array(HitSchema).optional() });

export type CorpusSearchHit = z.infer<typeof HitSchema>;

// corpusSearch —— 无 session(未持 code)或空 query → 空结果;否则走 per-tool 端点。
export async function corpusSearch(query: string): Promise<CorpusSearchHit[]> {
  const stored = loadStoredSession();
  const token = stored?.session_token ?? '';
  const conv = stored?.conversation_id ?? '';
  const ready = token !== '' && conv !== '' && query.trim() !== '';
  return ready ? fetchHits(conv, token, query) : [];
}

async function fetchHits(conv: string, token: string, query: string): Promise<CorpusSearchHit[]> {
  // QUERY (RFC 10008)：corpus_search 是安全/幂等的带 body 查询 —— 语义正确的方法。
  // 同源调用，无 CORS 预检；后端只读工具放行 QUERY（会改状态的工具才需 POST）。
  const res = await fetch(`${baseURL()}/api/v1/sessions/${conv}/tools/corpus_search`, {
    method: 'QUERY',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query }),
  });
  const parsed = EnvelopeSchema.safeParse(await res.json());
  return parsed.success ? parsed.data.result ?? [] : [];
}
