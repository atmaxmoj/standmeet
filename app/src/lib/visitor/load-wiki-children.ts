// load-wiki-children —— LazyTree 的 wiki 数据口。每次取某层时读当前 stored
// session token(有 code → 带上走 role scope;无 → 匿名只 seo_indexed),交给
// fetchWikiTree。逻辑在 lib(组件层禁 if)。

import { fetchWikiTree } from '@/lib/api/public';
import type { TreeNode } from '@/lib/corpus/tree';
import { loadStoredSession } from '@/lib/gate/use-gate';

export function loadWikiChildren(parentID: string): Promise<TreeNode[]> {
  const token = loadStoredSession()?.session_token ?? '';
  return fetchWikiTree(parentID, token);
}
